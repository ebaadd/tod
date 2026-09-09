import { ingestSubmission, registerGroupRoutes } from "./groups.js";
import Fastify, {
  type FastifyError,
  type FastifyRequest,
  type FastifyReply
} from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import argon2 from "argon2";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  PutCommand,
  QueryCommand,
  UpdateCommand,
  GetCommand
} from "@aws-sdk/lib-dynamodb";
import { env, pg, db, client, table } from "./storage.js";
import { lookupOwner, publishOwner } from "./directory.js";

const app = Fastify({
  logger: true,
  disableRequestLogging: true,
  bodyLimit: 16384
});

await app.register(cookie);
await app.register(cors, {
  origin: env.WEB_ORIGIN,
  credentials: true,
  methods: ["GET", "POST", "DELETE"]
});
await app.register(rateLimit, {
  max: 120,
  timeWindow: "1 minute"
});

const secure = env.COOKIE_SECURE === "true";
const AUTH = secure ? "__Host-tod_auth" : "tod_auth";
const VISITOR = secure ? "__Host-tod_visitor" : "tod_visitor";
const cookieOptions = {
  path: "/",
  httpOnly: true,
  secure,
  sameSite: "lax" as const
};

const seconds = () => Math.floor(Date.now() / 1000);
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const randomToken = () => randomBytes(32).toString("base64url");

class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

app.setErrorHandler((error: FastifyError, _request, reply) => {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({
      error: error.issues[0]?.message ?? "Invalid request."
    });
  }
  if ((error as { code?: string }).code === "23505") {
    return reply.code(409).send({
      error: "Email or username is already registered."
    });
  }
  const status = error.statusCode ?? 500;
  if (status >= 500) {
    app.log.error({ errorType: error.name }, "Request failed");
  }
  return reply.code(status).send({
    error: status >= 500 ? "Something went wrong." : error.message
  });
});

app.addHook("onRequest", async (request, reply) => {
  // The Lambda Function URL is publicly reachable. CloudFront attaches this
  // header, so anything arriving without it bypassed the CDN and its throttles.
  if (env.EDGE_SECRET && request.headers["x-tod-edge"] !== env.EDGE_SECRET) {
    throw new HttpError(403, "Request did not come through the CDN.");
  }
  reply.header("Cache-Control", "no-store");
  reply.header("X-Content-Type-Options", "nosniff");
  if (["POST", "DELETE", "PUT", "PATCH"].includes(request.method)) {
    if (request.headers.origin !== env.WEB_ORIGIN) {
      throw new HttpError(403, "Request origin is not allowed.");
    }
  }
});

const username = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9_]{3,30}$/, "Username needs 3–30 letters, numbers or underscores.");
const kind = z.enum(["truth", "dare"]);
const keySchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T[\d:.]+Z#[0-9a-f-]{36}$/
);

function rawCookie(request: FastifyRequest, name: string) {
  const value = request.cookies[name];
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

function visitor(request: FastifyRequest) {
  const raw = rawCookie(request, VISITOR);
  return raw ? digest(raw) : null;
}

async function owner(request: FastifyRequest) {
  const name = username.parse(
    (request.params as { username: string }).username
  );
  const found = await lookupOwner(name);
  if (!found) throw new HttpError(404, "This link does not exist.");
  return found;
}

async function issueSession(reply: FastifyReply, id: string) {
  const token = randomToken();
  await pg.query(
    `INSERT INTO sessions(token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + ($3::int * interval '1 day'))`,
    [digest(token), id, env.SESSION_DAYS]
  );
  reply.setCookie(AUTH, token, {
    ...cookieOptions,
    maxAge: env.SESSION_DAYS * 86400
  });
}

async function auth(request: FastifyRequest, reply: FastifyReply) {
  const raw = rawCookie(request, AUTH);
  if (!raw) throw new HttpError(401, "Please sign in.");

  const result = await pg.query(
    `SELECT a.id, a.name, a.username
     FROM accounts a JOIN sessions s ON a.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [digest(raw)]
  );

  if (!result.rows[0]) {
    reply.clearCookie(AUTH, cookieOptions);
    throw new HttpError(401, "Please sign in.");
  }

  const renewed = await pg.query(
    `UPDATE sessions
     SET expires_at = now() + ($2::int * interval '1 day')
     WHERE token_hash = $1
       AND expires_at < now() + ($2::int * interval '12 hours')
     RETURNING token_hash`,
    [digest(raw), env.SESSION_DAYS]
  );
  if (renewed.rowCount) {
    reply.setCookie(AUTH, raw, {
      ...cookieOptions,
      maxAge: env.SESSION_DAYS * 86400
    });
  }
  return result.rows[0] as { id: string; name: string; username: string };
}

function publicItem(item: Record<string, any>) {
  return {
    id: item.id,
    key: item.sk,
    kind: item.kind,
    text: item.text,
    createdAt: item.createdAt
  };
}

const hpk = (visitorHash: string, ownerId: string) =>
  `VISITOR#${visitorHash}#OWNER#${ownerId}`;

app.get("/health/live", async () => ({ ok: true }));
// Checks only DynamoDB by default. A health check that touched PostgreSQL on
// every call would hold a paused serverless cluster awake around the clock and
// bill for it, so the SQL probe is opt-in via ?deep=1.
app.get("/health/ready", async request => {
  await db.send(new GetCommand({
    TableName: table,
    Key: { pk: "HEALTH", sk: "HEALTH" }
  }));

  if ((request.query as { deep?: string }).deep === "1") {
    await pg.query("SELECT 1");
    return { ok: true, deep: true };
  }

  return { ok: true };
});

app.post("/auth/signup", {
  config: { rateLimit: { max: 5, timeWindow: "1 minute" } }
}, async (request, reply) => {
  const input = z.object({
    name: z.string().trim().min(1).max(80),
    username,
    email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
    password: z.string().min(10).max(128)
  }).parse(request.body);

  const id = randomUUID();
  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id
  });

  await pg.query(
    `INSERT INTO accounts(id, name, username, email, password_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, input.name, input.username, input.email, passwordHash]
  );
  // Publish the public link into DynamoDB so anonymous visitors resolve the
  // username without touching PostgreSQL. lookupOwner repairs this if it fails.
  await publishOwner({ id, username: input.username }).catch(() => {});

  await issueSession(reply, id);
  return reply.code(201).send({ ok: true });
});

// Verified against a fixed hash when the email is unknown, so a failed login
// costs the same time whether or not the account exists. Generated once with
// the same parameters argon2.hash uses, so the timings match. Not a secret.
const dummyHash =
  "$argon2id$v=19$m=65536,t=3,p=4$gyznu7qYCLOzG2ty/OH+zA$" +
  "ycxww+6Uy3gf7k9TWAaQ6h3I/Fclc314fudTUR5RiFM";

app.post("/auth/login", {
  config: { rateLimit: { max: 10, timeWindow: "1 minute" } }
}, async (request, reply) => {
  const input = z.object({
    email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
    password: z.string().min(1).max(128)
  }).parse(request.body);

  const result = await pg.query(
    "SELECT id, password_hash FROM accounts WHERE email = $1",
    [input.email]
  );
  const account = result.rows[0];
  const valid = await argon2.verify(
    account?.password_hash ?? dummyHash,
    input.password
  );
  if (!account || !valid) {
    throw new HttpError(401, "Incorrect email or password.");
  }

  await issueSession(reply, account.id);
  return { ok: true };
});

app.get("/auth/me", async (request, reply) => ({
  user: await auth(request, reply)
}));

app.post("/auth/logout", async (request, reply) => {
  const raw = rawCookie(request, AUTH);
  if (raw) {
    await pg.query("DELETE FROM sessions WHERE token_hash = $1", [digest(raw)]);
  }
  reply.clearCookie(AUTH, cookieOptions);
  return { ok: true };
});

app.post("/visitor/remember", async (request, reply) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
  if (enabled) {
    reply.setCookie(
      VISITOR,
      rawCookie(request, VISITOR) ?? randomToken(),
      { ...cookieOptions, maxAge: env.RETENTION_DAYS * 86400 }
    );
  } else {
    reply.clearCookie(VISITOR, cookieOptions);
  }
  return { ok: true };
});

app.get("/public/:username", async request => ({
  username: (await owner(request)).username,
  remembering: Boolean(visitor(request))
}));

app.post("/public/:username/submissions", {
  config: { rateLimit: { max: 15, timeWindow: "1 minute" } }
}, async (request, reply) => {
  const recipient = await owner(request);
  const input = z.object({
    kind,
    text: z.string().trim().min(1).max(500),
    requestId: z.string().uuid(),
    requestedAt: z.string().datetime()
  }).parse(request.body);

  const createdAt = new Date(input.requestedAt).toISOString();
  if (Math.abs(Date.now() - Date.parse(createdAt)) > 600000) {
    throw new HttpError(400, "Please refresh and try again.");
  }

  const visitorHash = visitor(request);
  const item = {
    pk: `OWNER#${recipient.id}#${input.kind}`,
    sk: `${createdAt}#${input.requestId}`,
    id: input.requestId,
    ownerId: recipient.id,
    kind: input.kind,
    text: input.text,
    createdAt,
    receivedAt: new Date().toISOString(),
    expiresAt: seconds() + env.RETENTION_DAYS * 86400,
    groupingStatus: "pending",
    hpk: visitorHash ? hpk(visitorHash, recipient.id) : undefined,
    hsk: visitorHash ? `${createdAt}#${input.requestId}` : undefined
  };

  try {
    await db.send(new PutCommand({
      TableName: table,
      Item: item,
      ConditionExpression: "attribute_not_exists(pk)"
    }));
  } catch (error) {
    if ((error as Error).name !== "ConditionalCheckFailedException") throw error;
    const existing = await db.send(new GetCommand({
      TableName: table,
      Key: { pk: item.pk, sk: item.sk },
      ConsistentRead: true
    }));
    if (!existing.Item ||
        existing.Item.text !== item.text ||
        existing.Item.hpk !== item.hpk) {
      throw new HttpError(409, "Request ID conflict. Refresh and try again.");
    }
  }

  // In AWS the DynamoDB stream drives grouping, so the visitor's request
  // returns as soon as the submission is durable and a traffic spike never
  // queues behind PostgreSQL. Local development has no stream consumer, so
  // the ingest happens inline there to keep the dev loop identical.
  if (process.env.RUN_LOCAL === "true") {
    await ingestSubmission(item);
  }

  return reply.code(201).send({ submission: publicItem(item) });
});

app.get("/public/:username/history", async request => {
  const recipient = await owner(request);
  const visitorHash = visitor(request);
  if (!visitorHash) return { items: [], cursor: null };

  const query = z.object({
    cursor: keySchema.optional(),
    cursorKind: kind.optional()
  }).parse(request.query);
  if (query.cursor && !query.cursorKind) {
    throw new HttpError(400, "Invalid cursor.");
  }

  const historyPk = hpk(visitorHash, recipient.id);
  const result = await db.send(new QueryCommand({
    TableName: table,
    IndexName: "history",
    KeyConditionExpression: "hpk = :pk",
    FilterExpression: "expiresAt > :now",
    ExpressionAttributeValues: { ":pk": historyPk, ":now": seconds() },
    ScanIndexForward: false,
    Limit: 30,
    ExclusiveStartKey: query.cursor ? {
      pk: `OWNER#${recipient.id}#${query.cursorKind}`,
      sk: query.cursor,
      hpk: historyPk,
      hsk: query.cursor
    } : undefined
  }));

  const last = result.LastEvaluatedKey;
  return {
    items: (result.Items ?? []).map(publicItem),
    cursor: last ? {
      key: last.sk,
      kind: String(last.pk).split("#").at(-1)
    } : null
  };
});

app.delete("/public/:username/history", async request => {
  const recipient = await owner(request);
  const visitorHash = visitor(request);
  if (!visitorHash) throw new HttpError(401, "No remembered history.");

  const input = z.object({ key: keySchema, kind }).parse(request.body);
  try {
    await db.send(new UpdateCommand({
      TableName: table,
      Key: {
        pk: `OWNER#${recipient.id}#${input.kind}`,
        sk: input.key
      },
      UpdateExpression: "REMOVE hpk, hsk",
      ConditionExpression: "hpk = :pk",
      ExpressionAttributeValues: {
        ":pk": hpk(visitorHash, recipient.id)
      }
    }));
  } catch (error) {
    if ((error as Error).name !== "ConditionalCheckFailedException") throw error;
  }
  return { ok: true };
});

app.get("/inbox", async (request, reply) => {
  const user = await auth(request, reply);
  const query = z.object({
    kind: kind.default("truth"),
    cursor: keySchema.optional()
  }).parse(request.query);
  const pk = `OWNER#${user.id}#${query.kind}`;

  const result = await db.send(new QueryCommand({
    TableName: table,
    KeyConditionExpression: "pk = :pk",
    FilterExpression: "expiresAt > :now",
    ExpressionAttributeValues: { ":pk": pk, ":now": seconds() },
    ScanIndexForward: false,
    ConsistentRead: true,
    Limit: 30,
    ExclusiveStartKey: query.cursor ? { pk, sk: query.cursor } : undefined
  }));

  return {
    items: (result.Items ?? []).map(publicItem),
    cursor: result.LastEvaluatedKey?.sk ?? null
  };
});

await registerGroupRoutes(app, auth);

export { app };

// On Lambda the container is frozen between invocations rather than shut down,
// so tearing the pool down on a signal would close connections that are still
// reusable. Only the local server owns its lifecycle.
if (process.env.RUN_LOCAL === "true") {
  app.addHook("onClose", async () => {
    await pg.end();
    client.destroy();
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      app.close().catch(() => { process.exitCode = 1; });
    });
  }

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}
