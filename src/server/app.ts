// 应用：组装数据库、供应方、路由，处理静态文件。createApp 便于测试时用内存库启动。
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { z } from 'zod';
import { openDb, newId } from './db.ts';
import { makeAuth, type User } from './auth.ts';
import { configFromEnv, type Config } from './config.ts';
import { makeStorage } from './storage/index.ts';
import { shrinkImage, FRAME_INLINE_LIMIT } from './compose.ts';
import { CLIENT_EVENTS, makeOps } from './ops.ts';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { makeRepo } from './repo.ts';
import { loadProviders } from './providers/index.ts';
import { HttpError, Router, body, parseCookies, readBuffer, send, sendError, type Req } from './http.ts';
import { JobRunner, opsTick, withProgress, catIndex, personaOf, published, replaceWithNext, scheduleIndex, scheduleView, seedWorkspace, setDay, todayIso, ensureSchedule } from './services.ts';
import { PERSONAS, MODELS, CADENCE, TUDOU_CAPS, withCaps } from '../shared/catalog.ts';
import { checkCopy, findBanned } from '../shared/copy.ts';
import { genCost, genIssues, setVideoModels, shotsOf, videoModels } from '../shared/gen.ts';
import { voiceSecs } from '../shared/video.ts';
import { isPublishDay } from '../shared/schedule.ts';
import * as S from '../shared/schemas.ts';
import type { CopyDraft, Workspace } from '../shared/types.ts';

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webm': 'video/webm', '.svg': 'image/svg+xml' };
const UPLOAD_LIMIT = 200 * 1024 * 1024;
const ASSET_TYPE = (mime: string) => mime.startsWith('video/') ? '视频' : mime.startsWith('audio/') ? '音频' : '照片';

export type AppOptions = { dbFile: string; dataDir: string; webDir: string; env?: NodeJS.ProcessEnv } & Partial<Config>;

export function createApp(opts: AppOptions) {
  const o: Config & AppOptions = { ...configFromEnv({}), ...opts };
  const db = openDb(o.dbFile);
  const repo = makeRepo(db);
  const ops = makeOps(db);
  const ai = loadProviders(o.env ?? process.env, { get: k => ops.getSetting(k) });
  const { providers, info: providerInfo } = ai;
  // 视频档位按实际接入的服务显示能力（土豆：Seedance 系列最高 720p 等）；没接真实服务时用通用目录
  setVideoModels(providerInfo.video === 'newapi' ? withCaps(MODELS, TUDOU_CAPS) : MODELS);
  console.log(`AI 供应方：文案 ${providerInfo.copy}，视频 ${providerInfo.video}`);
  /** 素材图能不能当首帧发给视频服务：有对象存储签名链接、有公网地址，或视频服务接受 base64 */
  const firstFrameOk = () => !!storage.directUrl || !!o.publicBaseUrl || !!providers.video.inlineImages;
  /** 签名文件链接：给视频服务取首帧用，默认 2 小时有效 */
  const signKey = o.fileSignSecret ?? randomBytes(32).toString('hex');
  const sign = (rel: string, exp: number) => createHmac('sha256', signKey).update(`${rel}:${exp}`).digest('base64url');
  const signedUrl = (rel: string, ttlSec = 7200) => { const exp = Math.floor(Date.now() / 1000) + ttlSec; return `/files/${rel}?exp=${exp}&sig=${sign(rel, exp)}`; };
  const validSig = (rel: string, exp: string | null, sig: string | null) => {
    if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
    const a = Buffer.from(sign(rel, Number(exp))), b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const filesDir = join(o.dataDir, 'files');
  const storage = makeStorage(o.env ?? process.env, filesDir);
  console.log(`文件存储：${storage.kind === 's3' ? `对象存储 ${(o.env ?? process.env).S3_BUCKET}` : filesDir}`);
  const runner = new JobRunner(repo, providers, { compose: o.compose, font: o.subtitleFont, storage, onDone: (ws, job, ok) => ops.track(repo.ws(ws)?.ownerId ?? '', ws, ok ? 'gen_done' : 'gen_failed', { job: job.id, cost: job.cost }) }, async a => {
    if (!a.url || !a.mime?.startsWith('image/')) return null;
    const key = a.url.slice(7);
    // 有公网地址：给签名链接（对象存储直接给它的签名链接）；本机运行（没有公网地址）：把图片内联成 Base64 发给视频服务
    if (storage.directUrl) return storage.directUrl(key, 7200);
    if (o.publicBaseUrl) return `${o.publicBaseUrl.replace(/\/$/, '')}${signedUrl(key)}`;
    if (!providers.video.inlineImages) return null; // 只认公网链接的视频服务：发了也会被忽略，不发
    const buf = await storage.get(key).catch(() => null);
    if (!buf) return null;
    const small = buf.length <= FRAME_INLINE_LIMIT ? buf : await shrinkImage(buf);
    return small ? `data:${small === buf ? a.mime : 'image/jpeg'};base64,${small.toString('base64')}` : null;
  });
  // 重启前没跑完的任务：已经在视频服务提交过的接着查（不重复花钱），其余标失败并退点
  {
    const canResume = (j: { kind: string }, ext: { tasks: (string | null)[] } | null) => !!providers.video.resumable && j.kind.startsWith('video') && !!ext?.tasks.some(Boolean);
    const { resume, failed } = repo.staleJobs(canResume);
    for (const j of failed) repo.refund(j.ws, j.cost, '服务重启退点', j.id);
    for (const j of resume) runner.resume(j.ws, j);
  }

  const auth = makeAuth(db);
  auth.purgeExpired();
  const cookie = (k: string, v: string, maxAge: number) => `${k}=${v}; Path=/; HttpOnly; SameSite=${o.cookieSameSite}; Max-Age=${maxAge}${o.secureCookies ? '; Secure' : ''}`;

  /**
   * 每个请求找到当前用户和工作区。
   * 已登录：用账号的数据；未登录：AUTH_REQUIRED 时拒绝，否则用匿名 Cookie（第一次访问自动建），注册时匿名数据原样带进账号。
   */
  const ctxMap = new WeakMap<Req, { owner: string; ws: Workspace; user: User | null; setCookie?: string }>();
  function ctx(req: Req) {
    const hit = ctxMap.get(req); if (hit) return hit;
    const user = auth.userBySession(req.cookies.sid);
    let owner: string, setCookie: string | undefined;
    if (user) owner = user.ownerId;
    else {
      if (o.authRequired) throw new HttpError(401, '请先登录');
      owner = req.cookies.fid;
      if (!owner || !repo.ownerExists(owner)) { owner = repo.createOwner(o.initialPoints); setCookie = cookie('fid', owner, 31536000); }
    }
    let ws = (() => { const id = repo.currentWsId(owner); const w = id ? repo.ws(id) : null; return w && w.ownerId === owner ? w : null; })();
    if (!ws) { ws = repo.wsByPersona(owner, 'designer') ?? seedWorkspace(db, repo, owner, 'designer'); repo.setCurrentWs(owner, ws.id); }
    const c = { owner, ws, user, setCookie }; ctxMap.set(req, c); return c;
  }
  const W = (req: Req) => repo.ws(ctx(req).ws.id)!;
  const aiCtx = (ws: Workspace) => ({ persona: personaOf(ws.persona), positioning: ws.positioning });
  const topicOr404 = (ws: Workspace, id: string) => { const t = repo.topic(ws.id, id); if (!t) throw new HttpError(404, '选题不存在'); return t; };
  const planOr404 = (ws: Workspace, id: string) => { const p = repo.plan(ws.id, id); if (!p) throw new HttpError(404, '账号排期不存在'); return p; };
  const isAdmin = (u: User | null) => !!u && o.adminEmails.includes(u.email);
  const session = (ws: Workspace, req: Req) => ({ user: ctx(req).user && { email: ctx(req).user!.email, name: ctx(req).user!.name }, isAdmin: isAdmin(ctx(req).user), authRequired: !!o.authRequired, inviteRequired: o.inviteRequired,
    limits: { dailyJobs: o.dailyJobsPerUser, jobsToday: ops.jobsToday(ctx(req).owner), genPaused: ops.genPaused() }, ai: { ...providerInfo, firstFrame: firstFrameOk() }, workspace: (({ ownerId: _o, ...w }: Workspace & { ownerId?: string }) => w)(ws), persona: personaOf(ws.persona), personas: PERSONAS.map(p => ({ id: p.id, n: p.n })), models: videoModels(), today: todayIso() });
  const planPayload = (ws: Workspace) => repo.plans(ws.id).map(p => ({ plan: p, slots: withProgress(repo, ws, p, scheduleView(repo, ws, p)) }));

  const r = new Router();

  /* ---------- 会话与工作区 ---------- */
  r.get('/api/session', req => { ops.track(ctx(req).owner, ctx(req).ws.id, 'session'); return session(W(req), req); });
  r.post('/api/session/persona', async req => {
    const { persona } = await body(req, z.object({ persona: S.personaSchema }));
    const { owner } = ctx(req);
    const ws = repo.wsByPersona(owner, persona) ?? seedWorkspace(db, repo, owner, persona);
    repo.setCurrentWs(owner, ws.id);
    return session(ws, req);
  });
  r.put('/api/workspace/positioning', async req => { const p = await body(req, S.positioningSchema); repo.setPositioning(W(req).id, p); return session(W(req), req); });
  r.put('/api/workspace/theme', async req => { const { theme } = await body(req, z.object({ theme: z.enum(['studio', 'cinema', 'glass', 'poster']) })); repo.setTheme(W(req).id, theme); return { ok: true }; });

  /* ---------- 账号 ---------- */
  const credSchema = z.object({ email: z.string().trim().toLowerCase().email('邮箱格式不对').max(120), password: z.string().min(8, '密码至少 8 位').max(128) });
  r.post('/api/auth/register', async (req, res) => {
    const d = await body(req, credSchema.extend({ name: z.string().trim().min(1, '填一下名字').max(40), invite: z.string().max(40).optional() }));
    const out = await auth.register(d.email, d.password, d.name, req.cookies.fid, o.initialPoints, d.invite ?? null, o.inviteRequired && !o.adminEmails.includes(d.email));
    if (!out.ok) throw new HttpError(409, out.error);
    ops.track(out.user.ownerId, null, 'register', { invite: d.invite ?? null });
    res.setHeader('set-cookie', [cookie('sid', out.session.token, out.session.maxAge), cookie('fid', '', 0)]);
    return { user: { email: out.user.email, name: out.user.name }, message: out.kept ? '注册好了，之前做的选题、文案、素材都在' : '注册好了' };
  });
  r.post('/api/auth/login', async (req, res) => {
    const d = await body(req, credSchema);
    const out = await auth.login(d.email, d.password, req.cookies.fid);
    if (!out.ok) throw new HttpError(401, out.error);
    ops.track(out.user.ownerId, null, 'login');
    res.setHeader('set-cookie', [cookie('sid', out.session.token, out.session.maxAge), cookie('fid', '', 0)]);
    return { user: { email: out.user.email, name: out.user.name }, message: out.merged ? `登录了，未登录时做的 ${out.merged} 个身份的内容已并进账号` : '登录了' };
  });
  r.get('/api/auth/config', () => ({ authRequired: !!o.authRequired, inviteRequired: o.inviteRequired }));
  r.post('/api/auth/logout', (req, res) => { auth.logout(req.cookies.sid); res.setHeader('set-cookie', cookie('sid', '', 0)); return { ok: true }; });

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
    ops.track(ctx(req).owner, ws.id, 'topic_created', { source: d.source });
    return repo.insertTopic(ws.id, { ...d, cat: catIndex(ws.persona), k: d.k ?? personaOf(ws.persona).att[0], ageMonths: 0 });
  });
  r.post('/api/topics/:id/fav', async req => { const ws = W(req), { fav } = await body(req, z.object({ fav: z.boolean() })); topicOr404(ws, req.params.id); repo.setFav(ws.id, req.params.id, fav); return repo.topic(ws.id, req.params.id); });
  r.get('/api/topics/:id/angles', async req => { const ws = W(req); return { angles: await providers.topics.angles(aiCtx(ws), topicOr404(ws, req.params.id)) }; });
  r.post('/api/topics/from-case', async req => {
    const ws = W(req), d = await body(req, S.caseGenSchema), c = catIndex(ws.persona);
    const drafts = await providers.topics.fromCase(aiCtx(ws), d);
    ops.track(ctx(req).owner, ws.id, 'topics_generated', { from: 'case' });
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
    const gen = await providers.copy.generate(aiCtx(ws), t, { kind: d.kind, len: d.len, tone: d.tone ?? ws.positioning.tone, version: d.version, quality: d.quality });
    const draft: CopyDraft = { ...gen, id: '', updatedAt: '', assetIds: repo.draftByTopic(ws.id, t.id)?.assetIds ?? [] };
    ops.track(ctx(req).owner, ws.id, 'copy_generated', { kind: d.kind, len: d.len, version: d.version });
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
  r.put('/api/drafts', async req => { const ws = W(req), d = await body(req, S.copyDraftSchema); topicOr404(ws, d.topicId); ops.track(ctx(req).owner, ws.id, 'draft_saved'); return repo.upsertDraft(ws.id, d); });

  /* ---------- 工具 ---------- */
  r.post('/api/tools/banned', async req => { const { text } = await body(req, z.object({ text: z.string().max(5000) })); return { hits: findBanned(text) }; });
  r.post('/api/tools/humanize', async req => { const ws = W(req), { text } = await body(req, z.object({ text: z.string().max(5000) })); return { text: await providers.copy.humanize(aiCtx(ws), text) }; });
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

  /* ---------- 数字人形象 ---------- */
  // 上传本人视频（真人分身）或照片（照片形象），必须带本人授权（念过带随机数字的授权声明）。接上数字人服务前：审核几秒后变成可用（示意）
  r.post('/api/avatars', async req => {
    const ws = W(req), kind = req.raw.headers['x-kind'] === 'photo' ? 'photo' : 'clone';
    if (req.raw.headers['x-consent'] !== 'yes') throw new HttpError(400, '需要本人对着镜头念授权声明，并勾选同意');
    const mime = String(req.raw.headers['content-type'] ?? '');
    const demo = req.raw.headers['x-sample'] === 'demo';
    if (!demo && !(kind === 'photo' ? /^image\//.test(mime) : /^video\//.test(mime))) throw new HttpError(415, kind === 'photo' ? '照片形象要传一张照片' : '真人分身要传一段视频');
    if (!demo) {
      const buf = await readBuffer(req.raw, UPLOAD_LIMIT);
      const file = `${ws.id}/${newId('av')}${kind === 'photo' ? '.jpg' : '.mp4'}`;
      await storage.put(file, buf, mime);
      const a = repo.insertAsset(ws.id, { type: '人物', name: kind === 'photo' ? '照片形象' : '真人分身底片', k: 'person', file, mime, size: buf.length, source: '数字人形象' });
      ops.setSetting(`avatar_asset:${ws.id}:${kind}`, a.id);
    }
    repo.setAvatar(ws.id, kind, 'busy');
    setTimeout(() => repo.setAvatar(ws.id, kind, 'ready'), Number(process.env.MOCK_DELAY_MS ?? 3000)).unref();
    ops.track(ctx(req).owner, ws.id, 'avatar_created', { kind });
    return { avatars: repo.ws(ws.id)!.avatars };
  });
  r.delete('/api/avatars/:kind', req => {
    const ws = W(req), kind = req.params.kind === 'photo' ? 'photo' : 'clone';
    repo.setAvatar(ws.id, kind, 'none'); ops.setSetting(`avatar_asset:${ws.id}:${kind}`, null);
    return { avatars: repo.ws(ws.id)!.avatars };
  });

  /* ---------- 点数 ---------- */
  r.get('/api/ledger', req => ({ items: repo.ledger(W(req).id) }));
  r.post('/api/points/redeem', async req => {
    const ws = W(req), { code } = await body(req, z.object({ code: z.string().trim().min(4).max(40) }));
    const out = repo.redeem(ws.id, code.toUpperCase());
    if (!out.ok) throw new HttpError(400, out.error);
    ops.track(ctx(req).owner, ws.id, 'redeemed', { points: out.points });
    return { points: out.points, balance: repo.ws(ws.id)!.balance };
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
    await storage.put(file, buf, mime);
    const keys = ['entry', 'live', 'kit', 'bed', 'stone', 'site', 'soft', 'store', 'hotel', 'new'];
    ops.track(ctx(req).owner, ws.id, 'asset_uploaded', { mime, size: buf.length });
    return repo.insertAsset(ws.id, { type: ASSET_TYPE(mime), name, k: keys[repo.assets(ws.id).length % keys.length], file, mime, size: buf.length, source: String(req.raw.headers['x-source'] ?? '上传').slice(0, 20) });
  });
  r.delete('/api/assets/:id', async req => {
    const ws = W(req), a = repo.assetsByIds(ws.id, [req.params.id])[0];
    if (!a || !repo.deleteAsset(ws.id, a.id)) throw new HttpError(404, '素材不存在');
    if (a.url) await storage.delete(a.url.slice(7)).catch(e => console.warn('删除素材文件失败：', e.message));
    return { ok: true };
  });

  /* ---------- 生成 ---------- */
  r.post('/api/gen/check', async req => {
    const ws = W(req), g = await body(req, S.genSettingsSchema);
    const assets = repo.assetsByIds(ws.id, g.assetIds);
    return { issues: genIssues(g, ws.voiceClone, { firstFrame: firstFrameOk(), avatars: ws.avatars }), shots: shotsOf(g, assets, personaOf(ws.persona).att), cost: genCost(g), finalCost: genCost(g, true) };
  });
  /** 试听 / 定时长：按句配音，返回每句时长。接上配音服务前按字数估（前端用浏览器朗读试听） */
  r.post('/api/gen/voice', async req => {
    const d = await body(req, z.object({ lines: z.array(z.string().max(400)).max(60), speed: z.number().min(0.5).max(2).default(1), voice: z.string().max(10).default('p1') }));
    return { provider: 'estimate', secs: d.lines.map(l => voiceSecs(l, d.speed)) };
  });
  r.post('/api/gen', async (req, res) => {
    const ws = W(req), d = await body(req, z.object({ settings: S.genSettingsSchema, final: z.boolean().default(false), title: z.string().max(80).default('') }));
    const owner = ctx(req).owner;
    if (ops.genPaused()) throw new HttpError(503, '生成功能暂时关闭了，管理员打开后就能用');
    if (o.dailyJobsPerUser && ops.jobsToday(owner) >= o.dailyJobsPerUser) throw new HttpError(429, `今天的生成次数用完了（每天 ${o.dailyJobsPerUser} 次），明天再来`);
    if (o.dailyBudget && ops.spentToday() >= o.dailyBudget) throw new HttpError(503, '今天的试用额度已经用完，明天再来');
    const blocking = genIssues(d.settings, ws.voiceClone, { firstFrame: firstFrameOk(), avatars: ws.avatars }).filter(i => i.blocking);
    if (blocking.length) throw new HttpError(422, blocking.map(i => i.text).join('；'));
    const title = d.title || d.settings.title || d.settings.copy.split('\n')[0]?.slice(0, 20) || '未命名';
    const out = runner.startVideo(ws, d.settings, d.final, title);
    if (!out.ok) throw new HttpError(402, out.error);
    ops.track(owner, ws.id, d.final ? 'final_started' : 'gen_started', { model: d.settings.model, len: d.settings.len, cost: out.job.cost });
    res.statusCode = 201; return out.job;
  });
  r.get('/api/jobs', req => ({ jobs: repo.jobs(W(req).id) }));
  r.get('/api/jobs/:id', req => { const j = repo.job(W(req).id, req.params.id); if (!j) throw new HttpError(404, '任务不存在'); return j; });

  /* ---------- 排期 ---------- */
  r.get('/api/plans', async req => {
    const ws = W(req);
    const did = await opsTick(repo, providers, runner, ws).catch(e => { console.warn('AI 运营：', e.message); return [] as string[]; });
    return { plans: planPayload(ws), did };
  });
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
    if (d.action === 'approve') { const s = slot(); if (!s) throw new HttpError(404, '这天没有选题'); repo.upsertSlot({ ...s, pin: 'fixed', why: s.why.replace(/^AI /, '') }); ops.track(ctx(req).owner, ws.id, 'slot_approved'); message = '已固定'; }
    if (d.action === 'unpin') { const s = slot(); if (s) repo.upsertSlot({ ...s, pin: 'cand' }); message = '已取消固定'; }
    if (d.action === 'next') { const t = replaceWithNext(repo, ws, p, date); message = t ? `换了一个：${t.title}` : '选题库里没有更多选题了'; }
    if (d.action === 'skip') { p.skipped = [...new Set([...p.skipped, date])]; repo.savePlan(ws.id, p); message = '跳过了这一天'; }
    if (d.action === 'add') { p.added = [...new Set([...p.added, date])]; p.skipped = p.skipped.filter(x => x !== date); repo.savePlan(ws.id, p); ensureSchedule(repo, ws, p); message = '加了一条，AI 预选了选题，等你审核'; }
    if (d.action === 'publish') { repo.setSlotMeta(p.id, date, { publishedAt: new Date().toISOString() }); ops.track(ctx(req).owner, ws.id, 'slot_published'); message = '记下了：已发布。24 小时后来填一下数据'; }
    if (d.action === 'unpublish') { repo.setSlotMeta(p.id, date, { publishedAt: null }); message = '已改回未发布'; }
    if (d.action === 'metrics') { if (!d.metrics) throw new HttpError(400, '缺少数据'); repo.setSlotMeta(p.id, date, { metrics: d.metrics }); message = '数据已记下，下周的打法会参考它'; }
    if (d.action === 'set') {
      if (!d.topicId) throw new HttpError(400, '缺少选题');
      if (date < today) throw new HttpError(400, '不能排到过去的日期');
      const t = topicOr404(ws, d.topicId);
      const from = setDay(repo, ws, p, date, t);
      ops.track(ctx(req).owner, ws.id, 'slot_set', { moved: !!from });
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

  /* ---------- 埋点与反馈 ---------- */
  r.post('/api/events', async req => {
    const d = await body(req, z.object({ name: z.enum(CLIENT_EVENTS), props: z.record(z.union([z.string().max(200), z.number(), z.boolean()])).optional() }));
    ops.track(ctx(req).owner, ctx(req).ws.id, d.name, d.props); return { ok: true };
  });
  r.post('/api/feedback', async req => {
    const d = await body(req, z.object({ text: z.string().trim().min(2, '多写几个字').max(2000), page: z.string().max(80), contact: z.string().trim().max(80).default('') }));
    ops.feedback(ctx(req).owner, d.page, d.text, d.contact); ops.track(ctx(req).owner, ctx(req).ws.id, 'feedback'); return { ok: true };
  });

  /* ---------- 管理后台（ADMIN_EMAILS 里的账号） ---------- */
  const admin = (req: Req) => { if (!isAdmin(ctx(req).user)) throw new HttpError(403, '只有管理员能看'); };
  r.get('/api/admin/overview', req => { admin(req); const days = Math.min(90, Math.max(1, Number(req.query.get('days') ?? 7))); return { ...ops.overview(days), settings: { genPaused: ops.genPaused() }, config: { inviteRequired: o.inviteRequired, authRequired: !!o.authRequired, initialPoints: o.initialPoints, dailyJobsPerUser: o.dailyJobsPerUser, dailyBudget: o.dailyBudget }, ai: providerInfo }; });
  r.get('/api/admin/users', req => { admin(req); return { users: ops.users() }; });
  r.post('/api/admin/users/:id/points', async req => { admin(req); const { delta } = await body(req, z.object({ delta: z.number().int().min(-100000).max(100000) })); if (!ops.addPoints(req.params.id, delta)) throw new HttpError(404, '没有这个用户'); return { users: ops.users() }; });
  r.get('/api/admin/invites', req => { admin(req); return { invites: ops.listInvites() }; });
  r.post('/api/admin/invites', async req => { admin(req); const d = await body(req, z.object({ count: z.number().int().min(1).max(100), maxUses: z.number().int().min(1).max(1000).default(1), note: z.string().max(40).default('') })); const codes = ops.createInvites(d.count, d.maxUses, d.note); return { codes, invites: ops.listInvites() }; });
  r.get('/api/admin/redeem', req => { admin(req); return { codes: repo.redeemCodes() }; });
  r.post('/api/admin/redeem', async req => {
    admin(req);
    const d = await body(req, z.object({ count: z.number().int().min(1).max(100), points: z.number().int().min(1).max(100000), maxUses: z.number().int().min(1).max(1000).default(1), note: z.string().max(40).default('') }));
    const codes = Array.from({ length: d.count }, () => randomBytes(4).toString('hex').toUpperCase());
    codes.forEach(c => repo.createRedeem(c, d.points, d.maxUses, d.note));
    return { codes, list: repo.redeemCodes() };
  });
  r.get('/api/admin/feedback', req => { admin(req); return { feedback: ops.listFeedback() }; });
  r.post('/api/admin/feedback/:id', async req => { admin(req); const { status } = await body(req, z.object({ status: z.enum(['new', 'read', 'done']) })); ops.setFeedback(req.params.id, status); return { feedback: ops.listFeedback() }; });
  r.put('/api/admin/settings', async req => { admin(req); const d = await body(req, z.object({ genPaused: z.boolean() })); ops.setGenPaused(d.genPaused); return { settings: { genPaused: ops.genPaused() } }; });

  /* ---------- 后台：AI 服务（查看接入、拉取模型、切换模型、连通测试） ---------- */
  const listModels = async (ep: { baseUrl: string; apiKey: string } | null) => {
    if (!ep) return { ok: false, error: '没有配置', models: [] as string[] };
    try {
      const r = await fetch(`${ep.baseUrl.replace(/\/$/, '')}/models`, { headers: { authorization: `Bearer ${ep.apiKey}` }, signal: AbortSignal.timeout(20000) });
      const j = await r.json().catch(() => ({})) as { data?: { id: string }[]; error?: { message?: string } };
      if (!r.ok) return { ok: false, error: `${r.status}${j.error?.message ? `：${j.error.message}` : ''}`, models: [] };
      return { ok: true, error: null, models: (j.data ?? []).map(m => m.id).sort() };
    } catch (e) { return { ok: false, error: (e as Error).name === 'TimeoutError' ? '超时' : '连不上', models: [] }; }
  };
  r.get('/api/admin/ai', req => { admin(req); return { status: ai.status(), tiers: [...videoModels().filter(m => !m.off).map(m => ({ id: m.id, n: m.n, d: m.d })), { id: 'draft', n: '样片（低价预览）', d: '开了样片模式时所有档位都先用它出低清预览' }] }; });
  r.post('/api/admin/ai/models', async req => { admin(req); const [llm, video] = await Promise.all([listModels(ai.endpoints.llm), listModels(ai.endpoints.video)]); return { llm, video }; });
  r.put('/api/admin/ai', async req => {
    admin(req);
    const d = await body(req, z.object({ llmModel: z.string().trim().max(120).nullable().optional(), llmModelFine: z.string().trim().max(120).nullable().optional(), llmFallbacks: z.array(z.string().trim().min(1).max(120)).max(5).optional(), videoModels: z.record(z.string().trim().max(120)).optional() }));
    if (d.llmModel !== undefined) ops.setSetting('llm_model', d.llmModel || null);
    if (d.llmModelFine !== undefined) ops.setSetting('llm_model_fine', d.llmModelFine || null);
    if (d.llmFallbacks) ops.setSetting('llm_fallbacks', d.llmFallbacks.join(','));
    if (d.videoModels) ops.setSetting('video_models', JSON.stringify(Object.fromEntries(Object.entries(d.videoModels).filter(([, v]) => v))));
    return { status: ai.status() };
  });
  r.post('/api/admin/ai/test', async req => {
    admin(req);
    const ep = ai.endpoints.llm, model = ai.llmModel();
    if (!ep) throw new HttpError(400, '文案模型还没配置密钥');
    if (!model) throw new HttpError(400, '还没选文案模型');
    const t0 = Date.now();
    try {
      const r2 = await fetch(`${ep.baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${ep.apiKey}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(60000),
        body: JSON.stringify({ model, messages: [{ role: 'user', content: '用一句话（不超过 20 字）介绍你自己。' }], max_tokens: 60 }) });
      const j = await r2.json().catch(() => ({})) as any;
      if (!r2.ok) return { ok: false, ms: Date.now() - t0, model, reply: null, error: `${r2.status}${j?.error?.message ? `：${j.error.message}` : ''}` };
      return { ok: true, ms: Date.now() - t0, model, reply: String(j?.choices?.[0]?.message?.content ?? '').slice(0, 200), error: null };
    } catch (e) { return { ok: false, ms: Date.now() - t0, model, reply: null, error: (e as Error).name === 'TimeoutError' ? '超时' : '连不上' }; }
  });

  /* ---------- 静态文件 ---------- */
  const webRoot = resolve(o.webDir);
  function serveFile(res: ServerResponse, base: string, rel: string, fallback?: string) {
    const p = normalize(join(base, rel));
    if (p !== base && !p.startsWith(base + sep)) { res.writeHead(403).end(); return; }
    let f = p;
    if (!existsSync(f) || statSync(f).isDirectory()) { if (!fallback) { res.writeHead(404).end(); return; } f = join(base, fallback); }
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream', 'cache-control': f.endsWith('index.html') ? 'no-cache' : 'public, max-age=300' });
    createReadStream(f).pipe(res);
  }

  /** 简单限流：每个 IP 每分钟最多 120 次写请求（单进程内存） */
  const hits = new Map<string, number[]>();
  const limited = (ip: string) => { const t = Date.now(), L = (hits.get(ip) ?? []).filter(x => t - x < 60e3); L.push(t); hits.set(ip, L); if (hits.size > 5000) hits.clear(); return L.length > (o.rateLimit ?? 120); };

  const CORS_HEADERS = 'content-type, x-file-name, x-source, x-consent, x-sample, x-request-id';
  const clientIp = (raw: IncomingMessage) => (o.trustProxy && String(raw.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) || raw.socket.remoteAddress || '';

  async function handle(raw: IncomingMessage, res: ServerResponse) {
    const url = new URL(raw.url ?? '/', 'http://x');
    const req: Req = { raw, method: raw.method ?? 'GET', path: url.pathname, query: url.searchParams, params: {}, cookies: parseCookies(raw.headers.cookie) };
    // 请求 ID：排查问题时用户报错信息里能带上，日志里能对上
    const rid = String(raw.headers['x-request-id'] ?? '').slice(0, 64) || randomBytes(6).toString('hex');
    res.setHeader('x-request-id', rid);
    const t0 = Date.now();
    if (o.logRequests && req.path.startsWith('/api/')) res.on('finish', () => console.log(JSON.stringify({ t: new Date().toISOString(), rid, ip: clientIp(raw), m: req.method, p: req.path, s: res.statusCode, ms: Date.now() - t0 })));
    // 跨域（前后端分开部署）：只放行 CORS_ORIGINS 里的前端域名，允许带 Cookie
    const origin = String(raw.headers.origin ?? '');
    if (origin && o.corsOrigins.includes(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('access-control-allow-credentials', 'true');
      res.setHeader('access-control-expose-headers', 'x-request-id');
      res.setHeader('vary', 'Origin');
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE', 'access-control-allow-headers': CORS_HEADERS, 'access-control-max-age': '600' }).end(); return; }
    }
    try {
      if (req.path === '/healthz') { db.prepare('SELECT 1').get(); return send(res, 200, { ok: true, ai: providerInfo, storage: storage.kind }); }
      if (req.path.startsWith('/api/') && req.method !== 'GET' && limited(clientIp(raw))) throw new HttpError(429, '操作太频繁了，歇一下再试');
      if (req.path.startsWith('/api/')) {
        const m = r.match(req.method, req.path);
        if (!m) throw new HttpError(404, '接口不存在');
        req.params = m.params;
        if (!req.path.startsWith('/api/auth/')) { const c = ctx(req); if (c.setCookie) res.setHeader('set-cookie', c.setCookie); }
        const out = await m.h(req, res);
        send(res, res.statusCode && res.statusCode !== 200 ? res.statusCode : 200, out);
        return;
      }
      if (req.path.startsWith('/files/')) {
        // 带有效签名的链接（给视频服务用）直接放行；否则只能访问自己账号（owner）名下工作区的文件
        const rel = decodeURIComponent(req.path.slice(7));
        if (!validSig(rel, req.query.get('exp'), req.query.get('sig'))) {
          const c = ctx(req), fileWs = repo.ws(rel.split('/')[0]);
          if (!fileWs || fileWs.ownerId !== c.owner) throw new HttpError(404, '文件不存在');
        }
        if (storage.directUrl) { res.writeHead(302, { location: storage.directUrl(rel, 600), 'cache-control': 'no-store' }).end(); return; }
        return serveFile(res, resolve(filesDir), rel);
      }
      serveFile(res, webRoot, req.path === '/' ? 'index.html' : req.path.slice(1), 'index.html');
    } catch (e) { sendError(res, e, rid); }
  }

  return { server: createServer((q, s) => { void handle(q, s); }), db, repo, ops, signedUrl, providerInfo };
}
