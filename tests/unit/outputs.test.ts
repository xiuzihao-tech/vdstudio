// 生成结果转存：假中转站（返回形态照土豆实测）+ 真的 mp4 → 每镜转存到自己的存储、合成整条、/files 能取到；
// 对象存储模式下 /files 302 跳到签名链接；中转站视频下载失败时任务仍算成功、先用原链接。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { hasFfmpeg } from '../../src/server/compose.ts';

process.env.MOCK_DELAY_MS = '0';
process.env.TODAY = '2026-10-21';
const { createApp } = await import('../../src/server/app.ts');

const dir = mkdtempSync(join(tmpdir(), 'findai-out-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const clip = join(dir, 'clip.mp4');
if (hasFfmpeg()) spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=25:duration=1', '-pix_fmt', 'yuv420p', clip]);
const CLIP = hasFfmpeg() ? readFileSync(clip) : Buffer.from('not-really-a-video');

let brokenCdn = false;
const s3 = new Map<string, Buffer>();
const read = (r: IncomingMessage) => new Promise<Buffer>(ok => { const c: Buffer[] = []; r.on('data', x => c.push(x)); r.on('end', () => ok(Buffer.concat(c))); });
const gw = createServer(async (q, s) => {
  const raw = await read(q), url = q.url!;
  const json = (code: number, j: unknown) => { s.writeHead(code, { 'content-type': 'application/json' }); s.end(JSON.stringify(j)); };
  if (q.method === 'POST' && url === '/v1/videos/generations') return json(200, { code: 200, data: { id: `task_${Math.random().toString(36).slice(2, 8)}`, status: 'submitted', progress: 0 } });
  const m = url.match(/^\/v1\/videos\/generations\/(task_\w+)$/);
  if (m) return json(200, { id: m[1], object: 'video', status: 'completed', progress: 100, metadata: { url: `http://127.0.0.1:${port}/cdn/${m[1]}.mp4` } });
  if (url.startsWith('/cdn/')) { if (brokenCdn) { s.writeHead(500).end(); return; } s.writeHead(200, { 'content-type': 'video/mp4' }).end(CLIP); return; }
  if (url.startsWith('/s3/')) {  // 假对象存储（路径风格）
    if (q.method === 'PUT') { s3.set(url.split('?')[0], raw); s.writeHead(200).end(); return; }
    const b = s3.get(url.split('?')[0]); if (!b) { s.writeHead(404).end(); return; } s.writeHead(200).end(b); return;
  }
  json(404, {});
});
await new Promise<void>(r => gw.listen(0, r));
const port = (gw.address() as AddressInfo).port;
after(() => gw.close());

const ENV = { VIDEO_BASE_URL: `http://127.0.0.1:${port}/v1`, VIDEO_API_KEY: 'k', VIDEO_POLL_MS: '5', COMPOSE: 'auto' };
const settings = { copy: '玄关十秒归位\n岩板台面', model: 's20f', len: 10, ratio: '9:16', res: '720p', draft: false, voice: 'p1', speed: 1, bgm: '温暖钢琴', subs: true, ambience: true, cover: false };

async function boot(env: Record<string, string>) {
  const d = mkdtempSync(join(dir, 'app-'));
  const app = createApp({ dbFile: ':memory:', dataDir: d, webDir: d, env: { ...ENV, ...env } });
  await new Promise<void>(r => app.server.listen(0, r));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  let cookie = '';
  const call = async (method: string, path: string, data?: unknown) => {
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', cookie }, body: data === undefined ? undefined : JSON.stringify(data) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return res;
  };
  return { app, base, call };
}
async function runJob(call: Awaited<ReturnType<typeof boot>>['call']) {
  const j = await (await call('POST', '/api/gen', { settings, title: '玄关' })).json();
  assert.ok(j.id, JSON.stringify(j));
  for (let i = 0; i < 200; i++) {
    const r = await (await call('GET', `/api/jobs/${j.id}`)).json();
    if (r.status === 'done' || r.status === 'failed') return r;
    await new Promise(x => setTimeout(x, 30));
  }
  throw new Error('任务一直没结束');
}

test('本机存储：每镜转存、合成整条、/files 能下载', async () => {
  const { app, call } = await boot({});
  try {
    const job = await runJob(call);
    assert.equal(job.status, 'done', job.error);
    assert.ok(job.output.shots.length >= 2);
    for (const s of job.output.shots) {
      assert.match(s.videoUrl, /^\/files\/ws_\w+\/job_\w+\/shot\d+\.mp4$/);
      assert.match(s.sourceUrl, /\/cdn\/task_/);
      const f = await call('GET', s.videoUrl);
      assert.equal(f.status, 200); assert.equal(Buffer.from(await f.arrayBuffer()).length, CLIP.length);
    }
    if (hasFfmpeg()) {
      assert.match(job.output.videoUrl, /^\/files\/ws_\w+\/job_\w+\.mp4$/, job.output.composeError);
      assert.equal((await call('GET', job.output.videoUrl)).status, 200);
    }
  } finally { app.server.close(); }
});

test('中转站视频下载失败：任务照样成功，先用中转站原链接', async () => {
  const { app, call } = await boot({});
  brokenCdn = true;
  try {
    const job = await runJob(call);
    assert.equal(job.status, 'done');
    assert.match(job.output.shots[0].videoUrl, /^http:\/\/127\.0\.0\.1:\d+\/cdn\//);
  } finally { brokenCdn = false; app.server.close(); }
});

test('对象存储：转存进桶、/files 302 跳到签名链接、上传的素材也进桶', async () => {
  const { app, call } = await boot({ STORAGE: 's3', S3_ENDPOINT: `http://127.0.0.1:${port}`, S3_BUCKET: 's3', S3_REGION: 'oss-cn-hangzhou', S3_ACCESS_KEY_ID: 'AK', S3_SECRET_ACCESS_KEY: 'SK', S3_FORCE_PATH_STYLE: '1' });
  try {
    const job = await runJob(call);
    assert.equal(job.status, 'done', job.error);
    const key = job.output.shots[0].videoUrl.slice(7);
    assert.ok(s3.has(`/s3/${key}`), [...s3.keys()].join());
    const r = await call('GET', job.output.shots[0].videoUrl);
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location')!, new RegExp(`^http://127\\.0\\.0\\.1:${port}/s3/${key.replace(/\//g, '\\/')}\\?X-Amz-Algorithm=`));
    const up = await call('POST', '/api/assets', undefined);
    assert.equal(up.status, 415);
    const png = await fetch(r.url.replace(/\/files\/.*/, '/api/assets'), { method: 'POST', headers: { 'content-type': 'image/png', 'x-file-name': 'a.png', cookie: '' }, body: new Uint8Array([1, 2, 3]) as unknown as BodyInit });
    const a = await png.json();
    assert.ok(s3.has(`/s3/${a.url.slice(7)}`), '上传的素材进了桶');
  } finally { app.server.close(); }
});
