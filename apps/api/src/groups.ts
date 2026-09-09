import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { z } from "zod";
import { pg } from "./storage.js";

export async function initializeGroups() {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS semantic_groups (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('truth', 'dare')),
      representative_text text NOT NULL,
      embedding jsonb NOT NULL,
      model_version text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS semantic_groups_owner_idx
      ON semantic_groups(owner_id, kind);

    CREATE TABLE IF NOT EXISTS grouped_submissions (
      id uuid PRIMARY KEY,
      source_key text NOT NULL UNIQUE,
      owner_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('truth', 'dare')),
      original_text text NOT NULL,
      normalized_text text NOT NULL,
      group_id uuid REFERENCES semantic_groups(id),
      created_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL
    );

    CREATE INDEX IF NOT EXISTS grouped_submissions_inbox_idx
      ON grouped_submissions(owner_id, kind, created_at DESC);

    CREATE INDEX IF NOT EXISTS grouped_submissions_group_idx
      ON grouped_submissions(group_id);

    CREATE INDEX IF NOT EXISTS grouped_submissions_pending_idx
      ON grouped_submissions(created_at)
      WHERE group_id IS NULL;

    CREATE INDEX IF NOT EXISTS grouped_submissions_expiry_idx
      ON grouped_submissions(expires_at);
  `);
}

export function normalizeText(text: string) {
  // Keep original wording separately. Do not remove negation or translate.
  return text.normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export async function ingestSubmission(item: Record<string, any>) {
  const { randomUUID } = await import("node:crypto");

  if (
    typeof item.text !== "string" ||
    !["truth", "dare"].includes(item.kind) ||
    Number(item.expiresAt) <= Date.now() / 1000
  ) return;

  await pg.query(`
    INSERT INTO grouped_submissions (
      id, source_key, owner_id, kind, original_text,
      normalized_text, created_at, expires_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8))
    ON CONFLICT (source_key) DO NOTHING
  `, [
    randomUUID(),
    JSON.stringify([item.pk, item.sk]),
    item.ownerId,
    item.kind,
    item.text,
    normalizeText(item.text),
    item.createdAt,
    item.expiresAt
  ]);
}

type Authenticate = (
  request: FastifyRequest,
  reply: FastifyReply
) => Promise<{ id: string }>;

export async function registerGroupRoutes(
  app: FastifyInstance,
  authenticate: Authenticate
) {
  app.get("/inbox/groups", async (request, reply) => {
    const user = await authenticate(request, reply);
    const input = z.object({
      kind: z.enum(["truth", "dare"]).default("truth"),
      offset: z.coerce.number().int().min(0).max(1000000).default(0)
    }).parse(request.query);

    const result = await pg.query(`
      WITH visible_groups AS (
        SELECT
          COALESCE(group_id, id) AS display_id,
          COUNT(*)::int AS submission_count,
          MAX(created_at) AS latest_at,
          BOOL_OR(group_id IS NULL) AS processing
        FROM grouped_submissions
        WHERE owner_id = $1
          AND kind = $2
          AND expires_at > now()
        GROUP BY COALESCE(group_id, id)
        ORDER BY MAX(created_at) DESC, COALESCE(group_id, id)
        LIMIT 31 OFFSET $3
      )
      SELECT
        g.*,
        representative.original_text
      FROM visible_groups g
      CROSS JOIN LATERAL (
        SELECT original_text
        FROM grouped_submissions s
        WHERE s.owner_id = $1
          AND s.kind = $2
          AND s.expires_at > now()
          AND COALESCE(s.group_id, s.id) = g.display_id
        ORDER BY s.created_at, s.id
        LIMIT 1
      ) representative
      ORDER BY g.latest_at DESC, g.display_id
    `, [user.id, input.kind, input.offset]);

    return {
      items: result.rows.slice(0, 30).map(row => ({
        id: row.display_id,
        kind: input.kind,
        text: row.original_text,
        count: row.submission_count,
        processing: row.processing,
        latestAt: row.latest_at
      })),
      nextOffset: result.rows.length > 30 ? input.offset + 30 : null
    };
  });

  app.get("/inbox/groups/:id/variants", async (request, reply) => {
    const user = await authenticate(request, reply);
    const id = z.string().uuid().parse(
      (request.params as { id: string }).id
    );
    const input = z.object({
      offset: z.coerce.number().int().min(0).max(1000000).default(0)
    }).parse(request.query);

    const result = await pg.query(`
      SELECT id, original_text, created_at
      FROM grouped_submissions
      WHERE owner_id = $1
        AND COALESCE(group_id, id) = $2
        AND expires_at > now()
      ORDER BY created_at, id
      LIMIT 51 OFFSET $3
    `, [user.id, id, input.offset]);

    return {
      items: result.rows.slice(0, 50).map(row => ({
        id: row.id,
        text: row.original_text,
        createdAt: row.created_at
      })),
      nextOffset: result.rows.length > 50 ? input.offset + 50 : null
    };
  });
}
