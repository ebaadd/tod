import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { db, table, pg, client } from "./storage.js";
import { ingestSubmission } from "./groups.js";

async function main() {
  let cursor: Record<string, any> | undefined;
  let count = 0;

  console.log("Backfilling existing unexpired DynamoDB submissions.");

  do {
    const page = await db.send(new ScanCommand({
      TableName: table,
      ExclusiveStartKey: cursor,
      Limit: 100
    }));

    for (const item of page.Items ?? []) {
      if (Number(item.expiresAt) > Date.now() / 1000) {
        await ingestSubmission(item);
        count++;
      }
    }

    cursor = page.LastEvaluatedKey;
  } while (cursor);

  console.log(`Backfill complete. Examined ${count} unexpired submissions.`);
}

main()
  .catch(error => {
    console.error("Backfill failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pg.end();
    client.destroy();
  });
