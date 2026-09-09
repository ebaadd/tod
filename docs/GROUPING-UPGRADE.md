# Grouping and sticker upgrade

Grouping collapses submissions that mean the same thing into one inbox row,
with the original wordings available underneath.

Run from the project root:

    npm install
    npm run setup
    npm run dev

Keep Docker running: the starter's DynamoDB Local runs in memory.

## How it runs

- **Locally**, `npm run dev` starts a polling worker (`groups-worker.ts`).
- **In AWS**, the DynamoDB stream invokes a Lambda (`grouping-lambda.ts`).
  There is no long-running process, so nothing bills while the app is idle.

Both call the same code in `grouping.ts`, so behaviour is identical.

Submissions are embedded locally by default; nothing is sent to a hosted
inference API. Set `EMBEDDING_PROVIDER=bedrock` to call Amazon Bedrock
instead, but note that a function in a private subnet then needs a Bedrock
interface endpoint or a NAT gateway, both of which bill by the hour.

## Similarity threshold

`GROUP_SIMILARITY_THRESHOLD` defaults to **0.62**. Measured on this model
with realistic truth-or-dare phrasings:

| Case | Cosine similarity | Groups at 0.62 |
| --- | --- | --- |
| English paraphrases | 0.68 – 0.92 | yes |
| Devanagari vs English | 0.72 – 0.98 | yes |
| Unrelated questions | up to 0.32 | no |

Worked example — these three collapse into one row:

    What is your biggest fear in life?
    Tell me the thing that scares you the most
    What are you most afraid of?

while `Do 20 pushups right now` stays separate.

Raising the threshold splits genuine duplicates across rows; lowering it
starts merging unrelated questions. Changes affect new processing only, not
existing groups.

## Romanized Hinglish does not group reliably

The model handles Hindi in Devanagari well, but romanized Hinglish is outside
its training distribution and same-meaning pairs are not separable from
unrelated ones:

| Pair | Similarity |
| --- | --- |
| `Apna first crush batao` ~ `Tumhara pehla crush kaun tha` (same) | 0.34 |
| `Ek gaana gaake video daalo` ~ `Kitne paise hai account me` (unrelated) | 0.32 |

Two pairs that mean opposite things score within 0.02 of each other, so no
threshold separates them. Cross-script pairs are worse:
`Tumhara sabse bada darr kya hai` against `What is your biggest fear?` scores
**-0.035**, below unrelated English text.

Verbatim Hinglish repeats still collapse, because the exact normalized-text
path in `grouping.ts` runs before any embedding. If reworded Hinglish grouping
matters for your audience, it needs a different model — evaluate an
IndicBERT-family encoder or transliterate to Devanagari before embedding.

## Other limitations

- This is an MVP, not a production-scale grouping architecture.
- PostgreSQL stores a derived copy of submission text.
- DynamoDB and PostgreSQL writes are not a cross-database transaction.
- Candidate embeddings are compared without an ANN index.
- Refresh the inbox after background grouping; pagination may shift while
  groups merge.
- Strict derived-data deletion and production reconciliation remain needed.
- Direct placement in Instagram Stories is not guaranteed.
- Owner media is never uploaded; stickers are generated in the browser.

## Optional settings

    EMBEDDING_PROVIDER=local        # or: bedrock
    GROUP_SIMILARITY_THRESHOLD=0.62
    MODEL_CACHE_DIR=.cache/models
