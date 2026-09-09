import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { db, pg, table } from "./storage.js";

export type Owner = { id: string; username: string };

// Accounts live in PostgreSQL, but the public link is opened by anonymous
// visitors and is the one path that has to survive a traffic spike. Mirroring
// username -> owner id into DynamoDB keeps that path off the SQL database
// entirely, so Postgres only wakes for signed-in owners.

const directoryKey = (username: string) => ({
  pk: `USERNAME#${username}`,
  sk: "DIRECTORY"
});

export async function publishOwner(owner: Owner) {
  await db.send(new PutCommand({
    TableName: table,
    Item: {
      ...directoryKey(owner.username),
      ownerId: owner.id,
      username: owner.username
    }
  }));
}

export async function lookupOwner(username: string): Promise<Owner | null> {
  const cached = await db.send(new GetCommand({
    TableName: table,
    Key: directoryKey(username)
  }));

  if (cached.Item) {
    return { id: cached.Item.ownerId, username: cached.Item.username };
  }

  // Miss means signup wrote to Postgres but not yet to DynamoDB. Fall back
  // once, then repair the entry so the next visitor is served from DynamoDB.
  const result = await pg.query(
    "SELECT id, username FROM accounts WHERE username = $1",
    [username]
  );
  const row = result.rows[0] as Owner | undefined;
  if (!row) return null;

  await publishOwner(row).catch(() => {});
  return row;
}
