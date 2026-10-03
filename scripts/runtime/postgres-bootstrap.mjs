import { loadEnvironment } from './environment.mjs';

try {
  const env = await loadEnvironment({ env: { ...process.env, ENTRYPOINT_COMPOSE_PROJECT: 'source-db' } });
  process.execve('/usr/local/bin/docker-entrypoint.sh', ['docker-entrypoint.sh', ...process.argv.slice(2)], env);
} catch (error) {
  console.error(error.code === 'ENTRYPOINT_MISSING_KEYS' ? `[entrypoint] ${error.message}` : '[entrypoint] database environment loading or startup failed');
  process.exit(1);
}
