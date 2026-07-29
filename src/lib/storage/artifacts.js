import fs from "fs/promises";
import path from "path";
import { getServiceConfig } from "../config.js";
import { notFound } from "../http/errors.js";

function projectRoot() {
  return process.cwd();
}

export function storageRoot() {
  return path.resolve(projectRoot(), getServiceConfig().storageRoot);
}

export function resolveStoragePath(storagePath) {
  const root = storageRoot();
  const resolved = path.resolve(root, storagePath);
  if (!resolved.startsWith(root)) {
    throw notFound("Artifact storage path is invalid.");
  }
  return resolved;
}

export async function readArtifactText(storagePath) {
  return fs.readFile(resolveStoragePath(storagePath), "utf8");
}

export async function readArtifactJson(storagePath) {
  return JSON.parse(await readArtifactText(storagePath));
}

export async function checkStorage() {
  try {
    const root = storageRoot();
    await fs.mkdir(root, { recursive: true });
    await fs.access(root);
    return { status: "ok", root: getServiceConfig().storageRoot };
  } catch (error) {
    return { status: "error", message: error.message, root: getServiceConfig().storageRoot };
  }
}
