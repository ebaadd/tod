import { pg, client as dynamoClient } from "./storage.js";
import { cleanupExpired, groupPending, threshold } from "./grouping.js";

// Local development only. In AWS this same work is driven by the DynamoDB
// stream through grouping-lambda.ts, so there is no long-running process and
// nothing bills while the app is idle.

let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { stopping = true; });
}

const delay = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms));

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
          await cleanupExpired(connection);
          lastCleanup = Date.now();
        }

        const handled = await groupPending(connection, 25);
        if (!handled) await delay(1500);
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
