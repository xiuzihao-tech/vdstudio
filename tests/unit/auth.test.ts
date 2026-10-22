// 账号：注册保留匿名数据、登录合并、会话、限流、强制登录模式、文件访问隔离。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

process.env.MOCK_DELAY_MS = '0';
process.env.AI_PROVIDER = 'mock'; // 不受本机 .env 里真实密钥影响
process.env.TODAY = '2026-10-21';
const { createApp } = await import('../../src/server/app.ts');
const { hashPassword, verifyPassword } = await import('../../src/server/auth.ts');

const dirs: string[] = [];
async function boot(authRequired: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'findai-auth-')); dirs.push(dir);
  const app = createApp({ dbFile: ':memory:', dataDir: dir, webDir: dir, authRequired });
  await new Promise<void>(r => app.server.listen(0, r));
  return { app, base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}` };
}
const servers: { close: () => void }[] = [];
after(() => { servers.forEach(s => s.close()); dirs.forEach(d => rmSync(d, { recursive: true, force: true })); });

/** 一个带 Cookie 罐的浏览器 */
function client(base: string) {
  const jar: Record<string, string> = {};
  return async (method: string, path: string, data?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...headers }, body: data === undefined ? undefined : data instanceof Uint8Array ? (data as unknown as BodyInit) : JSON.stringify(data) });
    for (const c of res.headers.getSetCookie()) { const [kv, ...attrs] = c.split(';'); const [k, v] = kv.split('='); if (attrs.some(a => /max-age=0/i.test(a.trim()))) delete jar[k]; else jar[k] = v; }
    return { status: res.status, json: await res.json().catch(() => null), raw: res };
  };
}

test('密码哈希：同一密码每次盐不同，能校验', async () => {
  const a = await hashPassword('abcdefgh'), b = await hashPassword('abcdefgh');
  assert.notEqual(a, b);
  assert.ok(await verifyPassword('abcdefgh', a));
  assert.ok(!(await verifyPassword('abcdefgx', a)));
  assert.ok(!(await verifyPassword('abcdefgh', 'garbage')));
});

test('匿名做的内容，注册后原样保留；退出后看不到；再登录回来', async () => {
  const { app, base } = await boot(false); servers.push(app.server);
  const c = client(base);
  const t = (await c('GET', '/api/topics/all')).json.topics[0];
  await c('POST', `/api/topics/${t.id}/fav`, { fav: true });
  const reg = await c('POST', '/api/auth/register', { email: 'Lin@Example.com', password: 'secret123', name: '林设计师' });
  assert.equal(reg.status, 200);
  assert.match(reg.json.message, /都在/);
  const s = (await c('GET', '/api/session')).json;
  assert.equal(s.user.email, 'lin@example.com');
  assert.equal(s.workspace.ownerId, undefined, '不把 owner id 暴露给前端');
  assert.ok((await c('GET', '/api/topics/all')).json.topics.find((x: any) => x.id === t.id).fav);
  assert.equal((await c('POST', '/api/auth/register', { email: 'lin@example.com', password: 'secret123', name: 'x' })).status, 409);
  await c('POST', '/api/auth/logout');
  const anon = (await c('GET', '/api/session')).json;
  assert.equal(anon.user, null);
  assert.ok(!(await c('GET', '/api/topics/all')).json.topics.some((x: any) => x.id === t.id), '退出后是新的匿名空间');
  const bad = await c('POST', '/api/auth/login', { email: 'lin@example.com', password: 'wrongpass' });
  assert.equal(bad.status, 401);
  const ok = await c('POST', '/api/auth/login', { email: 'lin@example.com', password: 'secret123' });
  assert.equal(ok.status, 200);
  assert.ok((await c('GET', '/api/topics/all')).json.topics.find((x: any) => x.id === t.id).fav);
});

test('登录时合并：匿名期间新开的身份并进账号，已有身份不覆盖', async () => {
  const { app, base } = await boot(false); servers.push(app.server);
  const a = client(base);
  await a('GET', '/api/session');
  await a('POST', '/api/auth/register', { email: 'm@x.com', password: 'secret123', name: 'M' });
  await a('POST', '/api/auth/logout');
  await a('POST', '/api/session/persona', { persona: 'stay' }); // 匿名开一个民宿身份
  const login = await a('POST', '/api/auth/login', { email: 'm@x.com', password: 'secret123' });
  assert.match(login.json.message, /1 个身份/);
  assert.equal((await a('GET', '/api/session')).json.workspace.persona, 'stay');
  assert.equal((await a('POST', '/api/session/persona', { persona: 'designer' })).json.workspace.persona, 'designer');
});

test('参数校验与限流', async () => {
  const { app, base } = await boot(false); servers.push(app.server);
  const c = client(base);
  assert.equal((await c('POST', '/api/auth/register', { email: 'bad', password: 'secret123', name: 'x' })).status, 400);
  assert.equal((await c('POST', '/api/auth/register', { email: 'a@b.com', password: 'short', name: 'x' })).status, 400);
  await c('POST', '/api/auth/register', { email: 'r@b.com', password: 'secret123', name: 'x' });
  for (let i = 0; i < 5; i++) await c('POST', '/api/auth/login', { email: 'r@b.com', password: 'nopenope' });
  const locked = await c('POST', '/api/auth/login', { email: 'r@b.com', password: 'secret123' });
  assert.equal(locked.status, 401);
  assert.match(locked.json.error, /太多/);
});

test('强制登录模式：未登录一律 401，登录后正常', async () => {
  const { app, base } = await boot(true); servers.push(app.server);
  const c = client(base);
  assert.equal((await c('GET', '/api/session')).status, 401);
  assert.equal((await c('GET', '/api/topics/all')).status, 401);
  const reg = await c('POST', '/api/auth/register', { email: 'z@z.com', password: 'secret123', name: 'Z' });
  assert.equal(reg.status, 200);
  const s = await c('GET', '/api/session');
  assert.equal(s.status, 200);
  assert.equal(s.json.authRequired, true);
});

test('文件隔离：别人的上传文件拿不到', async () => {
  const { app, base } = await boot(false); servers.push(app.server);
  const a = client(base), b = client(base);
  const up = await a('POST', '/api/assets', new Uint8Array([1, 2, 3]), { 'content-type': 'image/png', 'x-file-name': 'a.png' });
  assert.equal((await a('GET', up.json.url)).raw.status, 200);
  await b('GET', '/api/session');
  assert.equal((await b('GET', up.json.url)).status, 404);
});

test('签名文件链接：视频服务不带 Cookie 也能取首帧，签名错或过期就拿不到', async () => {
  const { app, base } = await boot(false); servers.push(app.server);
  const a = client(base);
  const up = await a('POST', '/api/assets', new Uint8Array([9, 9, 9]), { 'content-type': 'image/png', 'x-file-name': 'f.png' });
  const signed = app.signedUrl(up.json.url.slice(7));
  assert.equal((await fetch(base + signed)).status, 200);
  assert.equal((await fetch(base + signed.replace(/sig=.{4}/, 'sig=AAAA'))).status, 404);
  assert.equal((await fetch(base + app.signedUrl(up.json.url.slice(7), -10))).status, 404);
  assert.equal((await fetch(base + up.json.url)).status, 404, '不带签名、不带 Cookie 拿不到');
});
