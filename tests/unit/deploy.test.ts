// 上线预留：生产环境配置自检、跨域白名单、请求 ID、Cookie SameSite、代理后面取真实 IP。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { configFromEnv } from '../../src/server/config.ts';
import { checkConfig, reportConfig } from '../../src/server/startup-check.ts';

process.env.MOCK_DELAY_MS = '0';
process.env.AI_PROVIDER = 'mock';
const { createApp } = await import('../../src/server/app.ts');

const SECRET = 'x'.repeat(40);

test('生产环境：缺 Secure Cookie、签名密钥、管理员就拒绝启动；配齐后只剩提醒', () => {
  const bad = checkConfig(configFromEnv({ NODE_ENV: 'production' }), { NODE_ENV: 'production' });
  assert.equal(bad.errors.length, 3, bad.errors.join('\n'));
  const lines: string[] = [];
  assert.equal(reportConfig(bad, s => lines.push(s)), false);
  assert.ok(lines.some(l => /已停止启动/.test(l)));
  const envOk = { NODE_ENV: 'production', SECURE_COOKIES: '1', FILE_SIGN_SECRET: SECRET, ADMIN_EMAILS: 'boss@x.com', AUTH_REQUIRED: '1', INVITE_REQUIRED: '1', DAILY_BUDGET_POINTS: '2000', STORAGE: 's3', LLM_API_KEY: 'k', VIDEO_API_KEY: 'k', PUBLIC_BASE_URL: 'https://x.com' };
  const ok = checkConfig(configFromEnv(envOk), envOk);
  assert.deepEqual(ok, { errors: [], warnings: [] });
  const cross = { ...envOk, COOKIE_SAMESITE: 'none', SECURE_COOKIES: '0' };
  assert.ok(checkConfig(configFromEnv(cross), cross).errors.some(e => /SameSite|SECURE_COOKIES=1/.test(e)));
  assert.ok(checkConfig(configFromEnv({ ...envOk, CORS_ORIGINS: '*' }), envOk).errors.some(e => /CORS_ORIGINS/.test(e)));
});

test('开发环境：不拦，只提醒', () => {
  const r = checkConfig(configFromEnv({}), {});
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.length >= 3);
});

const dir = mkdtempSync(join(tmpdir(), 'findai-deploy-'));
after(() => rmSync(dir, { recursive: true, force: true }));
async function boot(env: Record<string, string>) {
  const app = createApp({ ...configFromEnv(env), dbFile: ':memory:', dataDir: dir, webDir: dir, env });
  await new Promise<void>(r => app.server.listen(0, r));
  return { app, base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}` };
}

test('跨域：白名单里的前端域名能带 Cookie 调接口，别的域名不给', async () => {
  const { app, base } = await boot({ CORS_ORIGINS: 'https://www.example.com/', COOKIE_SAMESITE: 'None', SECURE_COOKIES: '1' });
  try {
    const pre = await fetch(`${base}/api/session`, { method: 'OPTIONS', headers: { origin: 'https://www.example.com', 'access-control-request-method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://www.example.com');
    assert.equal(pre.headers.get('access-control-allow-credentials'), 'true');
    assert.match(pre.headers.get('access-control-allow-headers')!, /x-file-name/);
    const get = await fetch(`${base}/api/session`, { headers: { origin: 'https://www.example.com' } });
    assert.equal(get.headers.get('access-control-allow-origin'), 'https://www.example.com');
    assert.match(get.headers.get('set-cookie')!, /SameSite=None; Max-Age=\d+; Secure/);
    const evil = await fetch(`${base}/api/session`, { headers: { origin: 'https://evil.example' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
  } finally { app.server.close(); }
});

test('请求 ID：每个响应都带；传进来的原样带回；默认 SameSite=Lax', async () => {
  const { app, base } = await boot({});
  try {
    const a = await fetch(`${base}/api/session`);
    assert.match(a.headers.get('x-request-id')!, /^[0-9a-f]{12}$/);
    assert.match(a.headers.get('set-cookie')!, /SameSite=Lax/);
    const b = await fetch(`${base}/api/nope`, { headers: { 'x-request-id': 'trace-123' } });
    assert.equal(b.headers.get('x-request-id'), 'trace-123');
    const h = await (await fetch(`${base}/healthz`)).json();
    assert.equal(h.storage, 'local');
  } finally { app.server.close(); }
});

test('限流按真实 IP：代理后面信任 X-Forwarded-For，不信任时用连接 IP', async () => {
  const trusted = await boot({ TRUST_PROXY: '1', RATE_LIMIT_PER_MIN: '2' });
  try {
    const post = (ip: string) => fetch(`${trusted.base}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ name: 'page_view' }) }).then(r => r.status);
    assert.deepEqual([await post('1.1.1.1'), await post('1.1.1.1'), await post('1.1.1.1'), await post('2.2.2.2')], [200, 200, 429, 200]);
  } finally { trusted.app.server.close(); }
  const direct = await boot({ TRUST_PROXY: '0', RATE_LIMIT_PER_MIN: '2' });
  try {
    const post = (ip: string) => fetch(`${direct.base}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ name: 'page_view' }) }).then(r => r.status);
    assert.deepEqual([await post('1.1.1.1'), await post('2.2.2.2'), await post('3.3.3.3')], [200, 200, 429], '伪造 X-Forwarded-For 绕不过限流');
  } finally { direct.app.server.close(); }
});
