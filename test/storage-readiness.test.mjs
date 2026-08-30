import assert from "node:assert/strict";
import { constants } from "node:fs";
import test from "node:test";

import { checkWritableDirectoryReady } from "../src/lib/storage/storage-readiness.mjs";

test("checkWritableDirectoryReady requires write and search permissions", async () => {
  const calls = [];
  const result = await checkWritableDirectoryReady("/artifacts", {
    async mkdir(root, options) {
      calls.push(["mkdir", root, options]);
    },
    async access(root, mode) {
      calls.push(["access", root, mode]);
    },
  });

  assert.deepEqual(result, { status: "ok" });
  assert.deepEqual(calls, [
    ["mkdir", "/artifacts", { recursive: true }],
    ["access", "/artifacts", constants.W_OK | constants.X_OK],
  ]);
});

test("checkWritableDirectoryReady reports a non-writable artifact directory", async () => {
  const result = await checkWritableDirectoryReady("/artifacts", {
    async mkdir() {},
    async access() {
      throw new Error("permission denied");
    },
  });

  assert.deepEqual(result, { status: "error", message: "permission denied" });
});
