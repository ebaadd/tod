import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  env as transformersEnv,
  pipeline
} from "@huggingface/transformers";
import { pg, client as dynamoClient } from "./storage.js";

const MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const MODEL_VERSION = `${MODEL}:mean:q8:v1`;
const threshold = Number(process.env.GROUP_SIMILARITY_THRESHOLD ?? "0.90");
const cacheDir = resolve(process.env.MODEL_CACHE_DIR ?? ".cache/models");

if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
  throw new Error("GROUP_SIMILARITY_THRESHOLD must be between 0 and 1.");
}

mkdirSync(cacheDir, { recursive: true });
transformersEnv.cacheDir = cacheDir;

let extractor: any;
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { stopping = true; });
}

const delay = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms));

async function embed(text: string): Promise<number[]> {
  if (!extractor) {
    console.log(
      "Loading multilingual embedding model. " +
      "First use downloads model files; later runs use the local cache."
    );

    extractor = await (pipeline as any)("feature-extraction", MODEL, {
      dtype: "q8"
    });

    console.log("Embedding model ready.");
  }

  const result = await extractor(text, {
    pooling: "mean",
    normalize: true
  });

  return Array.from(result.data as ArrayLike<number>);
}

function cosine(a: number[], b: number[]) {
  if (a.length !== b.length) return -1;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
}

async function main() {
  // One worker for this MVP. A dedicated connection holds the advisory lock.
  const connection = await pg.connect();
  const lock = await connection.query(
    "SELECT pg_try_advisory_lock(74190231) AS acquired"
  );

  if (!lock.rows[0].acquired) {
    connection.release();
    throw new Error("Another grouping worker is already running.");
  }

  console.log(`Grouping worker started. Similarity threshold: ${threshold}`);
  let lastCleanup = 0;

  try {
    while (!stopping) {
      try {
        if (Date.now() - lastCleanup > 60000) {
          await connection.query(`
            DELETE FROM grouped_submissions WHERE expires_at <= now()
          `);

          await connection.query(`
            DELETE FROM semantic_groups g
            WHERE NOT EXISTS (
              SELECT 1 FROM grouped_submissions s WHERE s.group_id = g.id
            )
          `);

          await connection.query(`
            DELETE FROM sessions WHERE expires_at <= now()
          `);

          lastCleanup = Date.now();
        }

        const pending = await connection.query(`
          SELECT *
          FROM grouped_submissions
          WHERE group_id IS NULL AND expires_at > now()
          ORDER BY created_at, id
          LIMIT 1
        `);

        const item = pending.rows[0];

        if (!item) {
          await delay(1500);
          continue;
        }

        // Exact normalized repeats need no model inference.
        const exact = await connection.query(`
          SELECT s.group_id
          FROM grouped_submissions s
          JOIN semantic_groups g ON g.id = s.group_id
          WHERE s.owner_id = $1
            AND s.kind = $2
            AND s.normalized_text = $3
            AND s.expires_at > now()
            AND g.model_version = $4
          LIMIT 1
        `, [
          item.owner_id,
          item.kind,
          item.normalized_text,
          MODEL_VERSION
        ]);

        if (exact.rows[0]) {
          await connection.query(`
            UPDATE grouped_submissions
            SET group_id = $1
            WHERE id = $2 AND group_id IS NULL
          `, [exact.rows[0].group_id, item.id]);

          continue;
        }

        const vector = await embed(item.original_text);

        const candidates = await connection.query(`
          SELECT id, embedding
          FROM semantic_groups
          WHERE owner_id = $1 AND kind = $2 AND model_version = $3
        `, [item.owner_id, item.kind, MODEL_VERSION]);

        let selected: string | null = null;
        let best = threshold;

        for (const group of candidates.rows) {
          const score = cosine(vector, group.embedding);
          if (score >= best) {
            selected = group.id;
            best = score;
          }
        }

        await connection.query("BEGIN");
        try {
          if (!selected) {
            selected = randomUUID();
            await connection.query(`
              INSERT INTO semantic_groups (
                id, owner_id, kind, representative_text,
                embedding, model_version
              )
              VALUES ($1, $2, $3, $4, $5::jsonb, $6)
            `, [
              selected,
              item.owner_id,
              item.kind,
              item.original_text,
              JSON.stringify(vector),
              MODEL_VERSION
            ]);
          }

          await connection.query(`
            UPDATE grouped_submissions
            SET group_id = $1
            WHERE id = $2 AND group_id IS NULL AND expires_at > now()
          `, [selected, item.id]);

          await connection.query("COMMIT");
        } catch (error) {
          await connection.query("ROLLBACK");
          throw error;
        }
      } catch (error) {
        // No question text, tokens, or SQL values in worker logs.
        console.error(
          "Grouping paused after an error:",
          error instanceof Error ? error.name : "UnknownError",
          "Check database availability, model download access and free disk space."
        );
        await delay(10000);
      }
    }
  } finally {
    await connection.query("SELECT pg_advisory_unlock(74190231)");
    connection.release();
  }
}

main()
  .catch(error => {
    console.error("Worker startup failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pg.end();
    dynamoClient.destroy();
  });
