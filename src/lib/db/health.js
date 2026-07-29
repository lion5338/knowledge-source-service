import { withClient } from "./pool.js";

export async function checkDatabase() {
  try {
    await withClient((client) => client.query("SELECT 1"));
    return { status: "ok" };
  } catch (error) {
    return { status: "error", message: error.message };
  }
}
