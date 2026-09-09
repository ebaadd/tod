import {
  CreateTableCommand,
  DescribeTableCommand,
  DescribeTimeToLiveCommand,
  UpdateTableCommand,
  UpdateTimeToLiveCommand,
  waitUntilTableExists
} from "@aws-sdk/client-dynamodb";
import { pg, client, table } from "./storage.js";
import { createSchema } from "./schema.js";

// Grouping is driven by this stream in AWS. NEW_IMAGE carries the whole
// submission, so the handler needs no follow-up read.
const STREAM = {
  StreamEnabled: true,
  StreamViewType: "NEW_IMAGE" as const
};

async function main() {
  await createSchema();

  let exists = true;
  try {
    const described = await client.send(
      new DescribeTableCommand({ TableName: table })
    );

    // Enable the stream on a table that predates it.
    if (!described.Table?.StreamSpecification?.StreamEnabled) {
      await client.send(new UpdateTableCommand({
        TableName: table,
        StreamSpecification: STREAM
      })).catch(() => {
        console.warn("Could not enable the stream. DynamoDB Local ignores it.");
      });
    }
  } catch (error) {
    exists = false;
    if ((error as Error).name !== "ResourceNotFoundException") throw error;

    await client.send(new CreateTableCommand({
      TableName: table,
      BillingMode: "PAY_PER_REQUEST",
      StreamSpecification: STREAM,
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

  console.log(
    exists
      ? "Database setup complete. Existing table reused."
      : "Database setup complete. Table created."
  );
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
