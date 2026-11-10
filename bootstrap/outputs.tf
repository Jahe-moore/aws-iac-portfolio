# After `terraform apply`, copy these three values into GitHub repo variables.

output "AWS_ROLE_ARN" {
  value = aws_iam_role.github_actions.arn
}

output "TF_STATE_BUCKET" {
  value = aws_s3_bucket.state.bucket
}

output "AWS_REGION" {
  value = var.aws_region
}
