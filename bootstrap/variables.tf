variable "aws_region" {
  description = "AWS region to build in"
  type        = string
  default     = "us-west-2"
}

variable "project" {
  description = "Short name used as a prefix for everything this project creates"
  type        = string
  default     = "iac-portfolio"
}

variable "github_owner" {
  description = "Your GitHub username"
  type        = string
}

variable "github_repo" {
  description = "Name of the GitHub repo that holds this code"
  type        = string
}
