import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Exercise the real SDK, signing, serialization and launcher. Only the remote
// HTTP service is a fixture; child environments contain no developer credentials.
async function fixture(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function launch(env) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./launch.mjs', import.meta.url)), process.execPath, '-e', 'console.log(JSON.stringify({A:process.env.A}))'], {
    env: { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      NODE_ENV: 'production', AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'fixture-key',
      AWS_SECRET_ACCESS_KEY: 'fixture-secret', AWS_EC2_METADATA_DISABLED: 'true', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  return { code, stdout, stderr };
}

test('real SSM SDK signs and decrypts paginated requests before starting child', async t => {
  const requests = [];
  const address = await fixture(t, async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ target: req.headers['x-amz-target'], body: JSON.parse(body), signed: req.headers.authorization?.includes('Credential=fixture-key/') });
    res.setHeader('Content-Type', 'application/x-amz-json-1.1');
    res.end(JSON.stringify(requests.length === 1 ? { Parameters: [], NextToken: 'page2' } : { Parameters: [{ Name: '/fixture/A', Value: '雪\n$literal' }] }));
  });
  const result = await launch({ SSM_PATH: '/fixture', AWS_ENDPOINT_URL: address });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { A: '雪\n$literal' });
  assert.deepEqual(requests, [
    { target: 'AmazonSSM.GetParametersByPath', body: { Path: '/fixture', Recursive: true, WithDecryption: true }, signed: true },
    { target: 'AmazonSSM.GetParametersByPath', body: { Path: '/fixture', Recursive: true, WithDecryption: true, NextToken: 'page2' }, signed: true },
  ]);
});

test('real Secrets Manager SDK decodes SecretString and fails closed on denied access', async t => {
  const address = await fixture(t, async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(req.headers['x-amz-target'], 'secretsmanager.GetSecretValue');
    const { SecretId } = JSON.parse(body);
    res.setHeader('Content-Type', 'application/x-amz-json-1.1');
    if (SecretId === 'denied') { res.statusCode = 400; res.end(JSON.stringify({ __type: 'AccessDeniedException', message: 'PRIVATE_FIXTURE_DETAIL' })); }
    else { assert.equal(SecretId, 'fixture'); res.end(JSON.stringify({ SecretString: '{"A":"remote"}' })); }
  });
  const result = await launch({ SECRETS_ARN: 'fixture', AWS_ENDPOINT_URL: address });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { A: 'remote' });
  const denied = await launch({ SECRETS_ARN: 'denied', AWS_ENDPOINT_URL: address });
  assert.equal(denied.code, 1);
  assert.equal(denied.stdout, '');
  assert.doesNotMatch(denied.stderr, /PRIVATE_FIXTURE_DETAIL/);
});

test('real AWS SDK request timeout prevents child startup', async t => {
  const address = await fixture(t, () => {});
  const result = await launch({ SSM_PATH: '/fixture', AWS_ENDPOINT_URL: address, ENTRYPOINT_TIMEOUT_MS: '100' });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
});
