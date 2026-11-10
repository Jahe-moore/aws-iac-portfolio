# APP: the serverless side of the site.
# One Python Lambda serves /api/visit and /api/health behind CloudFront and runs
# the uptime check on an EventBridge schedule. DynamoDB holds the visitor counter
# and the uptime history. CloudWatch alarms email through SNS.

locals {
  app_name         = "${var.project}-api"
  metric_namespace = "IacPortfolio"
}

# ---------- DynamoDB ----------

resource "aws_dynamodb_table" "app" {
  name         = "${var.project}-app"
  billing_mode = "PAY_PER_REQUEST" # pay per request, so idle costs nothing
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  #checkov:skip=CKV_AWS_119:AWS-owned encryption is on; a customer-managed KMS key adds $1/month for no gain on a visitor counter
}

# ---------- Lambda role: only its own table, its own logs, its own metric ----------

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# The deploy role may only create roles named iac-portfolio-app-*.
resource "aws_iam_role" "lambda" {
  name               = "${var.project}-app-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "lambda" {
  statement {
    sid       = "OwnTable"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.app.arn]
  }

  statement {
    sid       = "OwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.lambda.arn}:*"]
  }

  statement {
    sid       = "OwnMetric"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = [local.metric_namespace]
    }
  }

  statement {
    sid       = "Tracing"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "lambda" {
  name   = "app"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda.json
}

# ---------- Lambda ----------

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.app_name}"
  retention_in_days = 14

  #checkov:skip=CKV_AWS_158:Logs hold no personal data; default encryption is enough without a $1/month KMS key
  #checkov:skip=CKV_AWS_338:14 days is enough for a portfolio site; a year of logs has no use here
}

data "archive_file" "lambda" {
  type        = "zip"
  source_file = "${path.module}/lambda/handler.py"
  output_path = "${path.module}/build/lambda.zip"
}

resource "aws_lambda_function" "app" {
  function_name    = local.app_name
  role             = aws_iam_role.lambda.arn
  runtime          = "python3.13"
  handler          = "handler.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 15
  memory_size      = 128

  environment {
    variables = {
      TABLE_NAME       = aws_dynamodb_table.app.name
      SITE_URL         = "https://${var.domain_name}/"
      METRIC_NAMESPACE = local.metric_namespace
    }
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [aws_cloudwatch_log_group.lambda, aws_iam_role_policy.lambda]

  #checkov:skip=CKV_AWS_115:New accounts cannot reserve concurrency below the 10 unreserved minimum
  #checkov:skip=CKV_AWS_116:Requests are synchronous; a dead-letter queue only applies to async invokes
  #checkov:skip=CKV_AWS_117:The function only calls public AWS APIs and the site; a VPC would add a NAT gateway at about $32/month
  #checkov:skip=CKV_AWS_173:Environment holds names, not secrets; default encryption applies
  #checkov:skip=CKV_AWS_272:Code is deployed only by the pipeline from the reviewed repo; code signing adds a signing profile with no extra assurance here
}

# The function URL requires AWS signatures: only CloudFront (through Origin
# Access Control) can call it, never the open internet directly.
resource "aws_lambda_function_url" "app" {
  function_name      = aws_lambda_function.app.function_name
  authorization_type = "AWS_IAM"
}

resource "aws_lambda_permission" "cloudfront_url" {
  statement_id           = "CloudFrontInvokeUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.app.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.site.arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "cloudfront_invoke" {
  statement_id             = "CloudFrontInvokeViaUrl"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.app.function_name
  principal                = "cloudfront.amazonaws.com"
  source_arn               = aws_cloudfront_distribution.site.arn
  invoked_via_function_url = true
}

# ---------- Uptime check every 30 minutes ----------

resource "aws_cloudwatch_event_rule" "uptime" {
  name                = "${var.project}-uptime"
  description         = "Check the site every 30 minutes"
  schedule_expression = "rate(30 minutes)"
}

resource "aws_cloudwatch_event_target" "uptime" {
  rule = aws_cloudwatch_event_rule.uptime.name
  arn  = aws_lambda_function.app.arn
}

resource "aws_lambda_permission" "uptime" {
  statement_id  = "EventBridgeUptime"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.app.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.uptime.arn
}

# ---------- Alerts ----------

resource "aws_sns_topic" "alerts" {
  name = "${var.project}-alerts"

  #checkov:skip=CKV_AWS_26:CloudWatch alarms cannot publish to a topic encrypted with the AWS-managed SNS key, and a customer key costs $1/month; alerts carry no sensitive data
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "site_down" {
  alarm_name          = "${var.project}-site-down"
  alarm_description   = "The uptime check could not load the site"
  namespace           = local.metric_namespace
  metric_name         = "SiteUp"
  statistic           = "Minimum"
  period              = 1800
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "${var.project}-api-errors"
  alarm_description   = "The site API returned errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.app.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
