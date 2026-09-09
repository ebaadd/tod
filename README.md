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

## Not included yet

- Semantic grouping and embedding provider.
- Background grouping worker/queue.
- Transparent PNG sticker generation.
- Bulk history clearing.
- Owner deletion, account deletion and password recovery.
- Session cleanup job and full retention reconciliation.
- Automated integration/security tests.
- Production containers, AWS infrastructure, ads and dashboards.

This is a starter, not the completed or production-ready product.

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

## AWS deployment considerations

- Use same-site frontend and API URLs, preferably a same-domain proxy.
- Set COOKIE_SECURE=true and use HTTPS.
- Set WEB_ORIGIN to the exact frontend origin.
- Remove DYNAMODB_ENDPOINT to use AWS DynamoDB.
- Use IAM roles, not embedded AWS credentials.
- Configure PostgreSQL TLS appropriate to your RDS deployment.
- Use infrastructure-as-code for the production DynamoDB table.
- Current owner keys are MVP keys; high-volume recipients require a
  partition-sharding strategy.
- Add distributed rate limiting or WAF before running multiple API replicas.
- Do not enable unrestricted proxy trust.
- Set CloudWatch log retention and avoid logging text/cookies.
- Infrastructure request volume is not exact successful-submission volume.
- Add production migrations, tests, deletion flows and cleanup jobs.
- Review dependency security advisories; commit package-lock.json after install.

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
