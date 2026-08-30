import fs from "fs/promises";
import path from "path";
import { getServiceConfig } from "../config.js";
import { notFound } from "../http/errors.js";
import { checkWritableDirectoryReady } from "./storage-readiness.mjs";

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
  const result = await checkWritableDirectoryReady(storageRoot());
  return {
    ...result,
    root: getServiceConfig().storageRoot,
  };
}
