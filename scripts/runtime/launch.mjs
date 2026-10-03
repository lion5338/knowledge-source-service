import { spawn } from 'node:child_process';
import { loadEnvironment } from './environment.mjs';
import { fileURLToPath } from 'node:url';

try {
  const [command, ...args] = process.argv.slice(2);
  if (!command) throw new Error('Command required');
  const env = await loadEnvironment();
  const preload = fileURLToPath(new URL('./next-env.cjs', import.meta.url)).replaceAll('\\', '/');
  env.NODE_OPTIONS = `--require ${JSON.stringify(preload)}${env.NODE_OPTIONS ? ` ${env.NODE_OPTIONS}` : ''}`;
  if (process.platform === 'linux' && typeof process.execve === 'function') {
    // Fixed shell program; command and arguments remain separate argv entries.
    process.execve('/bin/sh', ['sh', '-c', 'exec "$@"', 'entrypoint', command, ...args], env);
  } else {
    const child = spawn(command, args, { env, stdio: 'inherit', shell: false });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
    child.once('error', () => { console.error('[entrypoint] command could not start'); process.exitCode = 1; });
    child.once('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143); });
  }
} catch (error) {
  console.error(error.code === 'ENTRYPOINT_MISSING_KEYS' ? `[entrypoint] ${error.message}` : '[entrypoint] environment loading or command startup failed');
  process.exit(1);
}
