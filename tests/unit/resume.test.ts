// 任务可恢复：生成到一半服务重启，重启后接着查已提交的任务，不重复提交（不重复花钱），最后成功；
// 还没提交出去的任务（或 Mock）照旧标失败并退点。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

process.env.MOCK_DELAY_MS = '0';
process.env.TODAY = '2026-10-21';
const { createApp } = await import('../../src/server/app.ts');

let creates = 0, holding = true;
const gw = createServer((q, s) => {
  q.resume();
  q.on('end', () => {
    const json = (j: unknown) => { s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify(j)); };
    if (q.method === 'POST' && q.url === '/v1/videos/generations') { creates++; return json({ code: 200, data: { id: `task_${creates}`, status: 'submitted' } }); }
    const m = q.url!.match(/\/v1\/videos\/generations\/(task_\d+)$/);
    if (m) return json(holding ? { id: m[1], status: 'in_progress', progress: 40 } : { id: m[1], status: 'completed', metadata: { url: `http://127.0.0.1:${(gw.address() as AddressInfo).port}/cdn/${m[1]}.mp4` } });
    s.writeHead(404).end('{}');
  });
});
await new Promise<void>(r => gw.listen(0, r));
const dir = mkdtempSync(join(tmpdir(), 'findai-resume-'));
after(() => { gw.close(); rmSync(dir, { recursive: true, force: true }); });

const env = (poll: string) => ({ VIDEO_BASE_URL: `http://127.0.0.1:${(gw.address() as AddressInfo).port}/v1`, VIDEO_API_KEY: 'k', VIDEO_POLL_MS: poll, COMPOSE: 'off' });
async function boot(poll: string) {
  const app = createApp({ dbFile: join(dir, 'app.db'), dataDir: dir, webDir: dir, env: env(poll) });
  await new Promise<void>(r => app.server.listen(0, r));
  return { app, base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}` };
}
const settings = { copy: '一\n二', model: 's20f', len: 10, ratio: '9:16', res: '720p', draft: false, voice: 'p1', speed: 1, bgm: '', subs: true, ambience: true, cover: false };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

test('重启后接着查：不重复提交，任务最终成功，点数不退', async () => {
  // 第一个实例：提交后要隔很久才查（相当于提交完就“崩了”）
  const a = await boot('600000');
  let cookie = '';
  const r1 = await fetch(`${a.base}/api/gen`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings, title: '玄关' }) });
  cookie = r1.headers.get('set-cookie')!.split(';')[0];
  const job = await r1.json();
  for (let i = 0; i < 50 && creates < 2; i++) await wait(20);
  assert.equal(creates, 2, '两镜都提交了');
  const balance = (await (await fetch(`${a.base}/api/session`, { headers: { cookie } })).json()).workspace.balance;
  a.app.server.close(); a.app.db.close();

  // 第二个实例（同一个数据库）：接着查
  holding = false;
  const b = await boot('5');
  try {
    let st: any;
    for (let i = 0; i < 100; i++) { st = await (await fetch(`${b.base}/api/jobs/${job.id}`, { headers: { cookie } })).json(); if (st.status !== 'running') break; await wait(20); }
    assert.equal(st.status, 'done', st.error);
    assert.equal(creates, 2, '重启后没有重复提交');
    assert.deepEqual(st.output.shots.map((s: any) => s.videoUrl.replace(/^.*\/cdn\//, '')), ['task_1.mp4', 'task_2.mp4'], '用的是重启前提交的那两个任务');
    assert.equal((await (await fetch(`${b.base}/api/session`, { headers: { cookie } })).json()).workspace.balance, balance, '成功了就不退点');
  } finally { b.app.server.close(); b.app.db.close(); }
});

test('还没提交出去的任务：重启后标失败并退点', async () => {
  const c = await boot('5');
  const r = await fetch(`${c.base}/api/session`);
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  const before = (await r.json()).workspace.balance;
  // 直接在库里造一个“提交前就崩了”的任务：已扣 50 点、没有任何任务 ID
  const ws = (await (await fetch(`${c.base}/api/session`, { headers: { cookie } })).json()).workspace.id;
  c.app.repo.charge(ws, 50, '测试', null);
  const job = c.app.repo.insertJob(ws, { kind: 'video', steps: ['a'], cost: 50, title: '崩了', input: settings });
  c.app.repo.updateJob(job.id, { status: 'running' });
  c.app.repo.setJobExternal(job.id, { tasks: [null, null], shots: [], final: false });
  c.app.server.close(); c.app.db.close();
  const d = await boot('5');
  try {
    const st = await (await fetch(`${d.base}/api/jobs/${job.id}`, { headers: { cookie } })).json();
    assert.equal(st.status, 'failed'); assert.match(st.error, /服务重启/);
    assert.equal((await (await fetch(`${d.base}/api/session`, { headers: { cookie } })).json()).workspace.balance, before, '点数退回');
  } finally { d.app.server.close(); d.app.db.close(); }
});
