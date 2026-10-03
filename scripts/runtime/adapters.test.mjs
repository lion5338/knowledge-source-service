import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readSsm, readSecretsManager, readVault } from './adapters.mjs';

test('SSM decrypts every page including empty intermediate page', async () => {
  const requests = [];
  const pages = [{ Parameters: [], NextToken: 'next' }, { Parameters: [{ Name: '/app/A', Value: '雪\nsecret' }] }];
  const data = await readSsm({ SSM_PATH: '/app' }, async input => { requests.push(input); return pages.shift(); });
  assert.deepEqual({ ...data }, { A: '雪\nsecret' });
  assert.deepEqual(requests, [{ Path: '/app', Recursive: true, WithDecryption: true }, { Path: '/app', Recursive: true, WithDecryption: true, NextToken: 'next' }]);
});

test('SSM advances when an empty page omits optional Parameters', async () => {
  const pages = [{ NextToken: 'next' }, { Parameters: [{ Name: '/app/A', Value: 'kept' }] }];
  assert.deepEqual({ ...await readSsm({ SSM_PATH: '/app' }, async () => pages.shift()) }, { A: 'kept' });
  await assert.rejects(readSsm({ SSM_PATH: '/app' }, async () => ({ Parameters: {} })));
});

for (const pages of [
  [{ Parameters: [{ Name: '/app/a/A', Value: 'x' }, { Name: '/app/b/A', Value: 'y' }] }],
  [{ Parameters: [], NextToken: 'repeat' }, { Parameters: [], NextToken: 'repeat' }],
  [{ Parameters: [{ Name: '/other/A', Value: 'x' }] }],
  [{ Parameters: [] }],
  [{ Parameters: [{ Name: '/app/A' }] }],
]) {
  test('SSM rejects ambiguous, incomplete or empty results', async () => {
    await assert.rejects(readSsm({ SSM_PATH: '/app' }, async () => pages.shift()));
  });
}

test('Secrets Manager requests the configured secret and unwraps encoded JSON', async () => {
  const data = await readSecretsManager({ SECRETS_ARN: 'test-id' }, async input => {
    assert.deepEqual(input, { SecretId: 'test-id' });
    return { SecretString: JSON.stringify(JSON.stringify({ A: 'line\none' })) };
  });
  assert.deepEqual(data, { A: 'line\none' });
  await assert.rejects(readSecretsManager({ SECRETS_ARN: 'id' }, async () => ({ SecretBinary: new Uint8Array([1]) })));
});

async function vaultServer(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

for (const version of ['1', '2']) {
  test(`Vault KV${version} reads actual HTTP envelope and auth headers`, async t => {
    const address = await vaultServer(t, (req, res) => {
      assert.equal(req.url, '/v1/secret/data/app');
      assert.equal(req.headers['x-vault-token'], 'fixture-token');
      assert.equal(req.headers['x-vault-namespace'], 'team');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: version === '2' ? { data: { A: 'vault' }, metadata: {} } : { A: 'vault' } }));
    });
    const data = await readVault({ VAULT_ADDR: address, VAULT_TOKEN: 'fixture-token', VAULT_NAMESPACE: 'team', VAULT_SECRET_PATH: 'secret/data/app', VAULT_KV_VERSION: version });
    assert.deepEqual(data, { A: 'vault' });
  });
}

test('Vault refuses redirects and times out stalled responses', async t => {
  const address = await vaultServer(t, (req, res) => {
    if (req.url.endsWith('/redirect')) { res.writeHead(302, { location: '/leak' }); res.end(); }
  });
  const env = { VAULT_ADDR: address, VAULT_TOKEN: 'fixture', VAULT_SECRET_PATH: 'redirect', ENTRYPOINT_TIMEOUT_MS: '50' };
  await assert.rejects(readVault(env));
  await assert.rejects(readVault({ ...env, VAULT_SECRET_PATH: 'stall' }));
});

test('Vault rejects insecure remote transport, missing token and path traversal', async () => {
  for (const patch of [{ VAULT_ADDR: 'http://example.com' }, { VAULT_TOKEN: '' }, { VAULT_SECRET_PATH: '../sys' }, { VAULT_KV_VERSION: '3' }]) {
    await assert.rejects(readVault({ VAULT_ADDR: 'https://example.com', VAULT_TOKEN: 'fixture', VAULT_SECRET_PATH: 'secret/data/app', ...patch }));
  }
});
