import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';

const selectors = [['SSM_PATH', 'ssm'], ['SECRETS_ARN', 'secretsManager'], ['VAULT_SECRET_PATH', 'vault'], ['SECRET_JSON', 'inline']];
const controlKey = /^(?:NODE_OPTIONS|NODE_PATH|PATH|PATHEXT|COMSPEC|LD_.*|DYLD_.*|BASH_ENV|ENV|SHELLOPTS|ENV_FILE|ENTRYPOINT_.*|__NEXT_.*|SECRET_JSON|SECRETS_ARN|SSM_PATH|VAULT_.*|AWS_.*)$/i;

export function parseSecretJson(text) {
  try {
    let data = JSON.parse(text.replace(/^\uFEFF/, '').trim());
    if (typeof data === 'string') data = JSON.parse(data.replace(/^\uFEFF/, '').trim());
    return data;
  } catch {
    throw new Error('Invalid JSON environment payload');
  }
}

export function validateValues(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Environment payload must be an object');
  const result = Object.create(null);
  for (const [key, raw] of Object.entries(data)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || controlKey.test(key)) throw new Error('Invalid or reserved environment key');
    if (raw !== null && !['string', 'number', 'boolean'].includes(typeof raw)) throw new Error('Environment values must be scalar');
    const value = raw === null ? '' : String(raw);
    if (value.includes('\0')) throw new Error('Invalid environment value');
    result[key] = value;
  }
  return result;
}

export async function loadEnvironment({ env = process.env, cwd = process.cwd(), adapters } = {}) {
  const initial = { ...env };
  const compose = ['source', 'source-db'].includes(initial.ENTRYPOINT_COMPOSE_PROJECT);
  const database = compose && initial.ENTRYPOINT_COMPOSE_PROJECT === 'source-db';
  const selected = initial.NODE_ENV === 'development' || database ? [] : selectors.filter(([key]) => initial[key]);
  if (selected.length > 1) throw new Error('Multiple environment sources configured');
  let data;
  if (selected.length) {
    const [, source] = selected[0];
    try {
      if (source === 'inline') data = parseSecretJson(initial.SECRET_JSON);
      else {
        const providers = adapters ?? (await import('./adapters.mjs')).adapters;
        data = await providers[source](initial);
      }
    } catch {
      throw new Error('Configured environment source failed');
    }
  } else {
    try {
      data = parseEnv(await readFile(path.resolve(cwd, initial.ENV_FILE || (compose && initial.ENTRYPOINT_LOCAL_ENV) || '.env.local'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT' && !initial.ENV_FILE) data = {};
      else throw new Error('Cannot read local environment file');
    }
  }
  const payload = validateValues(data);
  const result = { ...payload, ...initial, ENTRYPOINT_ENV_LOADED: '1', __NEXT_PROCESSED_ENV: 'true' };
  if (compose) {
    const defaults = selected.length ? {} : {
      PGHOST: 'source-db', PGPORT: '5432', PGDATABASE: 'knowledge_source', PGUSER: 'knowledge_source_user',
      ENABLE_TENANT: 'false', ENABLE_K12: 'false', DEFAULT_KNOWLEDGE: 'marble;learning_commons', REDIS_URL: '',
    };
    for (const key of ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'REDIS_URL']) {
      const alias = `SOURCE_${key}`;
      const value = Object.hasOwn(initial, alias) ? initial[alias] : Object.hasOwn(initial, key) ? initial[key]
        : Object.hasOwn(payload, alias) ? payload[alias] : Object.hasOwn(payload, key) ? payload[key] : defaults[key];
      if (value !== undefined) result[key] = value;
    }
    for (const key of ['ENABLE_TENANT', 'ENABLE_K12', 'DEFAULT_KNOWLEDGE']) {
      if (!Object.hasOwn(result, key) && defaults[key] !== undefined) result[key] = defaults[key];
    }
    if (!selected.length) { result.PGHOST = 'source-db'; result.PGPORT = '5432'; }
    const required = database ? ['PGDATABASE', 'PGUSER', 'PGPASSWORD'] : ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
    const missing = required.filter(key => typeof result[key] !== 'string' || result[key].trim() === '');
    if (missing.length) {
      const error = new Error(`Missing required environment keys: ${missing.join(', ')}`);
      error.code = 'ENTRYPOINT_MISSING_KEYS';
      throw error;
    }
    // A local application's native Redis loopback refers to the Docker host.
    // Keep remote secret sources and explicit non-loopback URLs unchanged.
    if (!database && !selected.length && result.REDIS_URL) {
      try {
        const redis = new URL(result.REDIS_URL);
        if (['redis:', 'rediss:'].includes(redis.protocol)) {
          const override = result.SOURCE_REDIS_HOST?.trim();
          const host = override || (['localhost', '127.0.0.1', '[::1]'].includes(redis.hostname) ? 'host.docker.internal' : null);
          if (host) { redis.hostname = host; result.REDIS_URL = redis.toString(); }
        }
      } catch { /* Preserve existing invalid-URL handling at the Redis boundary. */ }
    }
    if (database) {
      result.POSTGRES_DB = result.PGDATABASE;
      result.POSTGRES_USER = result.PGUSER;
      result.POSTGRES_PASSWORD = result.PGPASSWORD;
    } else result.KNOWLEDGE_SOURCE_STORAGE_ROOT = '/app/storage/knowledge';
  }
  return result;
}
