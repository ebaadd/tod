# TOD starter

Mobile-first anonymous Truth or Dare.

## Requirements

- Node.js 22 or newer
- npm
- Docker with Docker Compose

## Start

The generator creates local `.env` files automatically.

```bash
docker compose up -d
npm install
npm run setup
npm run dev
```

To deploy to AWS, see [docs/DEPLOY.md](docs/DEPLOY.md).

If setup fails because PostgreSQL is still starting, wait a few seconds
and run `npm run setup` again.

Open http://localhost:3000.

API health:
- http://localhost:4000/health/live
- http://localhost:4000/health/ready

## Included

- Next.js frontend.
- Fastify API.
- PostgreSQL accounts and sessions.
- DynamoDB submissions and browser history.
- Argon2id password hashing.
- Persistent, server-validated owner sessions.
- Optional anonymous visitor cookie.
- Recipient-scoped visitor history.
- Individual history removal.
- Paginated owner inbox.
- Central branding in config/brand.json.
- Input limits, origin checking, basic per-process rate limits.
- 90-day submission expiry field and DynamoDB TTL configuration.
- Health endpoints and minimal safe error logging.
- Semantic grouping of same-meaning submissions, with the original wordings
  kept underneath.
- Browser-generated transparent PNG stickers.
- Terraform for a pay-per-use AWS deployment, with cost guardrails.

## Not included yet

- Password recovery and email verification. A forgotten password currently
  means an unrecoverable account.
- Account and data deletion. Required before real users, under GDPR and the
  DPDP Act.
- Content moderation and a reporting path. An anonymous message box will
  receive abuse; decide how you handle it before launch, not after.
- Bulk history clearing.
- Automated integration/security tests.
- Reliable grouping of romanized Hinglish — see docs/GROUPING-UPGRADE.md.
- Partition sharding for a single very high-volume recipient.
- Ads and dashboards.

This is a starter. It deploys and it is cheap, but the list above stands
between deployed and responsible.

## Local storage behavior

PostgreSQL uses a persistent Docker volume.

DynamoDB Local runs in memory: restarting its container loses local
submissions. Run `npm run setup` again after restarting it.

DynamoDB TTL is configured, but DynamoDB Local does not simulate background
TTL deletion. The API filters expired submissions regardless.

The history GSI is eventually consistent: a refresh immediately after
a write or removal may briefly show stale history.

Removing an item from visitor history does not retract the owner's message.

Turning remembering off removes browser access to its prior history.
It does not delete the previously stored submissions.

## Authentication

Owner authentication and visitor history use separate random tokens.
Only token hashes are stored as identifiers server-side.
Passwords are never sent by email or stored as plaintext.

Owner sessions expire after 30 days and are renewed during activity.

No email verification or password recovery is implemented.
Do not imply that an account's email has been verified.

## AWS deployment

`./deploy.sh` provisions and deploys everything; `infra/` holds the Terraform.
See [docs/DEPLOY.md](docs/DEPLOY.md) for the account setup and the reasoning.

Handled by that configuration:

- One CloudFront distribution serves the site and `/api/*`, so the session
  cookie is same-site and there is no CORS.
- `COOKIE_SECURE=true`, HTTPS only, `WEB_ORIGIN` pinned to the distribution.
- IAM roles rather than embedded credentials, scoped to the table.
- TLS to Aurora verified against Amazon's RDS certificate bundle.
- CloudWatch log retention set to 14 days.
- A budget, alarms, and a Lambda concurrency ceiling.
- No NAT gateway, which would otherwise cost more than the database.

Still on you:

- Rate limiting is per-process, so it is weak on Lambda. Add WAF or a
  DynamoDB-backed limiter before you have real traffic.
- Owner partition keys are MVP keys; one very high-volume recipient needs
  sharding.
- Infrastructure request volume is not exact successful-submission volume.
- Review dependency advisories; commit package-lock.json after install.

## Smoke test

1. Sign up and copy the public link.
2. Open it in a different browser/incognito window.
3. Enable remembering and submit a Truth and a Dare.
4. Refresh and inspect visitor history.
5. Open the owner inbox and check both categories.
6. Remove a visitor history item; verify the owner still sees it.
7. Refresh the dashboard; the owner should remain signed in.
8. Sign out; private API endpoints should require authentication.

## Branding

Change config/brand.json. Restart development servers after changing config.

## Privacy

Anonymous means the recipient is not shown the sender's identity.
Infrastructure can still process network identifiers.
Cookie/history behavior and retention need a privacy notice before launch.
