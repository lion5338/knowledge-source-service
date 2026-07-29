import fs from "fs/promises";
import path from "path";
import { migrationsDir } from "../lib/paths.mjs";
import { withClient } from "../lib/db.mjs";

const files = (await fs.readdir(migrationsDir))
  .filter((file) => file.endsWith(".sql"))
  .sort();

await withClient(async (client) => {
  await client.query("BEGIN");
  try {
    for (const file of files) {
      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      await client.query(sql);
      console.log(`Applied migration: ${file}`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
});
