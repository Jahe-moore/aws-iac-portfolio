# BOOTSTRAP: run once from your own PC.
# Creates the three things the pipeline needs before it can run by itself:
#   1. An S3 bucket that stores Terraform's state file (its record of what it built)
#   2. A trust link between AWS and GitHub (OIDC), so no access keys live in GitHub
#   3. An IAM role that GitHub Actions is allowed to assume, limited to this project

terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_id   = data.aws_caller_identity.current.account_id
  state_bucket = "${var.project}-tfstate-${local.account_id}"
  site_bucket  = "${var.project}-site-${local.account_id}"
}

# ---------- 1. State bucket ----------

resource "aws_s3_bucket" "state" {
  bucket = local.state_bucket

  #checkov:skip=CKV_AWS_18:Only the deploy role and the owner touch this bucket; CloudTrail already records API access
  #checkov:skip=CKV_AWS_144:State can be rebuilt by importing; cross-region replication adds cost for a one-person project
  #checkov:skip=CKV_AWS_145:Encrypted with S3-managed keys; a KMS key adds $1/month without changing who can read it
  #checkov:skip=CKV2_AWS_62:Nothing needs to react to state changes
}

# Keep old state versions for 90 days, then let them expire.
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ---------- 2. GitHub OIDC trust ----------

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# ---------- 3. Role that GitHub Actions assumes ----------

data "aws_iam_policy_document" "github_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Only workflows in YOUR repo can use this role. GitHub's immutable subject
    # includes the numeric owner and repo IDs, so a deleted-and-recreated repo
    # with the same name cannot reuse this role.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_owner}@${var.github_owner_id}/${var.github_repo}@${var.github_repo_id}:*"]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = "${var.project}-github-actions"
  assume_role_policy = data.aws_iam_policy_document.github_trust.json
}

data "aws_iam_policy_document" "deploy" {
  #checkov:skip=CKV_AWS_356:CloudFront and ACM create resources whose ARNs do not exist yet, so those two need "*"; every other service is scoped to this project's names
  #checkov:skip=CKV_AWS_111:Write access is limited to resources named for this project; the remaining "*" covers CloudFront and ACM only
  #checkov:skip=CKV_AWS_109:IAM changes are limited to roles named iac-portfolio-app-*, which excludes the deploy role itself

  statement {
    sid     = "ProjectBucketsOnly"
    actions = ["s3:*"]
    resources = [
      "arn:aws:s3:::${local.state_bucket}",
      "arn:aws:s3:::${local.state_bucket}/*",
      "arn:aws:s3:::${local.site_bucket}",
      "arn:aws:s3:::${local.site_bucket}/*",
    ]
  }

  statement {
    sid       = "CloudFront"
    actions   = ["cloudfront:*"]
    resources = ["*"]
  }

  statement {
    sid       = "Certificates"
    actions   = ["acm:*"]
    resources = ["*"]
  }

  statement {
    sid     = "ProjectServerless"
    actions = ["lambda:*", "dynamodb:*", "events:*", "sns:*"]
    resources = [
      "arn:aws:lambda:*:${local.account_id}:function:${var.project}-*",
      "arn:aws:dynamodb:*:${local.account_id}:table/${var.project}-*",
      "arn:aws:events:*:${local.account_id}:rule/${var.project}-*",
      "arn:aws:sns:*:${local.account_id}:${var.project}-*",
    ]
  }

  statement {
    sid     = "ProjectMonitoring"
    actions = ["cloudwatch:*", "logs:*"]
    resources = [
      "arn:aws:cloudwatch:*:${local.account_id}:alarm:${var.project}-*",
      "arn:aws:logs:*:${local.account_id}:log-group:/aws/lambda/${var.project}-*",
    ]
  }

  statement {
    sid = "ReadOnlyListing"
    actions = [
      "cloudwatch:DescribeAlarms",
      "logs:DescribeLogGroups",
      "sns:ListTopics",
      "events:ListRules",
      "lambda:ListFunctions",
      "dynamodb:ListTables",
    ]
    resources = ["*"]
  }

  # The pipeline can create roles only under the app- prefix, so it can never
  # edit its own role (iac-portfolio-github-actions) to gain more access.
  statement {
    sid = "AppRolesOnly"
    actions = [
      "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:UpdateRole",
      "iam:UpdateAssumeRolePolicy", "iam:TagRole", "iam:UntagRole",
      "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy",
      "iam:ListRolePolicies", "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole", "iam:PassRole",
    ]
    resources = ["arn:aws:iam::${local.account_id}:role/${var.project}-app-*"]
  }

  statement {
    sid       = "WhoAmI"
    actions   = ["sts:GetCallerIdentity"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.github_actions.id
  policy = data.aws_iam_policy_document.deploy.json
}
