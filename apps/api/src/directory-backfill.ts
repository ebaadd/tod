import { pg, client } from "./storage.js";
import { publishOwner } from "./directory.js";

// Publishes every existing account's public link into DynamoDB. Run once after
// upgrading; new signups publish themselves.
async function main() {
  const result = await pg.query("SELECT id, username FROM accounts");

  for (const row of result.rows) {
    await publishOwner({ id: row.id, username: row.username });
  }

  console.log(`Published ${result.rowCount} public links to DynamoDB.`);
}

main()
  .catch(error => {
    console.error("Directory backfill failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pg.end();
    client.destroy();
  });
