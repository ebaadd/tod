import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

export const env = z.object({
  PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  AWS_REGION: z.string().default("us-east-1"),
  DYNAMODB_ENDPOINT: z.string().url().optional(),
  DYNAMODB_TABLE: z.string().min(1),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  SESSION_DAYS: z.coerce.number().int().positive().default(30),

  // Lambda runs one request per instance, so a large pool only multiplies
  // idle connections against a database that accepts a few dozen.
  PG_POOL_MAX: z.coerce.number().int().positive().default(2),
  // Path to the RDS certificate bundle. Unset means no TLS (local Docker).
  PG_CA_BUNDLE: z.string().optional(),
  // Shared secret CloudFront attaches as a custom origin header. When set,
  // requests without it are rejected, so the public Function URL is unusable
  // on its own. Unset locally.
  EDGE_SECRET: z.string().optional()
}).parse(process.env);

const ssl = env.PG_CA_BUNDLE
  ? { ca: readFileSync(env.PG_CA_BUNDLE, "utf8"), rejectUnauthorized: true }
  : undefined;

// The Pool constructor opens no sockets, so importing this module does not
// wake a paused Aurora cluster. Connections are made on first query only.
export const pg = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.PG_POOL_MAX,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 20000,
  ...(ssl ? { ssl } : {})
});

// A paused serverless cluster refuses connections while it resumes. Swallowing
// the error keeps one failed checkout from taking down the whole process.
pg.on("error", () => {});

export const client = new DynamoDBClient({
  region: env.AWS_REGION,
  maxAttempts: 4,
  ...(env.DYNAMODB_ENDPOINT ? {
    endpoint: env.DYNAMODB_ENDPOINT,
    credentials: {
      accessKeyId: "local",
      secretAccessKey: "local"
    }
  } : {})
});

export const db = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true }
});

export const table = env.DYNAMODB_TABLE;
