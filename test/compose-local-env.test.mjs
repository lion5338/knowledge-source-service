import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../scripts/runtime/environment.mjs';

async function fixture(t, content) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'source-compose-fake-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  if (content !== undefined) await writeFile(path.join(cwd, '.env.local'), content);
  return cwd;
}
const base = { ENTRYPOINT_COMPOSE_PROJECT: 'source', NODE_ENV: 'production' };
test('local app and DB resolve the same PG aliases and adapt container paths', async t => {
  const cwd = await fixture(t, 'PGPASSWORD="fake $money\nsecond line"\nPGUSER=fake_user\nPGDATABASE=fake_db\nPGHOST=localhost\nPGPORT=9999\nKNOWLEDGE_SOURCE_STORAGE_ROOT=C:\\private\n');
  const app = await loadEnvironment({ cwd, env: base });
  const db = await loadEnvironment({ cwd, env: { ...base, ENTRYPOINT_COMPOSE_PROJECT: 'source-db' } });
  assert.equal(app.PGHOST, 'source-db');
  assert.equal(app.PGPORT, '5432');
  assert.equal(app.KNOWLEDGE_SOURCE_STORAGE_ROOT, '/app/storage/knowledge');
  assert.equal(app.PGPASSWORD, 'fake $money\nsecond line');
  assert.equal(db.POSTGRES_PASSWORD, app.PGPASSWORD);
  assert.equal(db.POSTGRES_USER, 'fake_user');
  assert.equal(db.POSTGRES_DB, 'fake_db');
});
test('explicit aliases outrank file aliases and preserve empty required values', async t => {
  const cwd = await fixture(t, 'SOURCE_PGPASSWORD=file_source\nPGPASSWORD=file_pg\n');
  assert.equal((await loadEnvironment({ cwd, env: { ...base, PGPASSWORD: 'shell_pg' } })).PGPASSWORD, 'shell_pg');
  assert.equal((await loadEnvironment({ cwd, env: { ...base, PGPASSWORD: 'shell_pg', SOURCE_PGPASSWORD: 'shell_source' } })).PGPASSWORD, 'shell_source');
  await assert.rejects(loadEnvironment({ cwd, env: { ...base, PGPASSWORD: '' } }), /Missing required environment keys: PGPASSWORD/);
});
test('missing optional mounted file permits explicit credentials and defaults', async t => {
  const cwd = await fixture(t);
  const env = await loadEnvironment({ cwd, env: { ...base, ENTRYPOINT_LOCAL_ENV: path.join(cwd, 'absent'), PGPASSWORD: 'fake' } });
  assert.equal(env.PGUSER, 'knowledge_source_user');
  assert.equal(env.ENABLE_TENANT, 'false');
  await assert.rejects(loadEnvironment({ cwd, env: base }), /PGPASSWORD/);
  await assert.rejects(loadEnvironment({ cwd, env: { ...base, ENV_FILE: 'absent' } }), /Cannot read local/);
});
test('remote app keeps coordinates without local defaults; DB ignores app selector', async t => {
  const cwd = await fixture(t, 'PGPASSWORD=local_fake\nLOCAL_ONLY=local\n');
  const remote = { PGHOST: 'remote.invalid', PGPORT: '6543', PGUSER: 'remote_user', PGDATABASE: 'remote_db', PGPASSWORD: 'remote_fake' };
  const env = { ...base, SECRET_JSON: JSON.stringify(remote) };
  const app = await loadEnvironment({ cwd, env });
  assert.equal(app.PGHOST, 'remote.invalid');
  assert.equal(app.PGPORT, '6543');
  assert.equal(app.LOCAL_ONLY, undefined);
  assert.equal(app.ENABLE_TENANT, undefined);
  const db = await loadEnvironment({ cwd, env: { ...env, ENTRYPOINT_COMPOSE_PROJECT: 'source-db' } });
  assert.equal(db.POSTGRES_PASSWORD, 'local_fake');
  await assert.rejects(loadEnvironment({ cwd, env: { ...base, SECRET_JSON: '{}' } }), /PGHOST.*PGPORT.*PGDATABASE.*PGUSER.*PGPASSWORD/);
});
test('real Compose config accepts optional local file without exposing its secrets', { skip: process.env.RUN_COMPOSE_TESTS !== '1' }, async t => {
  const cwd = await fixture(t, 'PGPASSWORD=fake_config_secret\n');
  await copyFile(new URL('../docker-compose.node24.yml', import.meta.url), path.join(cwd, 'docker-compose.node24.yml'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SOURCE_|PG|SECRET_JSON|SSM_|SECRETS_|VAULT_|ENV_FILE|ENTRYPOINT_)/.test(key)));
  const result = spawnSync('docker', ['compose', '--profile', 'tools', '-f', path.join(cwd, 'docker-compose.node24.yml'), 'config', '--format', 'json'], { cwd: os.tmpdir(), env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes('fake_config_secret'));
  const config = JSON.parse(result.stdout);
  assert.equal(config.services['source-db'].environment.ENTRYPOINT_COMPOSE_PROJECT, 'source-db');
  assert.ok(config.services['source-migrate'].volumes.some(v => v.target === '/run/project-config' && v.read_only));
  for (const service of ['source-db', 'source-migrate', 'source-seed', 'knowledge-source-service', 'source-test']) {
    assert.equal(config.services[service].environment.PGPASSWORD ?? undefined, undefined);
  }
  await writeFile(path.join(cwd, '.env'), 'PGPASSWORD=compose_explicit_fake\n');
  const explicit = spawnSync('docker', ['compose', '-f', path.join(cwd, 'docker-compose.node24.yml'), 'config', '--format', 'json'], { cwd, env: { ...env, SOURCE_PGPASSWORD: 'shell_alias_fake' }, encoding: 'utf8' });
  assert.equal(explicit.status, 0, explicit.stderr);
  const forwarded = JSON.parse(explicit.stdout).services['source-migrate'].environment;
  assert.equal(forwarded.PGPASSWORD, 'compose_explicit_fake');
  assert.equal(forwarded.SOURCE_PGPASSWORD, 'shell_alias_fake');
});
test('mounted fallback is project-relative even when launched from another directory', async t => {
  const project = await fixture(t, 'PGPASSWORD=" spaced $fake # literal "\n');
  const other = await fixture(t, 'PGPASSWORD=wrong_project\n');
  const env = await loadEnvironment({ cwd: other, env: { ...base, ENTRYPOINT_LOCAL_ENV: path.join(project, '.env.local') } });
  assert.equal(env.PGPASSWORD, ' spaced $fake # literal ');
});
test('development uses local config despite remote selector and explicit empty user fails', async t => {
  const cwd = await fixture(t, 'PGPASSWORD=local_fake\n');
  assert.equal((await loadEnvironment({ cwd, env: { ...base, NODE_ENV: 'development', SECRET_JSON: 'invalid' } })).PGPASSWORD, 'local_fake');
  await assert.rejects(loadEnvironment({ cwd, env: { ...base, SOURCE_PGUSER: '' } }), /PGUSER/);
});
test('launcher exposes missing key names while never starting child', async t => {
  const cwd = await fixture(t);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/runtime/launch.mjs', import.meta.url)), process.execPath, '-e', 'console.log("STARTED")'], {
    cwd, env: { ...base, SystemRoot: process.env.SystemRoot, PATH: process.env.PATH }, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Missing required environment keys: PGPASSWORD/);
});
