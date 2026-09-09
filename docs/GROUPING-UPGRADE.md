# Grouping and sticker upgrade

Run from the project root:

    npm install
    npm run groups:setup
    npm run groups:backfill
    npm run dev

Keep Docker running: the starter's DynamoDB Local runs in memory.

The worker downloads a multilingual embedding model on first use.
Submissions are processed locally, not sent to a hosted inference API.

Features:
- Responsive row-based inbox.
- Background semantic grouping.
- Expandable original variants.
- Browser-generated transparent PNG stickers.
- Native image sharing where supported.

Limitations:
- This is an MVP, not a production-scale grouping architecture.
- PostgreSQL stores a derived copy of submission text.
- DynamoDB and PostgreSQL writes are not a cross-database transaction.
- Backfill repairs missing index entries and scans the DynamoDB table.
- One grouping worker runs at a time.
- Candidate embeddings are compared without an ANN index.
- English/Hindi/Hinglish matching requires evaluation.
- Refresh the inbox after background grouping.
- Pagination may shift while groups merge.
- Strict derived-data deletion and production reconciliation remain needed.
- Direct placement in Instagram Stories is not guaranteed.
- Owner media is never uploaded.

Optional API environment settings:

    GROUP_SIMILARITY_THRESHOLD=0.90
    MODEL_CACHE_DIR=.cache/models

Changing the threshold affects new processing, not existing groups.
