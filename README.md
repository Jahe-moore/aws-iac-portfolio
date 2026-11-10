# AWS Infrastructure as Code Portfolio Project

A static website on AWS where every piece of infrastructure is defined in Terraform and deployed by GitHub Actions. No console clicking, no access keys stored in GitHub.

**Stack:** S3, CloudFront, IAM (OIDC), Terraform, GitHub Actions
**Running cost:** about $0/month at personal traffic levels

> This README doubles as your setup guide. Once the project works, replace the setup sections with a write-up (problem, architecture diagram, lessons learned).

## How it fits together

```
You edit code -> git push -> GitHub Actions
                                 |  logs in to AWS with OIDC (short-lived token, no keys)
                                 v
                             Terraform  -> builds/updates S3 bucket + CloudFront
                                 |
                                 v
                             Uploads site/ files -> live at the CloudFront URL
```

| Folder | What it is | Who runs it |
|---|---|---|
| `bootstrap/` | One-time setup: state bucket, GitHub trust link, deploy role | You, once, from your PC |
| `infra/` | The project itself: website bucket and CloudFront | GitHub Actions, on every push |
| `site/` | The web page files | Uploaded by the pipeline |
| `.github/workflows/` | The pipeline definition | GitHub |

## Part 1: Accounts and tools (about 45 minutes)

1. **Create an AWS account** at aws.amazon.com. Turn on MFA for the root login right away.
2. **Set a billing alert.** In the AWS console, search "Budgets", create a budget, pick the "Monthly cost budget" template, set it to $10, and enter your email.
3. **Create an admin user for yourself** so you stop using the root login:
   - Console, search "IAM", Users, Create user, name it `jake-admin`
   - Attach the policy `AdministratorAccess`
   - Open the user, Security credentials, Create access key, choose "Command Line Interface"
   - Keep that page open for step 5. Never paste these keys into a file in this repo.
4. **Install the tools** (Windows, in PowerShell):
   ```powershell
   winget install Hashicorp.Terraform
   winget install Amazon.AWSCLI
   winget install Git.Git
   ```
   Close and reopen PowerShell, then confirm:
   ```powershell
   terraform -version
   aws --version
   ```
5. **Connect the CLI to your account:**
   ```powershell
   aws configure
   ```
   Paste the access key and secret key, region `us-west-2`, output `json`. Then check it worked:
   ```powershell
   aws sts get-caller-identity
   ```

## Part 2: Put the code on GitHub (10 minutes)

1. Create a new **empty** repo on GitHub named `aws-iac-portfolio` (public, no README).
2. In PowerShell, from this folder:
   ```powershell
   git init -b main
   git add .
   git commit -m "Initial scaffold"
   git remote add origin https://github.com/YOUR_USERNAME/aws-iac-portfolio.git
   ```
   Do not push yet. The pipeline needs Part 3 first.

## Part 3: Bootstrap (15 minutes, run once)

```powershell
cd bootstrap
copy terraform.tfvars.example terraform.tfvars
notepad terraform.tfvars      # set your GitHub username and repo name
terraform init
terraform plan                # read what it intends to create
terraform apply               # type yes
```

It prints three outputs. In your GitHub repo go to **Settings, Secrets and variables, Actions, Variables tab** and add each one as a repository variable:

- `AWS_ROLE_ARN`
- `TF_STATE_BUCKET`
- `AWS_REGION`

These are identifiers, not secrets, which is the point of OIDC.

## Part 4: First deploy

```powershell
cd ..
git push -u origin main
```

Open the **Actions** tab on GitHub and watch the run. The first one takes 5 to 10 minutes because CloudFront is slow to create. The site URL appears in the run summary.

## Part 5: The demo

Edit `site/index.html`, change "Version 1" to "Version 2", then:

```powershell
git commit -am "Update site"
git push
```

The page updates on its own in about a minute. This is the 30-second clip for the video.

## Tearing down

At idle this costs effectively nothing, so you can leave it up. To remove everything:

```powershell
cd infra
terraform init -backend-config="bucket=YOUR_TF_STATE_BUCKET" -backend-config="region=us-west-2"
terraform destroy
```

To also remove the bootstrap pieces, empty the state bucket in the console, then run `terraform destroy` in `bootstrap/`.

## What to screen-record as you go

- The empty AWS console before anything exists
- `terraform plan` output in bootstrap (shows the "code becomes infrastructure" idea)
- The first GitHub Actions run going green
- The live site, then the Version 1 to Version 2 change deploying
- Blur or crop your 12-digit AWS account ID and email. Never show the access key page.

## Next steps after it works

1. Tighten the role's trust policy so only the `main` branch can apply
2. Add a custom domain with an ACM certificate
3. Add the VPC, load balancer, and container app as a second stack
4. Replace the `jake-admin` access key with IAM Identity Center (leads into the security baseline project)
