#!/usr/bin/env bash
# One-command deploy. Safe to re-run; every step is idempotent.
set -euo pipefail

cd "$(dirname "$0")"
INFRA=infra
# The registry rejects overwriting a tag, so every build gets a unique one.
# That also means a re-run always ships what is on disk, committed or not.
TAG="${1:-$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)}"

command -v terraform >/dev/null || { echo "Install terraform first."; exit 1; }
command -v docker    >/dev/null || { echo "Install docker first."; exit 1; }
command -v aws       >/dev/null || { echo "Install the AWS CLI first."; exit 1; }
aws sts get-caller-identity >/dev/null || { echo "Run 'aws configure sso' first."; exit 1; }
[ -f "$INFRA/terraform.tfvars" ] || {
  echo "Create infra/terraform.tfvars first (copy terraform.tfvars.example)."
  exit 1
}

tf() { terraform -chdir="$INFRA" "$@"; }
out() { tf output -raw "$1"; }

echo "==> [1/7] Initialising Terraform"
tf init -input=false

# The Lambdas cannot be created until an image exists, and the image cannot be
# pushed until the registry exists, so the registry is created on its own first.
echo "==> [2/7] Creating the container registry"
tf apply -input=false -auto-approve -var "image_tag=$TAG" \
  -target=aws_ecr_repository.api -target=aws_ecr_lifecycle_policy.api

REPO=$(out ecr_repository_url)
REGION=$(out region)

echo "==> [3/7] Building and pushing images ($TAG)"
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${REPO%%/*}"

# arm64: Graviton is cheaper per GB-second and Argon2 does not care.
docker build --platform linux/arm64 --target api \
  -f apps/api/Dockerfile -t "$REPO:$TAG-api" .
docker push "$REPO:$TAG-api"

docker build --platform linux/arm64 --target grouping \
  -f apps/api/Dockerfile -t "$REPO:$TAG-grouping" .
docker push "$REPO:$TAG-grouping"

echo "==> [4/7] Applying infrastructure"
tf apply -input=false -auto-approve -var "image_tag=$TAG"

SITE=$(out site_url)

# The API needs the site's origin to validate request origins, but the
# distribution needs the API's URL, so the origin can only be set once the
# distribution exists. This second pass is a no-op on later deploys.
echo "==> [5/7] Pinning the API to $SITE"
tf apply -input=false -auto-approve -var "image_tag=$TAG" -var "web_origin=$SITE"

echo "==> [6/7] Running database migrations"
aws lambda invoke --region "$REGION" \
  --function-name "$(out migrate_function)" \
  --cli-binary-format raw-in-base64-out \
  /dev/stdout

echo "==> [7/7] Publishing the site"
npm run build:prod -w @tod/web
aws s3 sync apps/web/out/ "s3://$(out site_bucket)/" --delete
aws cloudfront create-invalidation \
  --distribution-id "$(out distribution_id)" --paths "/*" >/dev/null

echo
echo "Live at $SITE"
