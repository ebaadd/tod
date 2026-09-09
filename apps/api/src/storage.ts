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
  SESSION_DAYS: z.coerce.number().int().positive().default(30)
}).parse(process.env);

export const pg = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10
});

export const client = new DynamoDBClient({
  region: env.AWS_REGION,
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
