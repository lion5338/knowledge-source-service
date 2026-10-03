import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadEnvironment } from '../scripts/runtime/environment.mjs';

async function fixture(t, redisUrl, extra={}) {
 const cwd=await mkdtemp(path.join(os.tmpdir(),'source-redis-fixture-'));
 t.after(()=>rm(cwd,{recursive:true,force:true}));
 await writeFile(path.join(cwd,'.env.local'),`PGPASSWORD=fixture-only\nREDIS_URL=${redisUrl}\n`);
 return loadEnvironment({cwd,env:{ENTRYPOINT_COMPOSE_PROJECT:'source',...extra}});
}
for(const host of ['localhost','127.0.0.1','[::1]'])test(`local Source compose maps Redis ${host} to gateway`,async t=>{
 const env=await fixture(t,`redis://fixture-user:fixture-pass@${host}:6379/2?fixture=1`);
 const url=new URL(env.REDIS_URL);
 assert.equal(url.hostname,'host.docker.internal'); assert.equal(url.username,'fixture-user');
 assert.equal(url.password,'fixture-pass');assert.equal(url.port,'6379');assert.equal(url.pathname,'/2');assert.equal(url.search,'?fixture=1');
});
test('remote URL and explicit Source Redis URL are preserved',async t=>{
 const url='rediss://fixture-user:fixture-pass@redis.fixture:6380/3';
 assert.equal((await fixture(t,url)).REDIS_URL,url);
 assert.equal((await fixture(t,'redis://localhost:6379',{SOURCE_REDIS_URL:url})).REDIS_URL,url);
});
test('native and selected remote secret sources retain Redis loopback',async t=>{
 assert.equal((await fixture(t,'redis://localhost:6379',{ENTRYPOINT_COMPOSE_PROJECT:''})).REDIS_URL,'redis://localhost:6379');
 const payload={PGHOST:'db.fixture',PGPORT:'5432',PGDATABASE:'fixture',PGUSER:'fixture',PGPASSWORD:'fixture',REDIS_URL:'redis://localhost:6379'};
 const result=await loadEnvironment({env:{ENTRYPOINT_COMPOSE_PROJECT:'source',SECRET_JSON:JSON.stringify(payload)}});
 assert.equal(result.REDIS_URL,'redis://localhost:6379');
});
test('empty optional Redis remains disabled; explicit host override wins',async t=>{
 assert.equal((await fixture(t,'')).REDIS_URL,'');
 assert.equal(new URL((await fixture(t,'redis://localhost:6379',{SOURCE_REDIS_HOST:'127.0.0.1'})).REDIS_URL).hostname,'127.0.0.1');
});
