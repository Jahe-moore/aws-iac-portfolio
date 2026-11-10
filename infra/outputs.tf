output "site_url" {
  description = "Open this in a browser to see the site"
  value       = "https://${var.domain_name}"
}

output "site_bucket" {
  value = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "cloudfront_domain" {
  description = "Target for the domain's CNAME record at Namecheap"
  value       = aws_cloudfront_distribution.site.domain_name
}

output "cert_validation_record" {
  description = "CNAME record ACM needs at Namecheap to prove domain ownership"
  value       = aws_acm_certificate.site.domain_validation_options
}

output "certificate_arn" {
  value = aws_acm_certificate.site.arn
}

output "api_function" {
  value = aws_lambda_function.app.function_name
}
