import { constants } from "node:fs";
import fs from "node:fs/promises";

export async function checkWritableDirectoryReady(root, fileSystem = fs) {
  try {
    await fileSystem.mkdir(root, { recursive: true });
    await fileSystem.access(root, constants.W_OK | constants.X_OK);
    return { status: "ok" };
  } catch (error) {
    return { status: "error", message: error.message };
  }
}
