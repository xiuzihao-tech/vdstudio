// 应用：组装数据库、供应方、路由，处理静态文件。createApp 便于测试时用内存库启动。
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { z } from 'zod';
import { openDb, newId } from './db.ts';
import { makeRepo } from './repo.ts';
import { loadProviders } from './providers/index.ts';
import { HttpError, Router, body, parseCookies, readBuffer, send, sendError, type Req } from './http.ts';
import { JobRunner, catIndex, personaOf, published, replaceWithNext, scheduleIndex, scheduleView, seedWorkspace, setDay, todayIso, ensureSchedule } from './services.ts';
import { PERSONAS, MODELS, CADENCE } from '../shared/catalog.ts';
import { checkCopy, findBanned } from '../shared/copy.ts';
import { genCost, genIssues, planShots } from '../shared/gen.ts';
import { isPublishDay } from '../shared/schedule.ts';
import * as S from '../shared/schemas.ts';
import type { CopyDraft, Workspace } from '../shared/types.ts';

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webm': 'video/webm', '.svg': 'image/svg+xml' };
const UPLOAD_LIMIT = 200 * 1024 * 1024;
const ASSET_TYPE = (mime: string) => mime.startsWith('video/') ? '视频' : mime.startsWith('audio/') ? '音频' : '照片';

export interface AppOptions { dbFile: string; dataDir: string; webDir: string }

export function createApp(o: AppOptions) {
  const db = openDb(o.dbFile);
  const repo = makeRepo(db);
  const providers = loadProviders();
  const runner = new JobRunner(repo, providers);
  const filesDir = join(o.dataDir, 'files');
  mkdirSync(filesDir, { recursive: true });
  for (const j of repo.failStaleJobs() as (ReturnType<typeof repo.failStaleJobs>[number] & { ws: string })[]) repo.refund(j.ws, j.cost, '服务重启退点', j.id);

  /** 每个请求找到当前用户和工作区；第一次访问自动建一个（M6 换成登录） */
  const ctxMap = new WeakMap<Req, { owner: string; ws: Workspace; setCookie?: string }>();
  function ctx(req: Req) {
    const hit = ctxMap.get(req); if (hit) return hit;
    let owner = req.cookies.fid, setCookie: string | undefined;
    if (!owner || !repo.ownerExists(owner)) { owner = repo.createOwner(); setCookie = `fid=${owner}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`; }
    let wsId = repo.currentWsId(owner);
    let ws = wsId ? repo.ws(wsId) : null;
    if (!ws) { ws = repo.wsByPersona(owner, 'designer') ?? seedWorkspace(db, repo, owner, 'designer'); repo.setCurrentWs(owner, ws.id); wsId = ws.id; }
    const c = { owner, ws, setCookie }; ctxMap.set(req, c); return c;
  }
  const W = (req: Req) => repo.ws(ctx(req).ws.id)!;
  const aiCtx = (ws: Workspace) => ({ persona: personaOf(ws.persona), positioning: ws.positioning });
  const topicOr404 = (ws: Workspace, id: string) => { const t = repo.topic(ws.id, id); if (!t) throw new HttpError(404, '选题不存在'); return t; };
  const planOr404 = (ws: Workspace, id: string) => { const p = repo.plan(ws.id, id); if (!p) throw new HttpError(404, '账号排期不存在'); return p; };
  const session = (ws: Workspace) => ({ workspace: ws, persona: personaOf(ws.persona), personas: PERSONAS.map(p => ({ id: p.id, n: p.n })), models: MODELS, today: todayIso() });
  const planPayload = (ws: Workspace) => repo.plans(ws.id).map(p => ({ plan: p, slots: scheduleView(repo, ws, p) }));

  const r = new Router();

  /* ---------- 会话与工作区 ---------- */
  r.get('/api/session', req => session(W(req)));
  r.post('/api/session/persona', async req => {
    const { persona } = await body(req, z.object({ persona: S.personaSchema }));
    const { owner } = ctx(req);
    const ws = repo.wsByPersona(owner, persona) ?? seedWorkspace(db, repo, owner, persona);
    repo.setCurrentWs(owner, ws.id);
    return session(ws);
  });
  r.put('/api/workspace/positioning', async req => { const p = await body(req, S.positioningSchema); repo.setPositioning(W(req).id, p); return session(W(req)); });
  r.put('/api/workspace/theme', async req => { const { theme } = await body(req, z.object({ theme: z.enum(['studio', 'cinema', 'glass', 'poster']) })); repo.setTheme(W(req).id, theme); return { ok: true }; });

  /* ---------- 选题 ---------- */
  r.get('/api/topics', req => {
    const ws = W(req), f = S.topicFilterSchema.parse(Object.fromEntries(req.query));
    const list = repo.topics(ws.id).filter(t => (f.cat === 'all' || t.cat === f.cat) && (f.dir === '不限' || t.dir === f.dir) && (f.type === '不限' || t.type === f.type)
      && (f.heat === '不限' || t.heat === f.heat) && (f.period === '不限' || t.ageMonths <= f.period) && (!f.fav || t.fav));
    return { topics: list, scheduled: scheduleIndex(repo, ws) };
  });
  r.get('/api/topics/all', req => { const ws = W(req); return { topics: repo.topics(ws.id), scheduled: scheduleIndex(repo, ws) }; });
  r.post('/api/topics', async req => {
    const ws = W(req), d = await body(req, S.newTopicSchema);
    return repo.insertTopic(ws.id, { ...d, cat: catIndex(ws.persona), k: d.k ?? personaOf(ws.persona).att[0], ageMonths: 0 });
  });
  r.post('/api/topics/:id/fav', async req => { const ws = W(req), { fav } = await body(req, z.object({ fav: z.boolean() })); topicOr404(ws, req.params.id); repo.setFav(ws.id, req.params.id, fav); return repo.topic(ws.id, req.params.id); });
  r.get('/api/topics/:id/angles', async req => { const ws = W(req); return { angles: await providers.topics.angles(aiCtx(ws), topicOr404(ws, req.params.id)) }; });
  r.post('/api/topics/from-case', async req => {
    const ws = W(req), d = await body(req, S.caseGenSchema), c = catIndex(ws.persona);
    const drafts = await providers.topics.fromCase(aiCtx(ws), d);
    return { topics: drafts.reverse().map(t => repo.insertTopic(ws.id, { ...t, cat: c, ageMonths: 0, source: 'ai' })).reverse() };
  });
  r.post('/api/topics/benchmark', async req => { const ws = W(req), d = await body(req, S.benchSchema); return providers.topics.analyzeBenchmark(aiCtx(ws), d); });
  r.post('/api/topics/from-materials', async req => {
    const ws = W(req), d = await body(req, S.matGenSchema);
    const assets = repo.assetsByIds(ws.id, d.assetIds); if (!assets.length) throw new HttpError(400, '先选至少 1 份素材');
    const t = await providers.topics.fromMaterials(aiCtx(ws), { keys: assets.map(a => a.k), note: d.note });
    return repo.insertTopic(ws.id, { ...t, cat: catIndex(ws.persona), ageMonths: 0, source: 'mat' });
  });

  /* ---------- 文案 ---------- */
  r.post('/api/copy/generate', async req => {
    const ws = W(req), d = await body(req, S.copyGenSchema), t = topicOr404(ws, d.topicId);
    const gen = await providers.copy.generate(aiCtx(ws), t, { kind: d.kind, len: d.len, tone: d.tone ?? ws.positioning.tone, version: d.version });
    const draft: CopyDraft = { ...gen, id: '', updatedAt: '', assetIds: repo.draftByTopic(ws.id, t.id)?.assetIds ?? [] };
    return { draft, check: checkCopy(draft) };
  });
  r.post('/api/copy/rewrite', async req => {
    const ws = W(req), d = await body(req, z.object({ draft: S.copyDraftSchema, how: z.enum(['live', 'short', 'long', 'alt']) }));
    const t = topicOr404(ws, d.draft.topicId);
    const out = await providers.copy.rewrite(aiCtx(ws), d.draft as CopyDraft, d.how, t.hook);
    return { ...out, check: checkCopy(out.draft) };
  });
  r.post('/api/copy/check', async req => { const d = await body(req, S.copyDraftSchema); return checkCopy(d as CopyDraft); });
  r.get('/api/drafts', req => ({ drafts: repo.drafts(W(req).id) }));
  r.get('/api/drafts/:topicId', req => ({ draft: repo.draftByTopic(W(req).id, req.params.topicId) }));
  r.put('/api/drafts', async req => { const ws = W(req), d = await body(req, S.copyDraftSchema); topicOr404(ws, d.topicId); return repo.upsertDraft(ws.id, d); });

  /* ---------- 工具 ---------- */
  r.post('/api/tools/banned', async req => { const { text } = await body(req, z.object({ text: z.string().max(5000) })); return { hits: findBanned(text) }; });
  r.post('/api/tools/humanize', async req => { const { text } = await body(req, z.object({ text: z.string().max(5000) })); return { text: await providers.copy.humanize(text) }; });
  r.post('/api/tools/transcribe', async req => {
    const ws = W(req), d = await body(req, z.object({ kind: z.enum(['audio', 'video']), ref: z.string().max(500) }));
    return { text: await providers.transcribe.transcribe(aiCtx(ws), d) };
  });
  r.post('/api/voice/clone', async req => {
    const ws = W(req), buf = await readBuffer(req.raw, 30 * 1024 * 1024);
    const consent = req.raw.headers['x-consent'] === 'yes';
    if (!consent) throw new HttpError(400, '需要确认是本人声音并同意授权');
    if (buf.length < 1000 && req.raw.headers['x-sample'] !== 'demo') throw new HttpError(400, '录音太短，至少 30 秒');
    runner.startVoiceClone(ws, { bytes: buf.length, mime: String(req.raw.headers['content-type'] ?? '') });
    return { voiceClone: 'busy' };
  });

  /* ---------- 素材 ---------- */
  r.get('/api/assets', req => ({ assets: repo.assets(W(req).id) }));
  r.post('/api/assets', async req => {
    const ws = W(req), mime = String(req.raw.headers['content-type'] ?? 'application/octet-stream');
    if (!/^(image|video|audio)\//.test(mime)) throw new HttpError(415, '只支持图片、视频、音频');
    const name = decodeURIComponent(String(req.raw.headers['x-file-name'] ?? '未命名')).slice(0, 80);
    const buf = await readBuffer(req.raw, UPLOAD_LIMIT);
    const ext = (extname(name) || '.' + (mime.split('/')[1] ?? 'bin')).toLowerCase().replace(/[^.a-z0-9]/g, '');
    const file = `${ws.id}/${newId('f')}${ext}`;
    mkdirSync(join(filesDir, ws.id), { recursive: true });
    writeFileSync(join(filesDir, file), buf);
    const keys = ['entry', 'live', 'kit', 'bed', 'stone', 'site', 'soft', 'store', 'hotel', 'new'];
    return repo.insertAsset(ws.id, { type: ASSET_TYPE(mime), name, k: keys[repo.assets(ws.id).length % keys.length], file, mime, size: buf.length, source: String(req.raw.headers['x-source'] ?? '上传').slice(0, 20) });
  });
  r.delete('/api/assets/:id', req => { if (!repo.deleteAsset(W(req).id, req.params.id)) throw new HttpError(404, '素材不存在'); return { ok: true }; });

  /* ---------- 生成 ---------- */
  r.post('/api/gen/check', async req => {
    const ws = W(req), g = await body(req, S.genSettingsSchema);
    const assets = repo.assetsByIds(ws.id, g.assetIds);
    return { issues: genIssues(g, ws.voiceClone), shots: planShots(g, assets.map(a => a.k), personaOf(ws.persona).att), cost: genCost(g), finalCost: genCost(g, true) };
  });
  r.post('/api/gen', async (req, res) => {
    const ws = W(req), d = await body(req, z.object({ settings: S.genSettingsSchema, final: z.boolean().default(false), title: z.string().max(80).default('') }));
    const blocking = genIssues(d.settings, ws.voiceClone).filter(i => i.blocking);
    if (blocking.length) throw new HttpError(422, blocking.map(i => i.text).join('；'));
    const title = d.title || d.settings.title || d.settings.copy.split('\n')[0]?.slice(0, 20) || '未命名';
    const out = runner.startVideo(ws, d.settings, d.final, title);
    if (!out.ok) throw new HttpError(402, out.error);
    res.statusCode = 201; return out.job;
  });
  r.get('/api/jobs', req => ({ jobs: repo.jobs(W(req).id) }));
  r.get('/api/jobs/:id', req => { const j = repo.job(W(req).id, req.params.id); if (!j) throw new HttpError(404, '任务不存在'); return j; });

  /* ---------- 排期 ---------- */
  r.get('/api/plans', req => ({ plans: planPayload(W(req)) }));
  r.post('/api/plans', async req => {
    const ws = W(req), { account } = await body(req, z.object({ account: z.string().trim().min(1).max(40) }));
    const base = repo.plans(ws.id)[0];
    repo.insertPlan(ws.id, { account, weekdays: [2], hour: base?.hour ?? 19.5, needOk: true, budget: 300, running: false, mix: base?.mix ?? [], added: [], skipped: [], backlog: [] });
    return { plans: planPayload(ws) };
  });
  r.patch('/api/plans/:id', async req => {
    const ws = W(req), p = planOr404(ws, req.params.id), d = await body(req, S.planPatchSchema);
    repo.savePlan(ws.id, { ...p, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) });
    return { plans: planPayload(ws) };
  });
  r.post('/api/plans/:id/slots/:date', async req => {
    const ws = W(req), p = planOr404(ws, req.params.id), date = S.dateSchema.parse(req.params.date), d = await body(req, S.slotActionSchema);
    const today = todayIso();
    let message = '';
    const slot = () => repo.slots(p.id).find(s => s.date === date);
    if ((d.action === 'approve' || d.action === 'next' || d.action === 'unpin') && date <= today) throw new HttpError(400, '已经过了审核时间');
    if (d.action === 'approve') { const s = slot(); if (!s) throw new HttpError(404, '这天没有选题'); repo.upsertSlot({ ...s, pin: 'fixed', why: s.why.replace(/^AI /, '') }); message = '已固定'; }
    if (d.action === 'unpin') { const s = slot(); if (s) repo.upsertSlot({ ...s, pin: 'cand' }); message = '已取消固定'; }
    if (d.action === 'next') { const t = replaceWithNext(repo, ws, p, date); message = t ? `换了一个：${t.title}` : '选题库里没有更多选题了'; }
    if (d.action === 'skip') { p.skipped = [...new Set([...p.skipped, date])]; repo.savePlan(ws.id, p); message = '跳过了这一天'; }
    if (d.action === 'add') { p.added = [...new Set([...p.added, date])]; p.skipped = p.skipped.filter(x => x !== date); repo.savePlan(ws.id, p); ensureSchedule(repo, ws, p); message = '加了一条，AI 预选了选题，等你审核'; }
    if (d.action === 'set') {
      if (!d.topicId) throw new HttpError(400, '缺少选题');
      if (date < today) throw new HttpError(400, '不能排到过去的日期');
      const t = topicOr404(ws, d.topicId);
      const from = setDay(repo, ws, p, date, t);
      message = from ? `已从 ${from.slice(5).replace('-', '/')} 挪到这天，原来那天由 AI 补了一个预选` : '已固定到这天';
    }
    return { message, plans: planPayload(ws) };
  });
  r.post('/api/plans/:id/approve-all', req => {
    const ws = W(req), p = planOr404(ws, req.params.id), today = todayIso(); let n = 0;
    repo.slots(p.id).forEach(s => { if (s.date > today && s.pin === 'cand' && isPublishDay(p, s.date)) { repo.upsertSlot({ ...s, pin: 'fixed' }); n++; } });
    return { message: `${n} 个选题已固定到对应日期`, plans: planPayload(ws) };
  });
  r.post('/api/plans/:id/reroll', req => {
    const ws = W(req), p = planOr404(ws, req.params.id), today = todayIso(); let n = 0;
    repo.slots(p.id).forEach(s => { if (s.date > today && s.pin === 'cand' && isPublishDay(p, s.date) && replaceWithNext(repo, ws, p, s.date)) n++; });
    return { message: n ? `AI 重新预选了 ${n} 条，已固定的不动` : '没有待审的选题', plans: planPayload(ws) };
  });
  r.post('/api/plans/:id/backlog', async req => {
    const ws = W(req), p = planOr404(ws, req.params.id), { topicId, remove } = await body(req, z.object({ topicId: z.string(), remove: z.boolean().default(false) }));
    topicOr404(ws, topicId);
    p.backlog = remove ? p.backlog.filter(x => x !== topicId) : [...new Set([...p.backlog, topicId])];
    repo.savePlan(ws.id, p);
    return { plans: planPayload(ws) };
  });
  r.get('/api/published', req => ({ items: published(repo, W(req)) }));

  /* ---------- 封面 ---------- */
  r.get('/api/covers', req => ({ covers: repo.covers(W(req).id) }));
  r.post('/api/covers', async req => {
    const ws = W(req), d = await body(req, z.object({ title: z.string().trim().min(1).max(40), style: z.string().max(20), generate: z.boolean().default(false) }));
    if (d.generate && !repo.charge(ws.id, 12, `封面 + 配图：${d.title}`, null)) throw new HttpError(402, '余额不足：需要 12 点');
    repo.insertCover(ws.id, d.title, d.style);
    return { covers: repo.covers(ws.id), balance: repo.ws(ws.id)!.balance };
  });
  void CADENCE;

  /* ---------- 静态文件 ---------- */
  const webRoot = resolve(o.webDir);
  function serveFile(res: ServerResponse, base: string, rel: string, fallback?: string) {
    const p = normalize(join(base, rel));
    if (!p.startsWith(base)) { res.writeHead(403).end(); return; }
    let f = p;
    if (!existsSync(f) || statSync(f).isDirectory()) { if (!fallback) { res.writeHead(404).end(); return; } f = join(base, fallback); }
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream', 'cache-control': f.endsWith('index.html') ? 'no-cache' : 'public, max-age=300' });
    createReadStream(f).pipe(res);
  }

  async function handle(raw: IncomingMessage, res: ServerResponse) {
    const url = new URL(raw.url ?? '/', 'http://x');
    const req: Req = { raw, method: raw.method ?? 'GET', path: url.pathname, query: url.searchParams, params: {}, cookies: parseCookies(raw.headers.cookie) };
    try {
      if (req.path.startsWith('/api/')) {
        const m = r.match(req.method, req.path);
        if (!m) throw new HttpError(404, '接口不存在');
        req.params = m.params;
        const c = ctx(req);
        if (c.setCookie) res.setHeader('set-cookie', c.setCookie);
        const out = await m.h(req, res);
        send(res, res.statusCode && res.statusCode !== 200 ? res.statusCode : 200, out);
        return;
      }
      if (req.path.startsWith('/files/')) {
        const c = ctx(req), rel = req.path.slice(7);
        if (!rel.startsWith(c.ws.id + '/') && !repo.ws(rel.split('/')[0])) throw new HttpError(404, '文件不存在');
        return serveFile(res, resolve(filesDir), rel);
      }
      serveFile(res, webRoot, req.path === '/' ? 'index.html' : req.path.slice(1), 'index.html');
    } catch (e) { sendError(res, e); }
  }

  return { server: createServer((q, s) => { void handle(q, s); }), db, repo };
}
