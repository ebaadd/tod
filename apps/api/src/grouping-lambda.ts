import { unmarshall } from "@aws-sdk/util-dynamodb";
import { pg } from "./storage.js";
import { ingestSubmission } from "./groups.js";
import { cleanupExpired, groupPending } from "./grouping.js";

type StreamRecord = {
  eventID: string;
  eventName: string;
  dynamodb?: { NewImage?: Record<string, any> };
};

let lastCleanup = 0;

// Triggered by the DynamoDB stream on the submissions table. Grouping is
// deliberately off the request path: a visitor's POST returns as soon as the
// submission is durable in DynamoDB, and this runs afterwards. That keeps
// PostgreSQL out of the anonymous path that has to absorb traffic spikes.
export const handler = async (event: { Records: StreamRecord[] }) => {
  const failures: { itemIdentifier: string }[] = [];

  const inserts = event.Records.filter(
    record => record.eventName === "INSERT" && record.dynamodb?.NewImage
  );

  for (const record of inserts) {
    try {
      const item = unmarshall(record.dynamodb!.NewImage as any);
      // The table also holds username directory entries and other non
      // submission rows; ingestSubmission ignores anything unsuitable.
      await ingestSubmission(item);
    } catch (error) {
      console.error(
        "Ingest failed:",
        error instanceof Error ? error.name : "UnknownError"
      );
      failures.push({ itemIdentifier: record.eventID });
    }
  }

  const connection = await pg.connect();
  try {
    await groupPending(connection);

    if (Date.now() - lastCleanup > 3600000) {
      await cleanupExpired(connection);
      lastCleanup = Date.now();
    }
  } catch (error) {
    // Grouping is retried from the pending queue on the next event, so a
    // failure here must not re-drive records that were ingested cleanly.
    console.error(
      "Grouping paused after an error:",
      error instanceof Error ? error.name : "UnknownError"
    );
  } finally {
    connection.release();
  }

  return { batchItemFailures: failures };
};
