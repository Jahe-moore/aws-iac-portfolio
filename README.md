# AWS Infrastructure as Code

Live: **https://aws.jakemoore.dev**

A website on AWS where every resource is defined in Terraform and every change ships through a GitHub Actions pipeline. GitHub signs in to AWS with short-lived OIDC tokens.

| Area | What it uses |
|---|---|
| Hosting | S3 (private bucket), CloudFront (CDN, HTTPS), ACM certificate for a custom domain |
| Change control | Plan on every pull request, apply on `main` only, nightly drift check |
| Security | OIDC federation, least-privilege IAM, Origin Access Control on S3, security headers, Checkov scan as a pipeline gate |
| Delivery | Terraform with remote state in S3 (versioned, encrypted, locked), GitHub Actions |

Running cost is about $0/month: everything stays inside the AWS free tier at portfolio traffic, with a $10 budget alert as a guardrail.

## How it works

```
git push -> GitHub Actions
              1. Checkov scans the Terraform (any failed check stops the run)
              2. OIDC login to AWS: short-lived token, scoped to this repo
              3. terraform fmt, validate, plan
              4. on main only: terraform apply, upload site/, write status/deploy.json
                       |
                       v
AWS:  CloudFront (aws.jakemoore.dev, HTTPS, security headers)
        -> S3 bucket (private, readable only by CloudFront)
      Nightly workflow -> terraform plan -> fails if AWS no longer matches the code
```

| Folder | What it is | Who runs it |
|---|---|---|
| `bootstrap/` | State bucket, GitHub OIDC provider, deploy role | You, once, from your machine |
| `infra/` | Site bucket, CDN, certificate, security headers | The pipeline, on every push to `main` |
| `site/` | The page (HTML, CSS, JS; no frameworks); the pipeline also publishes the repo files to `/source` for it | Uploaded by the pipeline |
| `.github/workflows/` | `deploy.yml` (every push), `drift.yml` (nightly) | GitHub Actions |

## Security choices

- **OIDC sign-in.** The deploy role trusts GitHub's OIDC provider, and only for this repository, matched by GitHub's immutable owner and repo IDs so a renamed or recreated repo cannot assume it.
- **Least privilege.** The deploy role is limited to resources named for this project. It has no IAM write access at all, so it cannot change its own permissions.
- **Nothing public except through CloudFront.** S3 blocks all public access; a bucket policy lets only this distribution read it.
- **Headers.** Strict CSP (no inline scripts or styles), HSTS, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy.
- **Scan as a gate.** Checkov runs on every push. Findings are fixed, or skipped in the code with a written reason; the live page lists each accepted risk.

## Deploy your own

You need an AWS account, a GitHub account, a domain whose DNS you control, and Terraform 1.10+, the AWS CLI v2 and the GitHub CLI installed.

1. **Sign the CLI in to AWS** with an identity that has admin rights for the one-time bootstrap. `aws login` uses your console sign-in and issues temporary credentials, so no access key is created:
   ```
   aws login --region us-west-2
   ```
2. **Create a GitHub repo** and push this code to it.
3. **Look up the repo's OIDC subject IDs:**
   ```
   gh api repos/OWNER/REPO/actions/oidc/customization/sub
   ```
   The `sub_claim_prefix` reads `repo:OWNER@OWNER_ID/REPO@REPO_ID`.
4. **Bootstrap.** Copy `bootstrap/terraform.tfvars.example` to `terraform.tfvars`, fill in the four values, then:
   ```
   cd bootstrap
   terraform init
   terraform apply
   ```
   Keep the local `terraform.tfstate` it creates; it is the record of these resources.
5. **Point the project at your domain.** Set `domain_name` in `infra/variables.tf`.
6. **Add the repo settings** (Settings, Secrets and variables, Actions): secret `AWS_ROLE_ARN`, variables `TF_STATE_BUCKET` and `AWS_REGION` (the bootstrap outputs).
7. **Push to `main`.** The pipeline requests the certificate and waits for DNS validation. While it waits, add two CNAME records at your DNS provider:
   - the validation record: `aws acm describe-certificate --region us-east-1 --certificate-arn <arn>` shows its name and value
   - your subdomain pointing to the CloudFront domain (the `cloudfront_domain` output)

## Tearing down

```
cd infra
terraform init -backend-config="bucket=YOUR_STATE_BUCKET" -backend-config="region=us-west-2"
terraform destroy
```

Then empty the state bucket and run `terraform destroy` in `bootstrap/`.
