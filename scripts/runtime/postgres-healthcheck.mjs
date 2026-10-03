import { spawnSync } from 'node:child_process';
import { loadEnvironment } from './environment.mjs';
try {
  const env = await loadEnvironment({ env: { ...process.env, ENTRYPOINT_COMPOSE_PROJECT: 'source-db' } });
  const check = spawnSync('pg_isready', ['-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB], { env, stdio: 'ignore' });
  process.exit(check.status ?? 1);
} catch { process.exit(1); }
