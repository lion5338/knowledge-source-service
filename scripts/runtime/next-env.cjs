// Next's development watcher forces dotenv reloads even when
// __NEXT_PROCESSED_ENV is set. Keep the entrypoint's environment snapshot in
// Node children too, without modifying dependency files or direct npm dev.
if (process.env.ENTRYPOINT_ENV_LOADED === '1') {
  let modulePath;
  try {
    modulePath = require.resolve('@next/env');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  if (modulePath) {
    const nextEnv = require(modulePath);
    const loadEnvConfig = () => ({ combinedEnv: process.env, parsedEnv: {}, loadedEnvFiles: [] });
    const processEnv = () => [process.env, {}];
    require.cache[modulePath].exports = new Proxy(nextEnv, {
      get(target, key, receiver) {
        if (key === 'loadEnvConfig') return loadEnvConfig;
        if (key === 'processEnv') return processEnv;
        return Reflect.get(target, key, receiver);
      },
    });
  }
}
