import { createSchema } from "./schema.js";

// Aurora sits in a private subnet with no public endpoint, so migrations run
// from inside the VPC. Invoke this manually after a deploy that changes the
// schema; it is not wired to any trigger.
export const handler = async () => {
  await createSchema();
  return { ok: true, message: "Schema is up to date." };
};
