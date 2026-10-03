import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadEnvironment } from './environment.mjs';

async function fixture(t, content = '') {
  const cwd = await mkdtemp(path.join(tmpdir(), 'entrypoint-env-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, '.env.local'), content);
  await writeFile(path.join(cwd, '.env'), 'UNWANTED=must-not-load');
  return cwd;
}

test('development reads only local file, preserves special values and existing empty values', async t => {
  const cwd = await fixture(t, 'A="雪 $HOME # \' quote \\ slash"\nPEM="line1\nline2"\nEMPTY=file\n');
  const env = { NODE_ENV: 'development', SSM_PATH: '/ignored', EMPTY: '' };
  const result = await loadEnvironment({ cwd, env, adapters: { ssm() { throw Error('must not fetch'); } } });
  assert.equal(result.A, "雪 $HOME # ' quote \\ slash");
  assert.equal(result.PEM, 'line1\nline2');
  assert.equal(result.EMPTY, '');
  assert.equal(result.UNWANTED, undefined);
  assert.equal(result.ENTRYPOINT_ENV_LOADED, '1');
  assert.equal(result.__NEXT_PROCESSED_ENV, 'true');
  assert.equal(env.A, undefined);
});

test('non-development without selector falls back to local; missing default file is allowed', async t => {
  const cwd = await fixture(t, 'A=local');
  assert.equal((await loadEnvironment({ cwd, env: { NODE_ENV: 'production' } })).A, 'local');
  await rm(path.join(cwd, '.env.local'));
  assert.equal((await loadEnvironment({ cwd, env: {} })).UNWANTED, undefined);
  await assert.rejects(loadEnvironment({ cwd, env: { ENV_FILE: 'missing' } }), /local/i);
});

for (const [selector, adapter] of [['SSM_PATH', 'ssm'], ['SECRETS_ARN', 'secretsManager'], ['VAULT_SECRET_PATH', 'vault']]) {
  test(`${selector} loads selected remote without local merge and preserves injected values`, async t => {
    const cwd = await fixture(t, 'LOCAL_ONLY=bad');
    const result = await loadEnvironment({ cwd, env: { [selector]: 'configured', EXISTING: '' }, adapters: {
      [adapter]: async () => ({ A: 'remote\n雪\\n$HOME', EXISTING: 'replacement' }),
    } });
    assert.equal(result.A, 'remote\n雪\\n$HOME');
    assert.equal(result.EXISTING, '');
    assert.equal(result.LOCAL_ONLY, undefined);
  });
  test(`${selector} fails closed and redacts provider errors even with complete existing env`, async t => {
    const cwd = await fixture(t, 'A=local');
    await assert.rejects(loadEnvironment({ cwd, env: { [selector]: 'private-id', A: 'already' }, adapters: {
      [adapter]: async () => { throw Error('private-id TOP_SECRET'); },
    } }), error => !/private-id|TOP_SECRET/.test(error.message));
  });
}

test('conflicting selectors fail before fetching or local fallback', async t => {
  const cwd = await fixture(t);
  await assert.rejects(loadEnvironment({ cwd, env: { SSM_PATH: '/a', SECRETS_ARN: 'b' } }), /multiple/i);
});

test('inline JSON supports double encoding and scalar conversion', async t => {
  const cwd = await fixture(t);
  const result = await loadEnvironment({ cwd, env: { SECRET_JSON: JSON.stringify(JSON.stringify({ A: 'a\nb', B: 12, C: false, D: null })) } });
  assert.equal(result.A, 'a\nb');
  assert.equal(result.B, '12');
  assert.equal(result.C, 'false');
  assert.equal(result.D, '');
});

for (const payload of [{ '1BAD': 'secret' }, { A: 'secret\0bad' }, { A: {} }, [], { NODE_OPTIONS: '--bad' }, { PATH: 'bad' }, { ENTRYPOINT_ENV_LOADED: '0' }, { __NEXT_PROCESSED_ENV: 'false' }]) {
  test(`invalid payload is rejected without echoing values (${JSON.stringify(Object.keys(payload))})`, async t => {
    const cwd = await fixture(t);
    await assert.rejects(loadEnvironment({ cwd, env: { SECRET_JSON: JSON.stringify(payload) } }), error => !/secret|--bad/.test(error.message));
  });
}

test('malformed JSON error never prints payload', async t => {
  const cwd = await fixture(t);
  await assert.rejects(loadEnvironment({ cwd, env: { SECRET_JSON: '{ TOP_SECRET' } }), error => !error.message.includes('TOP_SECRET'));
});
