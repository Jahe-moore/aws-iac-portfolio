# AWS Infrastructure as Code

Live: **https://aws.jakemoore.dev**

A website on AWS where every resource is defined in Terraform and every change ships through a GitHub Actions pipeline. GitHub logs in to AWS with short-lived OIDC tokens, so no cloud keys are stored anywhere. The page reports on itself: last deploy, security scan results, uptime and a nightly drift check.

| Area | What it uses |
|---|---|
| Hosting | S3 (private bucket), CloudFront (CDN, HTTPS), ACM certificate for a custom domain |
| Serverless | Lambda (Python) behind CloudFront at `/api`, DynamoDB for the visitor counter and uptime history |
| Operations | EventBridge schedule for uptime checks, CloudWatch alarms, SNS email alerts, nightly drift check |
| Security | OIDC federation, least-privilege IAM, Origin Access Control on S3 and Lambda, security headers, Checkov scan as a pipeline gate |
| Delivery | Terraform with remote state in S3 (versioned, encrypted, locked), GitHub Actions |

Running cost is about $0/month: every service used stays inside the AWS free tier at portfolio traffic.

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
        |-- /       -> S3 bucket (private, readable only by CloudFront)
        |-- /api/*  -> Lambda function URL (IAM auth, callable only by CloudFront)
                         |-- DynamoDB table (visits, uptime history)
      EventBridge every 30 min -> Lambda uptime check -> CloudWatch metric -> alarm -> SNS email
      Nightly workflow -> terraform plan -> status/drift.json
```

| Folder | What it is | Who runs it |
|---|---|---|
| `bootstrap/` | State bucket, GitHub OIDC provider, deploy role | You, once, from your machine |
| `infra/` | Site, CDN, certificate, Lambda, DynamoDB, schedule, alarms | The pipeline, on every push to `main` |
| `infra/lambda/` | Python handler for `/api/visit`, `/api/health` and the uptime check | Deployed by Terraform |
| `site/` | The page (HTML, CSS, JS; no frameworks) | Uploaded by the pipeline |
| `.github/workflows/` | `deploy.yml` (every push), `drift.yml` (nightly) | GitHub Actions |

## Security choices

- **No stored keys.** The deploy role trusts GitHub's OIDC provider, and only for this repository, matched by GitHub's immutable owner and repo IDs so a renamed or recreated repo cannot assume it.
- **Least privilege.** The deploy role is limited to resources named for this project. It can create IAM roles only under the `iac-portfolio-app-` prefix, so it cannot change its own permissions. The Lambda role can touch only its own table, log group and metric namespace.
- **Nothing public except through CloudFront.** S3 blocks all public access; the Lambda function URL requires IAM signatures, which only CloudFront provides.
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
6. **Add the repo settings** (Settings, Secrets and variables, Actions):
   - Variables: `AWS_ROLE_ARN`, `TF_STATE_BUCKET`, `AWS_REGION` (the bootstrap outputs)
   - Secret: `ALERT_EMAIL` (where alarm emails go)
7. **Push to `main`.** The pipeline requests the certificate and waits for DNS validation. While it waits, add two CNAME records at your DNS provider:
   - the validation record: `aws acm describe-certificate --region us-east-1 --certificate-arn <arn>` shows its name and value
   - your subdomain pointing to the CloudFront domain (the `cloudfront_domain` output)
8. **Confirm the SNS email** AWS sends, so alarms can reach you.

## Tearing down

```
cd infra
terraform init -backend-config="bucket=YOUR_STATE_BUCKET" -backend-config="region=us-west-2"
terraform destroy
```

Then empty the state bucket and run `terraform destroy` in `bootstrap/`.
