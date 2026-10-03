import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(new URL('./launch.mjs', import.meta.url));
function setup(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'entrypoint-launch-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(path.join(cwd, '.env.local'), 'LOCAL=must-not-merge');
  const env = { PATH: process.env.PATH, Path: process.env.Path, SystemRoot: process.env.SystemRoot, NODE_ENV: 'production' };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  return { cwd, env };
}

test('launcher injects before command, preserves arguments and exit code', t => {
  const options = setup(t);
  options.env.SECRET_JSON = JSON.stringify({ A: '雪\n$HOME "quote" \\slash' });
  const script = 'console.log(JSON.stringify({a:process.env.A,local:process.env.LOCAL,arg:process.argv[1]}));process.exit(17)';
  const result = spawnSync(process.execPath, [launcher, process.execPath, '-e', script, '$(not shell); spaced'], { ...options, encoding: 'utf8' });
  assert.equal(result.status, 17, result.stderr || String(result.error));
  assert.deepEqual(JSON.parse(result.stdout), { a: '雪\n$HOME "quote" \\slash', arg: '$(not shell); spaced' });
});

test('failed injection never starts command or exposes secret', t => {
  const options = setup(t);
  options.env.SECRET_JSON = '{ TOP_SECRET';
  const result = spawnSync(process.execPath, [launcher, process.execPath, '-e', 'console.log("STARTED")'], { ...options, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /TOP_SECRET/);
});

test('missing command fails with a concise redacted error', t => {
  const options = setup(t);
  const result = spawnSync(process.execPath, [launcher], { ...options, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /entrypoint/);
  assert.doesNotMatch(result.stderr, /at .*\.mjs/);
});

test('launcher preload path can contain spaces and preserves Node options', t => {
  const options = setup(t);
  const runtimeDir = mkdtempSync(path.join(tmpdir(), 'entrypoint runtime with spaces '));
  t.after(() => rmSync(runtimeDir, { recursive: true, force: true }));
  for (const file of ['launch.mjs', 'environment.mjs', 'next-env.cjs']) copyFileSync(new URL(file, import.meta.url), path.join(runtimeDir, file));
  options.env.NODE_OPTIONS = '--stack-trace-limit=17';
  const result = spawnSync(process.execPath, [path.join(runtimeDir, 'launch.mjs'), process.execPath, '-e', 'console.log(Error.stackTraceLimit)'], { ...options, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '17');
});

test('Linux launcher replacement delivers SIGTERM directly to application', { skip: process.platform !== 'linux' }, async t => {
  const options = setup(t);
  const child = spawn(process.execPath, [launcher, process.execPath, '-e', 'process.on("SIGTERM",()=>process.exit(23));console.log("READY");setInterval(()=>{},1000)'], { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); });
  child.kill('SIGTERM');
  assert.deepEqual(await exit, { code: 23, signal: null });
});
