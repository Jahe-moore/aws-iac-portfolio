# INFRA: the actual project. GitHub Actions runs this on every push to main.
# Builds a private S3 bucket holding the website files and a CloudFront
# distribution (AWS's CDN) that serves them over HTTPS.

terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  # State lives in the bucket created by bootstrap. Bucket name and region
  # are passed in at `terraform init` so nothing account-specific is hardcoded.
  backend "s3" {
    key          = "infra/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
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

# CloudFront only accepts certificates from us-east-1, whatever region the rest uses.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  site_bucket = "${var.project}-site-${data.aws_caller_identity.current.account_id}"
}

# ---------- Website bucket (private) ----------

resource "aws_s3_bucket" "site" {
  bucket        = local.site_bucket
  force_destroy = true # lets `terraform destroy` remove the bucket even with files in it

  #checkov:skip=CKV_AWS_18:Every request is already served by CloudFront; S3 access logs would duplicate it into a second bucket
  #checkov:skip=CKV_AWS_21:Site files are rebuilt from git on every deploy, so git history is the version history
  #checkov:skip=CKV_AWS_144:Public, rebuildable site content; replicating it to a second region adds cost with no recovery value
  #checkov:skip=CKV_AWS_145:Public web files; S3-managed encryption is on, a KMS key would add cost and nothing secret is stored
  #checkov:skip=CKV2_AWS_62:Nothing needs to react to uploads; the pipeline is the only writer
}

resource "aws_s3_bucket_lifecycle_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ---------- HTTPS certificate for the custom domain ----------

# Free public certificate from ACM; it renews itself while the DNS record stays.
# DNS lives at Namecheap, so the validation record is added there by hand once
# (see the cert_validation_record output).
resource "aws_acm_certificate" "site" {
  provider          = aws.us_east_1
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "site" {
  provider        = aws.us_east_1
  certificate_arn = aws_acm_certificate.site.arn
}

# ---------- CloudFront ----------

# Origin Access Control: lets CloudFront, and only CloudFront, read the bucket.
resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.project}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Same idea for the API: CloudFront signs requests to the Lambda function URL,
# which rejects anything unsigned.
resource "aws_cloudfront_origin_access_control" "api" {
  name                              = "${var.project}-api-oac"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

# Pass the API only what it uses: the viewer's country, TLS and HTTP version,
# which CloudFront adds itself. No cookies, no other viewer headers.
resource "aws_cloudfront_origin_request_policy" "api" {
  name    = "${var.project}-api-request"
  comment = "Viewer country, TLS and HTTP version for the API"

  cookies_config {
    cookie_behavior = "none"
  }

  headers_config {
    header_behavior = "whitelist"
    headers {
      items = ["CloudFront-Viewer-Country", "CloudFront-Viewer-TLS", "CloudFront-Viewer-Http-Version"]
    }
  }

  query_strings_config {
    query_string_behavior = "none"
  }
}

# Security headers on every response.
resource "aws_cloudfront_response_headers_policy" "security" {
  name = "${var.project}-security-headers"

  security_headers_config {
    content_security_policy {
      content_security_policy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'"
      override                = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=(), payment=()"
      override = true
    }
  }
}

resource "aws_cloudfront_distribution" "site" {
  #checkov:skip=CKV_AWS_68:AWS WAF starts at about $5/month; a static portfolio site with a read-only API does not justify it
  #checkov:skip=CKV2_AWS_47:Depends on WAF (see CKV_AWS_68); no Java or Log4j anywhere in this stack
  #checkov:skip=CKV_AWS_86:Uptime and errors are tracked by the checker and CloudWatch alarms; access logs would need a separate logging bucket
  #checkov:skip=CKV_AWS_310:Single S3 origin with eleven-nines durability; a failover origin doubles the infrastructure for no gain
  #checkov:skip=CKV_AWS_374:A public portfolio site is meant to be reachable from anywhere

  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # North America + Europe only, the cheapest tier
  comment             = var.project
  aliases             = [var.domain_name]

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-site"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  origin {
    domain_name              = trimsuffix(trimprefix(aws_lambda_function_url.app.function_url, "https://"), "/")
    origin_id                = "lambda-api"
    origin_access_control_id = aws_cloudfront_origin_access_control.api.id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = "lambda-api"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id   = aws_cloudfront_origin_request_policy.api.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    compress                   = true
  }

  default_cache_behavior {
    target_origin_id           = "s3-site"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    compress                   = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ---------- Bucket policy: allow only this CloudFront distribution ----------

data "aws_iam_policy_document" "site" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site.json

  depends_on = [aws_s3_bucket_public_access_block.site]
}
