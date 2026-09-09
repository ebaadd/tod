# Deploying to AWS

Everything here is pay-per-use. With no visitors the running cost is the
Aurora storage bill — cents, not dollars. Nothing else bills at rest.

## What runs where

| Piece | Service | Idle cost |
| --- | --- | --- |
| Website | S3 + CloudFront | $0 |
| API | Lambda container, arm64 | $0 |
| Grouping | Lambda on the DynamoDB stream | $0 |
| Submissions, history, public links | DynamoDB on-demand | $0 |
| Accounts, sessions, groups | Aurora Serverless v2, floor 0 ACU | storage only |

One CloudFront distribution serves both the site and `/api/*`. That is what
makes the owner's session cookie work: a `SameSite=Lax` cookie is not sent on
a cross-site request, and `*.amazonaws.com` is on the Public Suffix List, so
a shared parent domain is not available either. Same origin avoids both, and
removes CORS along the way.

## Why the visitor path never touches PostgreSQL

The anonymous submission path is the one that absorbs a traffic spike, so it
uses DynamoDB only:

- The public link resolves through a `USERNAME#<name>` item in DynamoDB
  (`directory.ts`), not a SQL query.
- Grouping is driven by the DynamoDB stream after the response is sent, not
  inline during the request.

PostgreSQL is reached only by signed-in owners. That is what makes an Aurora
cluster with a floor of 0 ACU workable: the 10-15 second resume after a pause
is paid by an owner opening their inbox, never by a visitor tapping the link
from a story.

## First deploy

1. **Secure the account.** Turn on MFA for the root user, then create an
   admin user in IAM Identity Center and stop using root.

2. **Install the tools.**

       brew install awscli terraform
       aws configure sso          # profile name: tod
       export AWS_PROFILE=tod
       aws sts get-caller-identity

3. **Set your variables.**

       cp infra/terraform.tfvars.example infra/terraform.tfvars
       # edit: region, alert_email, monthly_budget_usd

4. **Deploy.**

       ./deploy.sh

   The script creates the registry, builds and pushes both arm64 images,
   applies the infrastructure, runs migrations, and publishes the site. It
   prints the URL when it finishes. Re-running it is safe.

The first run takes 15-25 minutes, mostly Aurora provisioning and the initial
image push.

## Deploying a change

    ./deploy.sh

Code, infrastructure and site are all brought up to date. Run migrations by
hand only if you changed the schema outside a deploy:

    aws lambda invoke --function-name tod-migrate /dev/stdout

## Cost controls that are already in place

- `api_reserved_concurrency` (default 50) is the hard ceiling. Requests past
  it are throttled rather than billed. This is the setting that actually caps
  a runaway bill; raise it deliberately.
- A monthly budget with alerts at 50/80/100% plus a forecast alert. Alerts
  only — they do not stop spending.
- CloudWatch alarms for API throttling, API errors, and grouping falling
  behind the stream.
- Log groups created with 14-day retention, because a log group Lambda makes
  for itself never expires.
- An ECR lifecycle policy keeping the last 10 images.

There is deliberately **no NAT gateway**. It would cost around $32 a month
before any traffic. DynamoDB is reached through a free gateway endpoint, and
the embedding model is baked into the grouping image so that function needs no
internet access at runtime.

## Adding your own domain

A Route 53 hosted zone is $0.50/month and a domain is $10-15/year; the
CloudFront default domain costs nothing. To switch:

1. Request an ACM certificate **in us-east-1** — CloudFront only reads from
   that region, wherever the rest of the stack lives.
2. Add `aliases` and the certificate to `aws_cloudfront_distribution.main`.
3. Point an A/AAAA alias record at the distribution.
4. Re-run `./deploy.sh`; it sets `WEB_ORIGIN` from the distribution.

## Tearing it down

    terraform -chdir=infra destroy

The DynamoDB table has `prevent_destroy` and Aurora has deletion protection
and takes a final snapshot. Remove those guards deliberately, not to make an
error message go away.
