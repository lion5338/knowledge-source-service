import { parseSecretJson } from './environment.mjs';

function timeout(env) {
  const ms = Number(env.ENTRYPOINT_TIMEOUT_MS ?? 15000);
  if (!Number.isInteger(ms) || ms < 1 || ms > 300000) throw new Error('Invalid source timeout');
  return ms;
}

async function awsOperation(env, service, action) {
  const sdk = service === 'ssm' ? await import('@aws-sdk/client-ssm') : await import('@aws-sdk/client-secrets-manager');
  const Client = sdk.SSMClient ?? sdk.SecretsManagerClient;
  const Command = sdk.GetParametersByPathCommand ?? sdk.GetSecretValueCommand;
  const client = new Client({ region: env.AWS_REGION || env.AWS_DEFAULT_REGION, maxAttempts: 2 });
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      action(input => client.send(new Command(input), { abortSignal: controller.signal })),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Source timeout')); }, timeout(env)); }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    client.destroy();
  }
}

export async function readSsm(env, send) {
  if (!send) return awsOperation(env, 'ssm', request => readSsm(env, request));
  const root = env.SSM_PATH.replace(/\/$/, '');
  if (!root.startsWith('/') || root === '') throw new Error('Invalid SSM path');
  const data = Object.create(null);
  const seen = new Set();
  let token;
  do {
    const page = await send({ Path: root, Recursive: true, WithDecryption: true, ...(token ? { NextToken: token } : {}) });
    const parameters = page.Parameters === undefined ? [] : page.Parameters;
    if (!Array.isArray(parameters)) throw new Error('Invalid SSM response');
    for (const parameter of parameters) {
      if (typeof parameter.Name !== 'string' || !parameter.Name.startsWith(`${root}/`) || typeof parameter.Value !== 'string') throw new Error('Incomplete SSM parameter');
      const key = parameter.Name.split('/').at(-1);
      if (Object.hasOwn(data, key)) throw new Error('Duplicate SSM environment key');
      data[key] = parameter.Value;
    }
    token = page.NextToken;
    if (token && (typeof token !== 'string' || seen.has(token))) throw new Error('Invalid SSM pagination');
    if (token) seen.add(token);
  } while (token);
  if (Object.keys(data).length === 0) throw new Error('Empty SSM path');
  return data;
}

export async function readSecretsManager(env, send) {
  if (!send) return awsOperation(env, 'secretsManager', request => readSecretsManager(env, request));
  const response = await send({ SecretId: env.SECRETS_ARN });
  if (typeof response.SecretString !== 'string' || !response.SecretString) throw new Error('SecretString is required');
  return parseSecretJson(response.SecretString);
}

export async function readVault(env) {
  const address = new URL(env.VAULT_ADDR);
  if (address.username || address.password || address.search || address.hash || address.pathname !== '/') throw new Error('Invalid Vault address');
  if (address.protocol !== 'https:' && !(address.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(address.hostname))) throw new Error('Vault requires HTTPS');
  const version = env.VAULT_KV_VERSION ?? '2';
  if (!['1', '2'].includes(version) || !env.VAULT_TOKEN) throw new Error('Invalid Vault configuration');
  const parts = env.VAULT_SECRET_PATH?.split('/');
  if (!parts?.length || parts.some(part => !part || part === '.' || part === '..' || /[\\?#%]/.test(part))) throw new Error('Invalid Vault API path');
  const response = await fetch(new URL(`v1/${parts.map(encodeURIComponent).join('/')}`, address), {
    headers: { 'X-Vault-Token': env.VAULT_TOKEN, ...(env.VAULT_NAMESPACE ? { 'X-Vault-Namespace': env.VAULT_NAMESPACE } : {}) },
    redirect: 'error', signal: AbortSignal.timeout(timeout(env)),
  });
  if (!response.ok) throw new Error('Vault request failed');
  const payload = await response.json();
  const data = version === '2' ? payload.data?.data : payload.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Vault response');
  return data;
}

export const adapters = { ssm: readSsm, secretsManager: readSecretsManager, vault: readVault };
