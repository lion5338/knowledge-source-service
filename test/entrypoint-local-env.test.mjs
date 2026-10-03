import assert from 'node:assert/strict';
import test from 'node:test';
import dotenv from 'dotenv';

test('injected source CLI does not reopen dotenv files', async t => {
  const previous = process.env.ENTRYPOINT_ENV_LOADED;
  process.env.ENTRYPOINT_ENV_LOADED = '1';
  t.after(() => { if (previous === undefined) delete process.env.ENTRYPOINT_ENV_LOADED; else process.env.ENTRYPOINT_ENV_LOADED = previous; });
  // Intercept the filesystem-loading boundary so a regression cannot read developer credentials.
  const calls = t.mock.method(dotenv, 'config', () => ({}));
  await import('../scripts/lib/db.mjs?entrypoint-guard-test');
  assert.equal(calls.mock.callCount(), 0);
});
