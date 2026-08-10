import crypto from "crypto";

export function hashAccessKey(plaintextKey) {
  return crypto.createHash("sha256").update(String(plaintextKey ?? ""), "utf8").digest("hex");
}

export function keyPrefix(plaintextKey, length = 6) {
  const value = String(plaintextKey ?? "");
  if (!value) {
    return null;
  }
  return value.slice(0, length);
}
