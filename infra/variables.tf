variable "aws_region" {
  description = "AWS region to build in (must match bootstrap)"
  type        = string
  default     = "us-west-2"
}

variable "project" {
  description = "Short name used as a prefix (must match bootstrap)"
  type        = string
  default     = "iac-portfolio"
}

variable "domain_name" {
  description = "Custom domain for the site (DNS hosted at Namecheap)"
  type        = string
  default     = "aws.jakemoore.dev"
}
