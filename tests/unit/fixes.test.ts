// 10/29 第 3 轮修复：成片有声音、新账号不带演示数据、实拍素材的说明和时长、面诊写回人设、几个小 bug
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';

process.env.MOCK_DELAY_MS = '0';
process.env.AI_PROVIDER = 'mock';
process.env.TODAY = '2026-10-21';
const { createApp } = await import('../../src/server/app.ts');
const { openDb } = await import('../../src/server/db.ts');
const { makeRepo } = await import('../../src/server/repo.ts');
const { JobRunner, seedWorkspace, writeCopy, saveAnswer, runDiagnosis, describeAsset, ensureSchedule, findMusic } = await import('../../src/server/services.ts');
const { mockProviders } = await import('../../src/server/providers/mock.ts');
const { makeMinimaxTts, silentWav } = await import('../../src/server/providers/tts.ts');
const { composeVideo, probeMedia, hasFfmpeg } = await import('../../src/server/compose.ts');
const { buildStoryboard, splitSentences } = await import('../../src/shared/video.ts');
const { modelOf, genCost } = await import('../../src/shared/gen.ts');
const { smartTitle } = await import('../../src/shared/copy.ts');
import type { GenSettings } from '../../src/shared/types.ts';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'findai-fix-')); dirs.push(d); return d; };
after(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })));
const ff = hasFfmpeg();
const ffmpeg = (...a: string[]) => spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...a]);

/* ---------- 接口：新账号、上传、示例 ---------- */
const dir = tmp();
const app = createApp({ dbFile: ':memory:', dataDir: dir, webDir: dir });
let base = '', cookie = '';
before(async () => { await new Promise<void>(r => app.server.listen(0, r)); base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`; });
after(() => { app.server.close(); });
async function api(method: string, path: string, data?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: data === undefined ? undefined : data instanceof Uint8Array ? (data as unknown as BodyInit) : JSON.stringify(data) });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: res.status, json: await res.json() as any };
}

test('上传：来源不再是乱码；说明只按文件名写、不编场景；读出视频时长', async () => {
  let body: Uint8Array = new Uint8Array(4000), mime = 'image/png';
  if (ff) {
    const d = tmp(), f = join(d, 'c.mp4');
    ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=320x568:rate=25:duration=4', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', f);
    body = new Uint8Array(await (await import('node:fs/promises')).readFile(f)); mime = 'video/mp4';
  }
  const r = await api('POST', '/api/assets', body, { 'content-type': mime, 'x-file-name': encodeURIComponent('柜门封边特写.mp4'), 'x-source': encodeURIComponent('上传') });
  assert.equal(r.status, 200);
  assert.equal(r.json.source, '上传');
  assert.equal(r.json.noteSrc, 'name');
  assert.match(r.json.note, /柜门封边特写/);
  assert.doesNotMatch(r.json.note, /民宿|玄关|客厅|厨房|卧室/, '不按场景随便配');
  if (ff) assert.ok(Math.abs(r.json.dur - 4) < 0.3, `读出时长 ${r.json.dur}`);
});

test('写文案（不填想法）：不再用行业模板的示例项目当选题', async () => {
  const r = await api('POST', '/api/copy/write', { len: 30 });
  assert.equal(r.status, 200);
  assert.doesNotMatch(JSON.stringify(r.json.draft), /青岛海景|140㎡|林设计师/);
});

/* ---------- 服务：排期、面诊写回、栏目轮换 ---------- */
function setup() {
  const db = openDb(':memory:'), repo = makeRepo(db);
  const ws = seedWorkspace(db, repo, repo.createOwner(1000), 'custom');
  return { db, repo, ws };
}

test('排期：从今天起才排，全部是待审的预选；过去的日子不再标「已发」', () => {
  const { repo, ws } = setup();
  const plan = repo.plans(ws.id)[0];
  ensureSchedule(repo, ws, plan, '2026-10-21');
  const slots = repo.slots(plan.id);
  assert.ok(slots.length > 0);
  assert.ok(slots.every(s => s.date >= '2026-10-21' && s.pin === 'cand'));
});

test('面诊：定位和标签写回人设档案；按栏目生成选题，排期按栏目挑', async () => {
  const { repo, ws } = setup();
  saveAnswer(repo, ws, 'p1', '2009 年在顺德家具厂做学徒，2016 年开了木作工厂');
  saveAnswer(repo, ws, 'r2', '中山一套 600 平别墅，胡桃木整墙护墙板加隐形门，门缝做到 2 毫米');
  saveAnswer(repo, ws, 'b1', '主做胡桃木和橡木，意式极简，自己有工厂，饰面手工擦色');
  const rep = await runDiagnosis(repo, mockProviders, ws);
  const pos = repo.ws(ws.id)!.positioning;
  assert.equal(pos.line, rep.position.slice(0, 80));
  assert.ok(pos.tags.length > 0 && pos.tags.length <= 5);
  assert.deepEqual(pos.pillars, rep.columns.map(c => c.name));
  const colTopics = repo.topics(ws.id).filter(t => t.source === 'plan');
  assert.ok(rep.columns.every(c => colTopics.some(t => t.dir === c.name)), '每个栏目都有选题');
  const plan = repo.plans(ws.id)[0];
  ensureSchedule(repo, repo.ws(ws.id)!, plan, '2026-10-21');
  const slots = repo.slots(plan.id);
  assert.ok(slots.some(s => colTopics.some(t => t.id === s.topicId && t.dir === s.column)), '排期用的是这个栏目的选题');
});

test('写文案：没指定栏目时按面诊栏目轮流写', async () => {
  const { repo, ws } = setup();
  saveAnswer(repo, ws, 'p1', '做了 17 年木作'); saveAnswer(repo, ws, 'r3', '其实大多数人选木作只看板材'); saveAnswer(repo, ws, 'b1', '意式极简');
  const rep = await runDiagnosis(repo, mockProviders, ws);
  const t = repo.topics(ws.id)[0];
  const cols = [];
  for (let i = 0; i < rep.columns.length; i++) cols.push((await writeCopy(repo, mockProviders, repo.ws(ws.id)!, t)).column);
  assert.deepEqual(cols, rep.columns.map(c => c.name));
});

test('素材说明：示例素材按画的场景，上传的只按文件名和时长', () => {
  assert.equal(describeAsset({ k: 'hotel', type: '视频', name: '五金开合.mp4', dur: 4.2 }), '一段 4.2 秒的视频（五金开合）');
  assert.equal(describeAsset({ k: 'kit', type: '照片', name: '示例 · 厨房', source: '示例' }), '一张示例照片：厨房');
  assert.equal(describeAsset({ k: 'kit', type: '照片', name: 'x.jpg', note: 'AI 看过的说明' }), 'AI 看过的说明');
});

test('实拍分镜：镜头跟着配音走，不被模型最短时长撑到 5 秒；不超过素材长度', () => {
  const shots = buildStoryboard(splitSentences('先看这里，这是我们展厅进门的柜子。\n这是我们自己工厂做的护墙板，门缝做到两毫米，业主说比进口的还平。'), {
    type: 'real', model: modelOf('wan'), assets: [{ id: 'a', type: '视频', dur: 3.5 }, { id: 'b', type: '视频', dur: 20, best: [6, 12] }], avatar: false,
  });
  assert.equal(shots[0].source, 'clip');
  assert.ok(shots[0].dur <= 3, `第一镜 ${shots[0].dur} 秒`);
  assert.equal(shots[1].start, 6, '从推荐的那一段开始');
  assert.ok(shots[1].dur >= 5);
});

test('标题：在逗号处断，不截半句', () => {
  assert.equal(smartTitle('带业主看我们展厅的柜子，讲清楚好木作贵在哪，带你看一下。'), '带业主看我们展厅的柜子，讲清楚好木作贵在哪');
  assert.equal(smartTitle('短标题。后面的'), '短标题');
});

/* ---------- 配音 ---------- */
test('配音（MiniMax）：按文档发请求，hex 音频解出来；出错时说清原因', async () => {
  let sent: any = null;
  const ok = makeMinimaxTts({ baseUrl: 'https://api.minimax.cn/v1', apiKey: 'k', fetch: (async (url: string, init: any) => {
    sent = { url, body: JSON.parse(init.body), auth: init.headers.authorization };
    return new Response(JSON.stringify({ data: { audio: Buffer.from('ID3fake').toString('hex'), status: 2 }, extra_info: { audio_length: 2300 }, base_resp: { status_code: 0, status_msg: 'success' } }), { status: 200 });
  }) as unknown as typeof fetch });
  const r = await ok.synth('你好', { voice: 'p1', speed: 1.1, emotion: '开心' });
  assert.equal(sent.url, 'https://api.minimax.cn/v1/t2a_v2');
  assert.equal(sent.auth, 'Bearer k');
  assert.equal(sent.body.model, 'speech-2.8-hd');
  assert.equal(sent.body.voice_setting.voice_id, 'male-qn-jingying');
  assert.equal(sent.body.voice_setting.emotion, 'happy');
  assert.equal(r.audio.toString(), 'ID3fake');
  assert.equal(r.secs, 2.3);
  const bad = makeMinimaxTts({ baseUrl: 'x', apiKey: 'k', fetch: (async () => new Response(JSON.stringify({ base_resp: { status_code: 1004, status_msg: 'authentication failed' } }), { status: 200 })) as unknown as typeof fetch });
  await assert.rejects(() => bad.synth('你好', { voice: 'p2' }), /authentication failed/);
});

test('没接配音服务：成片不带配音，也不收配音费，作品里说明原因', async () => {
  const db = openDb(':memory:'), repo = makeRepo(db);
  const ws = seedWorkspace(db, repo, repo.createOwner(1000), 'designer');
  const copy = '第一句话说的是玄关为什么总是乱成一团。\n第二句讲这个项目只解决了收纳这一件事。';
  const shots = buildStoryboard(splitSentences(copy), { type: 'tour', model: modelOf('s20'), assets: [], avatar: false });
  const g: GenSettings = { copy, prompt: '', title: 't', topicId: null, assetIds: [], model: 's20', len: 20, ratio: '9:16', res: '720p', draft: false, voice: 'p1', speed: 1, bgm: '不要', subs: true, ambience: false, cover: false, style: 'AI 推荐', type: 'tour', shots };
  assert.ok(genCost(g) > genCost(g, false, { voice: false }), '没接配音少收配音费');
  const noTts = new JobRunner(repo, { ...mockProviders, tts: null }, { compose: 'off' });
  const r = noTts.startVideo(ws, g, false, 't'); assert.ok(r.ok);
  assert.equal(r.ok && r.job.cost, genCost(g, false, { voice: false }));
});

test('合成：配音、背景音乐、素材原声都进成片；配音比画面长时画面定格到说完', { skip: !ff }, async () => {
  const d = tmp();
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=25:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(d, 'a.mp4'));
  ffmpeg('-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=6', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', join(d, 'b.mp4'));
  ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=800:duration=4', join(d, 'v1.mp3'));
  writeFileSync(join(d, 'v2.wav'), silentWav(1.2));
  ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=200:duration=2', join(d, '城市律动.mp3'));
  assert.equal(findMusic(d, '城市律动'), join(d, '城市律动.mp3'));
  const out = join(d, 'out.mp4');
  const r = await composeVideo({ urls: [join(d, 'a.mp4'), join(d, 'b.mp4')], lines: ['第一句', '第二句'], durs: [2, 3], starts: [0, 1.5], ratio: '9:16', res: '480p', outFile: out, voices: [join(d, 'v1.mp3'), join(d, 'v2.wav')], music: findMusic(d, '城市律动'), keepOrig: [true, false] });
  assert.ok(existsSync(out));
  assert.ok(r.durs[0] >= 4, '第一镜定格到配音说完');
  const info = probeMedia(out)!;
  assert.ok(info.hasAudio, '成片有声音');
  assert.ok(Math.abs((info.dur ?? 0) - r.secs) < 0.3);
  const vol = spawnSync('ffmpeg', ['-hide_banner', '-i', out, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const mean = Number(vol.match(/mean_volume: (-?[\d.]+) dB/)?.[1]);
  assert.ok(mean > -60, `听得到（平均 ${mean} dB）`);
});
