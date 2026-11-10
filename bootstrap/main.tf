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
