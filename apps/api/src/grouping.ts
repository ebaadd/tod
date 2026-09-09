import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { embeddings } from "./embeddings.js";

// Measured on this model with real truth-or-dare phrasings:
//   English paraphrases      0.68 - 0.92
//   Devanagari vs English    0.72 - 0.98
//   unrelated questions      up to 0.32
// 0.62 sits in that gap. The previous 0.90 grouped only near-identical text,
// which meant reworded duplicates showed up as separate inbox rows.
const threshold = Number(process.env.GROUP_SIMILARITY_THRESHOLD ?? "0.62");

if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
  throw new Error("GROUP_SIMILARITY_THRESHOLD must be between 0 and 1.");
}

export { threshold };

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

// Assigns one pending submission to a group. Shared by the local dev worker
// and the deployed Lambda so both behave identically.
async function assign(connection: PoolClient, item: Record<string, any>) {
  const provider = embeddings();

  // Exact normalized repeats need no model inference. In a truth-or-dare
  // inbox most duplicates are verbatim, so this handles the common case
  // without ever loading the embedding model.
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
  `, [item.owner_id, item.kind, item.normalized_text, provider.modelVersion]);

  if (exact.rows[0]) {
    await connection.query(`
      UPDATE grouped_submissions
      SET group_id = $1
      WHERE id = $2 AND group_id IS NULL
    `, [exact.rows[0].group_id, item.id]);
    return;
  }

  const vector = await provider.embed(item.original_text);

  const candidates = await connection.query(`
    SELECT id, embedding
    FROM semantic_groups
    WHERE owner_id = $1 AND kind = $2 AND model_version = $3
  `, [item.owner_id, item.kind, provider.modelVersion]);

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
          id, owner_id, kind, representative_text, embedding, model_version
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      `, [
        selected,
        item.owner_id,
        item.kind,
        item.original_text,
        JSON.stringify(vector),
        provider.modelVersion
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
}

// Groups up to `limit` pending submissions. Returns how many were handled so
// callers can keep going while work remains.
export async function groupPending(connection: PoolClient, limit = 25) {
  let handled = 0;

  while (handled < limit) {
    const pending = await connection.query(`
      SELECT *
      FROM grouped_submissions
      WHERE group_id IS NULL AND expires_at > now()
      ORDER BY created_at, id
      LIMIT 1
    `);

    const item = pending.rows[0];
    if (!item) break;

    await assign(connection, item);
    handled++;
  }

  return handled;
}

// Retention reconciliation. Cheap enough to run alongside grouping rather
// than needing a separate scheduled job.
export async function cleanupExpired(connection: PoolClient) {
  await connection.query(
    "DELETE FROM grouped_submissions WHERE expires_at <= now()"
  );
  await connection.query(`
    DELETE FROM semantic_groups g
    WHERE NOT EXISTS (
      SELECT 1 FROM grouped_submissions s WHERE s.group_id = g.id
    )
  `);
  await connection.query("DELETE FROM sessions WHERE expires_at <= now()");
}
