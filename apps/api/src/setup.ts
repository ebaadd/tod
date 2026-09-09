import {
  CreateTableCommand,
  DescribeTableCommand,
  DescribeTimeToLiveCommand,
  UpdateTimeToLiveCommand,
  waitUntilTableExists
} from "@aws-sdk/client-dynamodb";
import { pg, client, table } from "./storage.js";

async function main() {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id uuid PRIMARY KEY,
      name varchar(80) NOT NULL,
      username varchar(30) NOT NULL UNIQUE,
      email varchar(254) NOT NULL UNIQUE,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash char(64) PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_expiry_idx
      ON sessions(expires_at);
  `);

  try {
    await client.send(new DescribeTableCommand({ TableName: table }));
  } catch (error) {
    if ((error as Error).name !== "ResourceNotFoundException") throw error;

    await client.send(new CreateTableCommand({
      TableName: table,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
        { AttributeName: "hpk", AttributeType: "S" },
        { AttributeName: "hsk", AttributeType: "S" }
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" }
      ],
      GlobalSecondaryIndexes: [{
        IndexName: "history",
        KeySchema: [
          { AttributeName: "hpk", KeyType: "HASH" },
          { AttributeName: "hsk", KeyType: "RANGE" }
        ],
        Projection: { ProjectionType: "ALL" }
      }]
    }));

    await waitUntilTableExists(
      { client, maxWaitTime: 60 },
      { TableName: table }
    );
  }

  const ttl = await client.send(new DescribeTimeToLiveCommand({
    TableName: table
  }));

  if (ttl.TimeToLiveDescription?.TimeToLiveStatus === "DISABLED") {
    await client.send(new UpdateTimeToLiveCommand({
      TableName: table,
      TimeToLiveSpecification: {
        AttributeName: "expiresAt",
        Enabled: true
      }
    }));
  }

  console.log("Database setup complete.");
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pg.end();
    client.destroy();
  });
