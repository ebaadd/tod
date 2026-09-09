import { initializeGroups } from "./groups.js";
import { pg, client } from "./storage.js";

initializeGroups()
  .then(() => console.log("Grouping schema ready."))
  .catch(error => {
    console.error("Grouping setup failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pg.end();
    client.destroy();
  });
