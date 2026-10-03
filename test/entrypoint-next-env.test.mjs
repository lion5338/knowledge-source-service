import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

for (const forceReload of [false, true]) test(`Next runtime does not fill absent remote keys from local env files (forceReload=${forceReload})`, t => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'entrypoint-next-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) writeFileSync(path.join(cwd, name), 'LEAKED=local');
  const nextEnv = createRequire(import.meta.url).resolve('@next/env');
  const script = `require(${JSON.stringify(nextEnv)}).loadEnvConfig(process.cwd(), false, console, ${forceReload}); console.log(JSON.stringify({leaked:process.env.LEAKED,kept:process.env.KEPT}));`;
  const env = { NODE_ENV: 'production', SECRET_JSON: '{"KEPT":"remote"}', SystemRoot: process.env.SystemRoot, PATH: process.env.PATH };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const launch = fileURLToPath(new URL('../scripts/runtime/launch.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [launch, process.execPath, '-e', script], { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { kept: 'remote' });
});

test('development snapshot survives forced Next reload in a forked worker', t => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'entrypoint next worker '));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(path.join(cwd, '.env.local'), 'KEPT="local $literal"');
  writeFileSync(path.join(cwd, '.env.development.local'), 'LEAKED=unwanted');
  const nextEnv = createRequire(import.meta.url).resolve('@next/env');
  const childPath = path.join(cwd, 'worker.cjs');
  writeFileSync(childPath, `const n=require(${JSON.stringify(nextEnv)}); n.loadEnvConfig(process.cwd(),true,console,true);n.processEnv([{path:'.env',contents:'LEAKED=bad'}],process.cwd(),console,true);console.log(JSON.stringify({kept:process.env.KEPT,leaked:process.env.LEAKED,stack:Error.stackTraceLimit}));`);
  const script = `require('node:child_process').fork(${JSON.stringify(childPath)},[],{stdio:'inherit'}).on('exit',code=>process.exitCode=code);`;
  const env = { NODE_ENV: 'development', NODE_OPTIONS: '--stack-trace-limit=17', SystemRoot: process.env.SystemRoot, PATH: process.env.PATH };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const launch = fileURLToPath(new URL('../scripts/runtime/launch.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [launch, process.execPath, '-e', script], { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { kept: 'local $literal', stack: 17 });
});
