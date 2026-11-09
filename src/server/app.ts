// 应用：组装数据库、供应方、路由，处理静态文件。createApp 便于测试时用内存库启动。
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import { JobRunner, opsTick, withProgress, writeCopy, runDiagnosis, saveAnswer, footageCopy, describeAsset, catIndex, personaOf, published, replaceWithNext, scheduleIndex, scheduleView, seedWorkspace, setDay, todayIso, ensureSchedule, syncPlans, applyReport, seedColumnTopics, addSampleAssets, probeAsset, lookAtAsset, nextColumn } from './services.ts';
import { PERSONAS, MODELS, CADENCE, TUDOU_CAPS, withCaps } from '../shared/catalog.ts';
import { checkCopy, findBanned, smartTitle } from '../shared/copy.ts';
import { genCost, genIssues, setVideoModels, shotsOf, videoModels } from '../shared/gen.ts';
import { voiceSecs } from '../shared/video.ts';
import { DIAG_PRICE, DIAG_QUESTIONS } from '../shared/kb.ts';
import { isPublishDay } from '../shared/schedule.ts';
import * as S from '../shared/schemas.ts';
import { MODULES, PRESETS, closedParents, moduleForApi, normalizeConfig, presetStates, viewFor, type ModuleConfig, type Preset } from '../shared/modules.ts';
import { makeRetention } from './retention.ts';
import { costOf, defaultStudio, emptyDiag, sampleCost, toGen, type StudioState } from '../shared/studio.ts';
import { loadPay } from './pay/index.ts';
import type { AiKey } from './providers/index.ts';
import { makeSkills } from './skills/registry.ts';
import { makeUpstreams } from './upstreams.ts';
import { makeGrowth, type PointsCfg } from './growth.ts';
import { makeStudioAi } from './studio-ai.ts';
import { registerAdmin } from './admin-routes.ts';
import { ROLES, type AdminMe, type AdminRole } from '../shared/admin.ts';
import { systemVars } from './providers/llm.ts';
import { applyCatalog, type Catalog } from '../shared/studio.ts';
import { CHANNEL_NAME, normalizeBilling, totalPoints, type BillingConfig, type PayChannel } from '../shared/billing.ts';
import type { CopyDraft, GenSettings, Workspace } from '../shared/types.ts';

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
  /* ---------- 技能中心、上游接口、积分和邀请（11/9） ---------- */
  const skills = makeSkills(db);
  skills.prune();
  const ENV = o.env ?? process.env;
  // 后台填的上游密钥用它加密：SECRETS_KEY > FILE_SIGN_SECRET > 本机自动生成一个存在数据库里（只适合开发）
  const secretKey = ENV.SECRETS_KEY || o.fileSignSecret || ops.getSetting('secrets_key') || (() => { const k = randomBytes(32).toString('hex'); ops.setSetting('secrets_key', k); return k; })();
  const ups = makeUpstreams(db, skills, { env: ENV, secretKey });
  const growth = makeGrowth(db, skills);
  const aiRt = { get: (k: AiKey) => ops.getSetting(k) };
  const aiHooks = {
    prompt: (k: string) => skills.enabled('copywriter') ? skills.prompt('copywriter', k) : '',
    onLlmCall: (x: { model: string; ok: boolean; ms: number; error?: string }) => skills.logCall('up-llm', 'upstream', x.ok, x.ms, x.error ? `${x.model}：${x.error}` : null),
  };
  let ai = loadProviders(ups.env(), aiRt, aiHooks);
  const { providers, info: providerInfo } = ai;
  const studioAi = makeStudioAi(skills, () => ai.llm);
  /** 前台用的目录：成片类型和价格、样片、积分口径、系统数字人（后台改了马上换） */
  const catalog = () => {
    const vt = skills.config<{ types: Catalog['types']; samples: Catalog['samples']; sampleCats: string[] }>('video-types');
    const p = skills.config<PointsCfg>('points'), av = skills.config<{ avatars: Catalog['avatars']; voices: string[] }>('avatars');
    const dg = skills.config<{ stages: string[]; welcome: string; minAnswers: number; demoName: string; demoAnswers: string[] }>('diag-agent');
    const pk = skills.config<{ tagMin: number; tagMax: number; titleMax: number; banned: string[] }>('publish-pack');
    return {
      types: vt.types, samples: vt.samples, sampleCats: vt.sampleCats, avatars: av.avatars, voices: av.voices,
      pricing: { pointName: p.pointName, secondsPerPoint: p.secondsPerPoint, sampleRate: p.sampleRate, sampleMin: p.sampleMin, minCost: p.minCost, lowBalance: p.lowBalance },
      diag: { stages: dg.stages, welcome: dg.welcome, minAnswers: dg.minAnswers, demoName: dg.demoName, demoAnswers: dg.demoAnswers, sample: skills.config<{ sample: unknown }>('diag-report').sample },
      pack: { tagMin: pk.tagMin, tagMax: pk.tagMax, titleMax: pk.titleMax, banned: pk.banned },
    };
  };
  applyCatalog(catalog());
  skills.onChange(id => { if (['video-types', 'points', 'avatars'].includes(id)) applyCatalog(catalog()); });
  // 视频档位按实际接入的服务显示能力（土豆：Seedance 系列最高 720p 等）；没接真实服务时用通用目录
  setVideoModels(providerInfo.video === 'newapi' ? withCaps(MODELS, TUDOU_CAPS) : MODELS);
  console.log(`AI 供应方：文案 ${providerInfo.copy}，视频 ${providerInfo.video}，配音 ${providerInfo.tts}，看素材 ${providerInfo.vision}`);
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
  /* ---------- 模块开关、解锁价格、保存期限和容量（后台设置） ---------- */
  let modCache: { raw: string | undefined; cfg: ModuleConfig } | null = null;
  const modCfg = (): ModuleConfig => {
    const raw = ops.getSetting('modules');
    if (modCache && modCache.raw === raw) return modCache.cfg;
    let parsed: unknown = null; try { parsed = raw ? JSON.parse(raw) : null; } catch { /* 坏了就按默认 */ }
    const cfg = normalizeConfig(parsed, o.modulesPreset, DIAG_PRICE);
    modCache = { raw, cfg }; return cfg;
  };
  const saveModCfg = (c: ModuleConfig) => ops.setSetting('modules', JSON.stringify(c));
  const policy = () => { const c = modCfg(); return { retentionDays: c.retentionDays, capacityMb: c.capacityMb }; };
  const retention = makeRetention(db, storage);
  /** 面诊是不是专家版：不是的话不用解锁就能用 */
  const diagOf = (wsId: string) => { const d = repo.diagnosis(wsId); return modCfg().pro.includes('diag') ? d : { ...d, unlocked: true }; };
  // 到期文件每小时清一次
  const purgeTimer = setInterval(() => { retention.purge(policy()).catch(e => console.warn('清理过期文件失败：', e.message)); }, 3600e3); purgeTimer.unref(); void retention.purge(policy()).catch(() => undefined);
  console.log(`文件存储：${storage.kind === 's3' ? `对象存储 ${(o.env ?? process.env).S3_BUCKET}` : filesDir}`);
  const runner = new JobRunner(repo, providers, { compose: o.compose, font: o.subtitleFont, storage, musicDir: (o.env ?? process.env).MUSIC_DIR || join(o.dataDir, 'music'), onDone: (ws, job, ok) => { if (ok) { const own = repo.ws(ws)?.ownerId; if (own) growth.onFirstGen(own); } ops.track(repo.ws(ws)?.ownerId ?? '', ws, ok ? 'gen_done' : 'gen_failed', { job: job.id, cost: job.cost }); skills.logCall('upstream:video', job.kind, ok, 0, ok ? null : (job as { error?: string | null }).error ?? null); } }, async a => {
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
  // 演示版：建好后台账号（邮箱必须在 ADMIN_EMAILS 里），后台登录页把账号密码提示出来
  const demoLogin = (() => { const i = o.demoLogin.indexOf(':'); return i > 0 ? { email: o.demoLogin.slice(0, i).trim().toLowerCase(), password: o.demoLogin.slice(i + 1) } : null; })();
  if (demoLogin && !db.prepare('SELECT 1 FROM users WHERE email=?').get(demoLogin.email))
    void auth.register(demoLogin.email, demoLogin.password, '演示管理员', undefined, o.initialPoints).catch(e => console.warn('建演示后台账号失败：', (e as Error).message));
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
      if (!owner || !repo.ownerExists(owner)) { owner = repo.createOwner(growth.initialPoints(o.initialPoints)); setCookie = cookie('fid', owner, 31536000); }
    }
    let ws = (() => { const id = repo.currentWsId(owner); const w = id ? repo.ws(id) : null; return w && w.ownerId === owner ? w : null; })();
    if (!ws) { ws = repo.wsByPersona(owner, 'designer') ?? seedWorkspace(db, repo, owner, 'designer'); repo.setCurrentWs(owner, ws.id); }
    const c = { owner, ws, user, setCookie }; ctxMap.set(req, c); return c;
  }
  const W = (req: Req) => repo.ws(ctx(req).ws.id)!;
  const aiCtx = (ws: Workspace) => ({ persona: personaOf(ws.persona), positioning: ws.positioning });
  const topicOr404 = (ws: Workspace, id: string) => { const t = repo.topic(ws.id, id); if (!t) throw new HttpError(404, '选题不存在'); return t; };
  const planOr404 = (ws: Workspace, id: string) => { const p = repo.plan(ws.id, id); if (!p) throw new HttpError(404, '账号排期不存在'); return p; };
  /** 后台账号：ADMIN_EMAILS 里的是超级管理员；后台「管理权限」加的按角色给权限 */
  const adminOf = (u: User | null): AdminMe | null => {
    const role: AdminRole | null = !u ? null : o.adminEmails.includes(u.email) ? 'super'
      : ((db.prepare('SELECT role FROM admins WHERE email=?').get(u.email) as { role?: AdminRole } | undefined)?.role ?? null);
    if (!role || !ROLES[role]) return null;
    return { email: u!.email, role, roleName: ROLES[role].n, perms: [...ROLES[role].perms] };
  };
  const isAdmin = (u: User | null) => !!adminOf(u);
  const session = (ws: Workspace, req: Req) => ({ user: ctx(req).user && { email: ctx(req).user!.email, name: ctx(req).user!.name }, isAdmin: isAdmin(ctx(req).user), admin: adminOf(ctx(req).user), catalog: catalog(), authRequired: !!o.authRequired, inviteRequired: o.inviteRequired,
    limits: { dailyJobs: o.dailyJobsPerUser, jobsToday: ops.jobsToday(ctx(req).owner), genPaused: ops.genPaused() }, ai: { ...providerInfo, firstFrame: firstFrameOk() }, workspace: (({ ownerId: _o, ...w }: Workspace & { ownerId?: string }) => w)(ws), persona: personaOf(ws.persona), personas: PERSONAS.map(p => ({ id: p.id, n: p.n })), models: videoModels(), today: todayIso(),
    modules: viewFor(modCfg(), ctx(req).user?.email ?? null), modulePro: modCfg().pro, storage: { ...policy(), usedBytes: retention.usedBytes(ctx(req).owner) } });
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
  r.put('/api/workspace/positioning', async req => { const p = await body(req, S.positioningSchema); repo.setPositioning(W(req).id, p); syncPlans(repo, W(req), p); return session(W(req), req); });
  r.put('/api/workspace/theme', async req => { const { theme } = await body(req, z.object({ theme: z.enum(['dazhe', 'studio', 'cinema', 'glass', 'poster']) })); repo.setTheme(W(req).id, theme); return { ok: true }; });

  /* ---------- 账号 ---------- */
  const credSchema = z.object({ email: z.string().trim().toLowerCase().email('邮箱格式不对').max(120), password: z.string().min(8, '密码至少 8 位').max(128) });
  r.post('/api/auth/register', async (req, res) => {
    const d = await body(req, credSchema.extend({ name: z.string().trim().min(1, '填一下名字').max(40), invite: z.string().max(40).optional(), ref: z.string().max(20).optional() }));
    // 邀请制下，好友的分享链接也能当邀请码用
    const viaRef = o.inviteRequired && !d.invite && !!d.ref && !!growth.preview(d.ref);
    const out = await auth.register(d.email, d.password, d.name, req.cookies.fid, growth.initialPoints(o.initialPoints), d.invite ?? null, o.inviteRequired && !viaRef && !o.adminEmails.includes(d.email));
    if (!out.ok) throw new HttpError(409, out.error);
    const g = growth.onRegister({ userId: out.user.id, ownerId: out.user.ownerId, ip: clientIp(req.raw) || null, code: d.ref ?? null });
    ops.track(out.user.ownerId, null, 'register', { invite: d.invite ?? null, ref: d.ref ?? null, referral: g.referral });
    res.setHeader('set-cookie', [cookie('sid', out.session.token, out.session.maxAge), cookie('fid', '', 0)]);
    const gift = g.signup + (g.referral === 'rewarded' || g.referral === 'capped' ? skills.config<{ invite: { inviteePoints: number } }>('referral').invite.inviteePoints : 0);
    return { user: { email: out.user.email, name: out.user.name }, gift, message: `${out.kept ? '注册好了，之前做的选题、文案、素材都在' : '注册好了'}${gift ? `，送你 ${gift} 点` : ''}` };
  });
  r.post('/api/auth/login', async (req, res) => {
    const d = await body(req, credSchema);
    const out = await auth.login(d.email, d.password, req.cookies.fid);
    if (!out.ok) throw new HttpError(401, out.error);
    ops.track(out.user.ownerId, null, 'login');
    res.setHeader('set-cookie', [cookie('sid', out.session.token, out.session.maxAge), cookie('fid', '', 0)]);
    return { user: { email: out.user.email, name: out.user.name }, message: out.merged ? `登录了，未登录时做的 ${out.merged} 个身份的内容已并进账号` : '登录了' };
  });
  r.get('/api/auth/config', () => ({ authRequired: !!o.authRequired, inviteRequired: o.inviteRequired, ...(demoLogin ? { demoLogin: { email: demoLogin.email, password: demoLogin.password } } : {}) }));
  /** 后台登录（/admin 的登录页）：只有后台账号能登进去；不是后台账号不给会话，前台的登录状态也不动 */
  r.post('/api/auth/admin-login', async (req, res) => {
    const d = await body(req, credSchema);
    const out = await auth.login(d.email, d.password, undefined);
    if (!out.ok) throw new HttpError(401, out.error);
    const me = adminOf(out.user as User);
    if (!me) { auth.logout(out.session.token); throw new HttpError(403, '这个账号没有后台权限。后台账号由超级管理员在后台「后台账号」里开'); }
    ops.track(out.user.ownerId, null, 'login', { admin: me.role });
    res.setHeader('set-cookie', cookie('sid', out.session.token, out.session.maxAge));
    return { me };
  });
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

  /* ---------- 知识库 ---------- */
  const kbSchema = z.object({ section: z.enum(['personal', 'pro', 'brand']), kind: z.enum(['story', 'opinion', 'detail', 'quote', 'resume', 'habit', 'avoid']), text: z.string().trim().min(1).max(1000), tags: z.array(z.string().max(12)).max(8).default([]) });
  r.get('/api/kb', req => ({ items: repo.kb(W(req).id) }));
  r.post('/api/kb', async req => { const ws = W(req), d = await body(req, kbSchema); repo.addKb(ws.id, d); ops.track(ctx(req).owner, ws.id, 'kb_added', { kind: d.kind }); return { items: repo.kb(ws.id) }; });
  r.put('/api/kb/:id', async req => { const ws = W(req), d = await body(req, kbSchema.partial()); if (!repo.updateKb(ws.id, req.params.id, d)) throw new HttpError(404, '这条不存在'); return { items: repo.kb(ws.id) }; });
  r.delete('/api/kb/:id', req => { const ws = W(req); repo.deleteKb(ws.id, req.params.id); return { items: repo.kb(ws.id) }; });

  /* ---------- 知识库资料导入 / 面诊传资料（10/27 纪要第 2、5 条）：一条可以是一段文字、一份文件或一个链接 ---------- */
  const linkSchema = z.object({ url: z.string().trim().max(500).refine(u => /^https?:\/\/[^\s]+$/i.test(u), '链接要以 http:// 或 https:// 开头'), note: z.string().trim().max(300).default(''), section: z.enum(['personal', 'pro', 'brand']).default('personal') });
  const IMPORT_LIMIT = 20 * 1024 * 1024;
  const DOC_MIME = /^(image\/|text\/plain|text\/markdown|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.)/;
  const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return '链接'; } };
  const platformOf = (u: string) => /douyin|iesdouyin/.test(u) ? '抖音' : /xiaohongshu|xhslink/.test(u) ? '小红书' : /channels\.weixin|weixin\.qq/.test(u) ? '视频号' : /bilibili|b23\.tv/.test(u) ? 'B 站' : hostOf(u);
  /** 收一份上传的文件：文字文件按段拆成几条，其余存成一条「文件」 */
  async function importFile(req: Req, ws: Workspace, section: string, source: string) {
    const mime = String(req.raw.headers['content-type'] ?? '').split(';')[0].trim();
    if (!DOC_MIME.test(mime)) throw new HttpError(415, '支持文字、PDF、Word 和图片');
    const name = (() => { try { return decodeURIComponent(String(req.raw.headers['x-file-name'] ?? '资料')); } catch { return '资料'; } })().slice(0, 80);
    const buf = await readBuffer(req.raw, IMPORT_LIMIT);
    if (mime.startsWith('text/')) {
      const parts = buf.toString('utf8').split(/\n\s*\n|\r\n\s*\r\n/).map(x => x.replace(/\s+/g, ' ').trim()).filter(x => x.length >= 6).slice(0, 30);
      if (!parts.length) throw new HttpError(400, '文件里没有能用的文字');
      for (const t of parts) repo.addKb(ws.id, { section, kind: 'detail', text: t.slice(0, 1000), source, media: 'text' });
      return { added: parts.length, ids: [] as string[] };
    }
    if (retention.wouldExceed(ctx(req).owner, buf.length, policy())) throw new HttpError(413, `空间满了：每个账号最多存 ${policy().capacityMb} MB`);
    const ext = (extname(name) || '.' + (mime.split('/')[1] ?? 'bin')).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
    const file = `${ws.id}/${newId('f')}${ext}`;
    await storage.put(file, buf, mime);
    const isImg = mime.startsWith('image/');
    const id = repo.addKb(ws.id, { section, kind: 'detail', text: `${isImg ? '图片' : '文件'}：${name}`, source, media: 'file', url: `/files/${file}` });
    // 接了看图模型：截图、图片看一遍，把看到的写进这条
    if (isImg && providers.vision) void providers.vision.describe([{ jpg: buf, at: 0 }], { name, type: '照片', dur: null })
      .then(v => { if (v.note) repo.updateKb(ws.id, id, { text: `图片「${name}」：${v.note}`.slice(0, 1000) }); }).catch(e => console.warn('看图片失败：', e.message));
    return { added: 1, ids: [id] };
  }
  r.post('/api/kb/import', async req => {
    const ws = W(req), ct = String(req.raw.headers['content-type'] ?? '');
    const section = (['personal', 'pro', 'brand'] as const).find(x => x === req.raw.headers['x-section']) ?? 'pro';
    let added = 0;
    if (ct.startsWith('application/json')) {
      const d = await body(req, linkSchema);
      repo.addKb(ws.id, { section: d.section, kind: 'detail', text: d.note || `${platformOf(d.url)}链接`, source: '导入:链接', media: 'link', url: d.url }); added = 1;
    } else added = (await importFile(req, ws, section, '导入:文件')).added;
    ops.track(ctx(req).owner, ws.id, 'kb_imported', { added });
    return { added, items: repo.kb(ws.id) };
  });
  // 面诊时传资料：主页链接、账号截图、介绍资料；都进知识库（个人），报告拆账号现状时会用
  r.post('/api/diagnosis/attach', async req => {
    const ws = W(req);
    if (!diagOf(ws.id).unlocked) throw new HttpError(402, '先解锁 AI 运营');
    const ct = String(req.raw.headers['content-type'] ?? '');
    if (ct.startsWith('application/json')) {
      const d = await body(req, linkSchema);
      repo.addKb(ws.id, { section: 'personal', kind: 'detail', text: d.note || `我的${platformOf(d.url)}主页`, source: '面诊:资料', media: 'link', url: d.url });
    } else await importFile(req, ws, 'personal', '面诊:资料');
    ops.track(ctx(req).owner, ws.id, 'diag_attached');
    return { items: repo.kb(ws.id).filter(i => i.source === '面诊:资料') };
  });
  r.get('/api/diagnosis/attach', req => ({ items: repo.kb(W(req).id).filter(i => i.source === '面诊:资料') }));

  /* ---------- AI 面诊（AI 运营的入口，付费解锁） ---------- */
  r.get('/api/diagnosis', req => ({ diagnosis: diagOf(W(req).id), questions: DIAG_QUESTIONS, price: modCfg().price }));
  r.post('/api/diagnosis/unlock', req => {
    const ws = W(req), d = diagOf(ws.id);
    if (!d.unlocked) {
      const price = modCfg().price;
      if (price > 0 && !repo.charge(ws.id, price, '解锁 AI 运营（含 AI 面诊）', null)) throw new HttpError(402, `余额不足：需要 ${price} 点`);
      repo.saveDiagnosis(ws.id, { ...repo.diagnosis(ws.id), unlocked: true }); ops.track(ctx(req).owner, ws.id, 'diag_unlocked');
    }
    return { diagnosis: diagOf(ws.id) };
  });
  r.put('/api/diagnosis/answer', async req => {
    const ws = W(req), d = await body(req, z.object({ qid: z.string().max(10), text: z.string().max(2000) }));
    if (!diagOf(ws.id).unlocked) throw new HttpError(402, '先解锁 AI 运营');
    saveAnswer(repo, ws, d.qid, d.text.trim());
    return { diagnosis: diagOf(ws.id) };
  });
  r.post('/api/diagnosis/report', async req => {
    const ws = W(req), d = diagOf(ws.id);
    if (!d.unlocked) throw new HttpError(402, '先解锁 AI 运营');
    if (Object.values(d.answers).filter(x => x.trim()).length < 3) throw new HttpError(400, '至少回答 3 个问题，报告才准');
    const report = await runDiagnosis(repo, providers, ws);
    ops.track(ctx(req).owner, ws.id, 'diag_report');
    return { diagnosis: { ...diagOf(ws.id), report } };
  });
  r.put('/api/diagnosis/report', async req => {
    const ws = W(req), d = diagOf(ws.id);
    if (!d.report) throw new HttpError(404, '还没有报告');
    const p = await body(req, z.object({ tags: z.object({ personality: z.array(z.string().max(20)).max(6), pro: z.array(z.string().max(20)).max(6), brand: z.array(z.string().max(20)).max(6) }).optional(),
      columns: z.array(z.object({ name: z.string().max(20), kind: z.enum(['流量', '转化', '人设']), type: z.string().max(10), perWeek: z.number().int().min(1).max(7), why: z.string().max(80) })).max(6).optional() }));
    const report = { ...d.report, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) } as typeof d.report;
    repo.saveDiagnosis(ws.id, { ...d, report });
    // 改了标签、栏目：写回人设档案，排期按新栏目重排；新加的栏目补几个选题
    applyReport(repo, ws, report);
    if (p.columns) { const old = new Set(d.report.columns.map(c => c.name)); await seedColumnTopics(repo, providers, repo.ws(ws.id)!, report.columns.filter(c => !old.has(c.name))); }
    return { diagnosis: diagOf(ws.id) };
  });

  /* ---------- 写文案（知识库 → 文案） ---------- */
  r.post('/api/copy/write', async req => {
    const ws = W(req), d = await body(req, z.object({ idea: z.string().max(200).default(''), topicId: z.string().optional(), len: z.union([z.literal(30), z.literal(45), z.literal(60), z.literal(90)]).default(45), kb: z.boolean().default(true), column: z.string().max(20).optional(), style: z.string().max(30).optional() }));
    // 没写想法：按面诊栏目轮到的那个写；还没面诊就按人设档案的定位写（不再用行业模板里的示例项目）
    const col = d.column ?? (d.idea ? undefined : nextColumn(repo, ws)?.name);
    const t = d.topicId ? topicOr404(ws, d.topicId) : repo.insertTopic(ws.id, { cat: catIndex(ws.persona), title: (d.idea || col || ws.positioning.line || '这周想讲的一件事').slice(0, 60), hook: '', why: d.idea ? '自己的想法' : col ? `栏目「${col}」` : '人设档案', dir: col ?? '项目案例', type: 0, heat: 1, k: personaOf(ws.persona).att[0], ageMonths: 0, source: 'ai' });
    const out = await writeCopy(repo, providers, ws, t, { len: d.len, kb: d.kb, column: col, style: d.style });
    ops.track(ctx(req).owner, ws.id, 'copy_written', { kb: d.kb, used: out.used.length });
    return { draft: out.draft, used: out.used.map(i => ({ id: i.id, kind: i.kind, text: i.text })), cliches: out.cliches };
  });
  r.post('/api/gen/footage', async req => {
    const ws = W(req), d = await body(req, z.object({ assetIds: z.array(z.string()).min(1).max(20), idea: z.string().max(200).default(''), style: z.string().max(30).optional() }));
    const out = await footageCopy(repo, providers, ws, d.assetIds, d.idea, a => (a.url ? storage.get(a.url.slice(7).split('?')[0]).catch(() => null) : Promise.resolve(null)), d.style);
    ops.track(ctx(req).owner, ws.id, 'footage_copy', { clips: d.assetIds.length });
    return { title: out.title, lines: out.lines, assets: out.assets, used: out.used.map(i => ({ id: i.id, kind: i.kind, text: i.text })) };
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
  // 素材都带一句「拍了什么」：看图模型看过的用模型的；没接看图模型时只按文件名和时长写，不编画面内容
  r.get('/api/assets', req => ({ assets: repo.assets(W(req).id).map(a => ({ ...a, note: describeAsset(a), noteSrc: a.noteSrc ?? (a.source === '示例' ? 'sample' : 'name') })) }));
  r.get('/api/storage', req => ({ ...policy(), usedBytes: retention.usedBytes(ctx(req).owner), expiring: retention.expiring(ctx(req).owner, policy()) }));
  r.post('/api/assets/samples', req => { const ws = W(req); const n = addSampleAssets(repo, ws); ops.track(ctx(req).owner, ws.id, 'samples_added'); return { added: n }; });
  r.post('/api/assets', async req => {
    const ws = W(req), mime = String(req.raw.headers['content-type'] ?? 'application/octet-stream');
    if (!/^(image|video|audio)\//.test(mime)) throw new HttpError(415, '只支持图片、视频、音频');
    const name = decodeURIComponent(String(req.raw.headers['x-file-name'] ?? '未命名')).slice(0, 80);
    const buf = await readBuffer(req.raw, UPLOAD_LIMIT);
    if (retention.wouldExceed(ctx(req).owner, buf.length, policy())) throw new HttpError(413, `空间满了：每个账号最多存 ${policy().capacityMb} MB，先下载并删掉一些旧素材`);
    const ext = (extname(name) || '.' + (mime.split('/')[1] ?? 'bin')).toLowerCase().replace(/[^.a-z0-9]/g, '');
    const file = `${ws.id}/${newId('f')}${ext}`;
    await storage.put(file, buf, mime);
    ops.track(ctx(req).owner, ws.id, 'asset_uploaded', { mime, size: buf.length });
    // 来源前端是编码过的（中文放不进请求头），这里解码（以前没解，素材库里显示成 %E4%B8%8A…）
    const source = (() => { try { return decodeURIComponent(String(req.raw.headers['x-source'] ?? '上传')); } catch { return '上传'; } })().slice(0, 20) || '上传';
    let a = repo.insertAsset(ws.id, { type: ASSET_TYPE(mime), name, k: ASSET_TYPE(mime) === '视频' ? 'site' : 'live', file, mime, size: buf.length, source });
    // 读时长和宽高；说明先按文件名写，接了看图模型就在后台看一遍再更新
    const tmpFile = join(tmpdir(), `findai-up-${a.id}${ext}`);
    try { writeFileSync(tmpFile, buf); a = probeAsset(repo, ws.id, a, tmpFile); } catch { /* 读不了就算了 */ } finally { rmSync(tmpFile, { force: true }); }
    repo.setAssetNote(ws.id, a.id, describeAsset(a), 'name');
    if (providers.vision) void lookAtAsset(repo, providers, ws.id, a, buf);
    return { ...a, note: describeAsset(a), noteSrc: 'name' };
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
    return { issues: genIssues(g, ws.voiceClone, { firstFrame: firstFrameOk(), avatars: ws.avatars }), shots: shotsOf(g, assets, personaOf(ws.persona).att), cost: genCost(g, false, { voice: !!providers.tts }), finalCost: genCost(g, true, { voice: !!providers.tts }) };
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
    const title = d.title || d.settings.title || smartTitle(d.settings.copy) || '未命名';
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
  /* ---------- 视频 IP 新版（苗苗原型）：诊断、发布计划、出片草稿存成一份 ---------- */
  const studioKey = (ws: string) => `studio:${ws}`;
  const studioOf = (ws: string): StudioState => {
    const raw = ops.getSetting(studioKey(ws));
    const base = defaultStudio(todayIso());
    if (!raw) return base;
    try { const x = JSON.parse(raw) as Partial<StudioState>; return { ...base, ...x, diag: { ...emptyDiag(), ...(x.diag ?? {}) } }; } catch { return base; }
  };
  const saveStudio = (ws: string, st: StudioState) => {
    const v = JSON.stringify(st);
    if (v.length > 400_000) throw new HttpError(413, '内容太多了，先清掉一些');
    ops.setSetting(studioKey(ws), v);
  };
  r.get('/api/studio', req => ({ state: studioOf(W(req).id) }));
  r.put('/api/studio', async req => {
    const ws = W(req);
    const d = await body(req, z.object({ diag: z.record(z.unknown()).optional(), plan: z.array(z.record(z.unknown())).max(400).optional(), works: z.array(z.record(z.unknown())).max(400).optional(), draft: z.record(z.unknown()).nullable().optional(), avatar: z.string().max(40).optional() }));
    // 解锁只能走 /api/studio/unlock
    const cur = studioOf(ws.id);
    const next = { ...cur, ...d, diag: d.diag ? { ...cur.diag, ...d.diag, unlocked: cur.diag.unlocked } : cur.diag } as StudioState;
    saveStudio(ws.id, next);
    return { state: next };
  });
  r.post('/api/studio/reset', req => { const ws = W(req); ops.setSetting(studioKey(ws.id), null); return { state: studioOf(ws.id) }; });
  /** 出片：Seedance 2.5 样片模式。sample = 先出 480p 样片（成片价四成）；final = 出 1080p 成片，带 fromJob 就沿用那条样片 */
  r.post('/api/studio/render', async (req, res) => {
    const ws = W(req), owner = ctx(req).owner;
    const d = await body(req, z.object({ mode: z.enum(['sample', 'final']), fromJob: z.string().max(40).optional(), draft: z.object({
      type: z.enum(['tour', 'explain', 'talk', 'before', 'case', 'product', 'site', 'vlog']), face: z.enum(['avatar', 'none']), avatar: z.string().max(40),
      title: z.string().max(80), opt: z.object({ dur: z.string().max(20), ratio: z.string().max(20), font: z.string().max(20), bgm: z.string().max(20), voice: z.string().max(30) }),
      mats: z.array(z.record(z.unknown())).max(40),
      shots: z.array(z.object({ id: z.string().max(20), title: z.string().max(60), line: z.string().max(300), tip: z.string().max(120), k: z.string().max(20), secs: z.number().min(1).max(30), avatar: z.boolean().optional(),
        mat: z.object({ id: z.string().max(40), name: z.string().max(120), kind: z.enum(['photo', 'video']), k: z.string().max(20) }).passthrough().nullable().optional() })).min(1).max(12),
    }) }));
    if (ops.genPaused()) throw new HttpError(503, '生成功能暂时关闭了，管理员打开后就能用');
    if (o.dailyJobsPerUser && ops.jobsToday(owner) >= o.dailyJobsPerUser) throw new HttpError(429, `今天的生成次数用完了（每天 ${o.dailyJobsPerUser} 次），明天再来`);
    if (o.dailyBudget && ops.spentToday() >= o.dailyBudget) throw new HttpError(503, '今天的试用额度已经用完，明天再来');
    const full = costOf(d.draft.type, d.draft.opt.dur), sample = d.mode === 'sample', cost = sample ? sampleCost(full) : full;
    const g = toGen(d.draft as unknown as Parameters<typeof toGen>[0], { voiceReady: ws.voiceClone === 'ready', avatars: ws.avatars }, sample) as GenSettings;
    const blocking = genIssues(g, ws.voiceClone, { firstFrame: firstFrameOk(), avatars: ws.avatars }).filter(i => i.blocking);
    if (blocking.length) throw new HttpError(422, blocking.map(i => i.text).join('；'));
    if (d.fromJob && !repo.job(ws.id, d.fromJob)) throw new HttpError(404, '样片不存在');
    const title = d.draft.title || g.shots?.[0]?.line.slice(0, 20) || '一条视频';
    const out = runner.startVideo(ws, g, !sample, title, { cost, fromJob: d.fromJob });
    if (!out.ok) throw new HttpError(402, out.error);
    ops.track(owner, ws.id, sample ? 'gen_started' : 'final_started', { model: g.model, len: g.len, cost, studio: true });
    res.statusCode = 201; return { job: out.job, cost, balance: repo.ws(ws.id)!.balance };
  });
  /* ---------- 一键生成视频 / 诊断的 AI 技能（提示词和规则在技能中心维护） ---------- */
  r.get('/api/catalog', () => catalog());
  const matSchema = z.object({ id: z.string().max(40).default(''), name: z.string().max(120).default(''), kind: z.enum(['photo', 'video']), k: z.string().max(20).default('live'), url: z.string().max(400).nullable().optional(), mime: z.string().max(80).nullable().optional() });
  const typeSchema = z.enum(['tour', 'explain', 'talk', 'before', 'case', 'product', 'site', 'vlog']);
  r.post('/api/studio/advise', async req => {
    W(req);
    const d = await body(req, z.object({ mats: z.array(matSchema).max(40), copy: z.string().max(4000), pick: z.union([typeSchema, z.literal('auto')]) }));
    const r1 = await studioAi.advise(d);
    return { advice: r1.out, path: r1.path };
  });
  r.post('/api/studio/storyboard', async req => {
    W(req);
    const d = await body(req, z.object({ mats: z.array(matSchema).max(40), copy: z.string().max(4000), type: typeSchema, face: z.enum(['avatar', 'none']), target: z.number().int().min(3).max(600).optional() }));
    const r1 = await studioAi.storyboard({ ...d, mats: d.mats.map(m => ({ ...m, url: m.url ?? null, mime: m.mime ?? null })) });
    return { shots: r1.out.shots, path: r1.path };
  });
  r.post('/api/studio/pack', async req => {
    const ws = W(req);
    const d = await body(req, z.object({ type: typeSchema, lines: z.array(z.string().max(300)).min(1).max(20), city: z.string().max(10).optional() }));
    const city = d.city || (ws.positioning.line.match(/(北京|上海|广州|深圳|沈阳|大连|杭州|成都|重庆|武汉|南京|苏州|天津|西安|长沙|青岛|郑州|济南|合肥|厦门|福州|昆明|哈尔滨|长春|石家庄|太原|南宁|贵阳|南昌|宁波|无锡|佛山|东莞)/)?.[1] ?? undefined);
    const r1 = await studioAi.pack({ ...d, city });
    return { ...r1.out, path: r1.path };
  });
  const diagMsg = z.object({ who: z.enum(['ai', 'me']), text: z.string().max(2000), stage: z.number().int().min(0).max(3).optional(), n: z.number().int().optional() });
  r.post('/api/studio/diag/next', async req => {
    const ws = W(req);
    if (!studioOf(ws.id).diag.unlocked) throw new HttpError(402, '先解锁大哲诊断账号');
    const d = await body(req, z.object({ msgs: z.array(diagMsg).max(400), asked: z.number().int().min(0).max(400) }));
    const r1 = await studioAi.diagNext(d);
    return { msg: r1.out, path: r1.path };
  });
  r.post('/api/studio/diag/report', async req => {
    const ws = W(req);
    if (!studioOf(ws.id).diag.unlocked) throw new HttpError(402, '先解锁大哲诊断账号');
    const d = await body(req, z.object({ answers: z.array(z.string().max(2000)).min(1).max(200), name: z.string().max(20).optional() }));
    const min = skills.config<{ minAnswers: number }>('diag-agent').minAnswers;
    if (d.answers.length < min) throw new HttpError(400, `至少回答 ${min} 个问题再生成诊断`);
    const r1 = await studioAi.diagReport({ answers: d.answers, name: d.name || ws.positioning.name || '我' });
    ops.track(ctx(req).owner, ws.id, 'diag_report', { path: r1.path });
    return { result: r1.out, path: r1.path };
  });
  r.post('/api/studio/diag/topics', async req => {
    const ws = W(req);
    if (!studioOf(ws.id).diag.unlocked) throw new HttpError(402, '先解锁大哲诊断账号');
    const col = z.object({ n: z.string().max(20), d: z.string().max(200), eg: z.string().max(80), freq: z.number().int().min(1).max(7), src: z.string().max(60), type: typeSchema, ask: z.string().max(80), unit: z.string().max(6) });
    const d = await body(req, z.object({ result: z.object({ who: z.string().max(20), tags: z.object({ personal: z.array(z.string().max(30)), pro: z.array(z.string().max(40)), brand: z.array(z.string().max(60)) }), columns: z.array(col).min(1).max(8) }), counts: z.array(z.number().int().min(0).max(99)).max(8) }));
    const r1 = await studioAi.diagTopics(d);
    return { topics: r1.out.topics, path: r1.path, schedule: (({ weekdays, time }) => ({ weekdays, time }))(skills.config<{ weekdays: number[]; time: string }>('diag-topics')) };
  });

  /* ---------- 邀请有礼：分享链接 → 好友注册 → 好友充值，按「邀请赠送」规则发点 ---------- */
  r.post('/api/referral/click', async req => { const d = await body(req, z.object({ code: z.string().trim().min(4).max(20) })); return { ok: growth.click(d.code) }; });
  r.get('/api/referral/preview', req => ({ preview: growth.preview(String(req.query.get('code') ?? '')) }));
  r.get('/api/referral', req => {
    const c = ctx(req);
    if (!c.user) return { needLogin: true as const };
    return { needLogin: false as const, ...growth.mine(c.user.id, c.owner) };
  });
  r.post('/api/referral/share', req => { const c = ctx(req); if (!c.user) throw new HttpError(401, '登录后才能分享'); return { points: growth.onShare(c.owner) }; });

  /* ---------- 充值和在线支付 ---------- */
  let pay = loadPay(ups.env(), o.publicBaseUrl);
  /** 后台改了上游接口：重新接大模型、视频、配音、支付（不用重启） */
  const reloadUpstreams = () => {
    const next = loadProviders(ups.env(), aiRt, aiHooks);
    for (const k of Object.keys(providers)) delete (providers as unknown as Record<string, unknown>)[k];
    Object.assign(providers, next.providers);
    Object.assign(providerInfo, next.info);
    ai = { ...next, providers };
    setVideoModels(providerInfo.video === 'newapi' ? withCaps(MODELS, TUDOU_CAPS) : MODELS);
    pay = loadPay(ups.env(), o.publicBaseUrl);
    console.log(`上游接口已重新接入：文案 ${providerInfo.copy}，视频 ${providerInfo.video}，配音 ${providerInfo.tts}，支付 ${pay.info.channels.join('/') || '无'}`);
  };
  const pointsCfg = () => skills.config<PointsCfg>('points');
  /** 套餐和诊断价格：来自技能中心的「积分规则」 */
  const billing = (): BillingConfig => { const p = pointsCfg(); return normalizeBilling({ packages: p.packages, diagPrice: p.diagPrice }); };
  // 旧版后台存过「充值套餐」：第一次启动时搬进积分规则（存成一个版本）
  {
    const legacy = ops.getSetting('billing');
    if (legacy && !skills.activeVersion('points')) {
      try { const b = normalizeBilling(JSON.parse(legacy)); skills.save('points', { ...skills.data('points'), config: { ...skills.config('points'), packages: b.packages, diagPrice: b.diagPrice } }, '从旧版「充值套餐」设置搬过来', 'system'); } catch { /* 坏的就不搬 */ }
    }
    if (legacy) db.prepare("DELETE FROM settings WHERE k='billing'").run();
  }
  /** 到账后要做的事：诊断单解锁诊断（点数单在 settleOrder 里已经加了） */
  const settle = (orderId: string, tradeNo: string, amount: number) => {
    const od = repo.order(orderId);
    if (!od) throw new HttpError(404, '订单不存在');
    if (amount >= 0 && amount !== od.amount) throw new HttpError(400, '金额对不上');
    if (!repo.settleOrder(orderId, tradeNo)) return false;
    try { growth.onPaid({ id: od.id, ownerId: od.ownerId, product: od.product, points: od.points }); } catch (e) { console.warn('充值奖励发放失败：', (e as Error).message); }
    if (od.product === 'diag') { const st = studioOf(od.ws); st.diag.unlocked = true; saveStudio(od.ws, st); }
    ops.track(od.ownerId, od.ws, 'order_paid', { product: od.product, amount: od.amount, channel: od.channel });
    return true;
  };
  const publicOrder = (x: NonNullable<ReturnType<typeof repo.order>>) => { const { ws: _w, ownerId: _o, ...rest } = x; return rest; };
  r.get('/api/billing', req => {
    const ws = W(req);
    repo.closeStale(new Date(Date.now() - pointsCfg().orderTtlMin * 60e3).toISOString());
    return { ...billing(), orderTtlMin: pointsCfg().orderTtlMin, lowBalance: pointsCfg().lowBalance, channels: pay.info.channels, mock: pay.info.mock, balance: ws.balance, orders: repo.ordersOf(ws.id) };
  });
  r.post('/api/billing/orders', async (req, res) => {
    const ws = W(req), d = await body(req, z.object({ product: z.enum(['points', 'diag']), packageId: z.string().max(20).optional(), channel: z.enum(['wechat', 'alipay', 'mock']) }));
    const user = ctx(req).user;
    if (d.product === 'points' && !isAdmin(user) && viewFor(modCfg(), user?.email ?? null).recharge !== 'on') throw new HttpError(403, '在线充值还没开放，先用兑换码');
    const prov = pay.providers[d.channel as PayChannel];
    if (!prov) throw new HttpError(400, `${CHANNEL_NAME[d.channel as PayChannel]}还没开通`);
    const b = billing();
    let title: string, amount: number, points = 0;
    if (d.product === 'diag') {
      if (studioOf(ws.id).diag.unlocked) throw new HttpError(400, '已经解锁过了，不用再付');
      title = '大哲诊断账号 · 一次解锁'; amount = b.diagPrice;
    } else {
      const pk = b.packages.find(p => p.id === d.packageId);
      if (!pk) throw new HttpError(400, '套餐不存在，刷新一下再选');
      points = totalPoints(pk); title = `${pk.n} · ${points.toLocaleString()} 点`; amount = pk.price;
    }
    const od = repo.insertOrder(ws.id, { product: d.product, packageId: d.packageId ?? null, title, amount, points, channel: d.channel as PayChannel });
    try { const c = await prov.create({ id: od.id, amount, title: `FIND AI 视频工作室 · ${title}` }); repo.setOrderQr(od.id, c.qr); }
    catch (e) { repo.closeOrder(od.id); throw new HttpError(502, (e as Error).message || '下单失败，稍后再试'); }
    ops.track(ctx(req).owner, ws.id, 'order_created', { product: d.product, amount, channel: d.channel });
    res.statusCode = 201; return { order: publicOrder(repo.order(od.id)!) };
  });
  r.get('/api/billing/orders/:id', async req => {
    const ws = W(req), od = repo.order(req.params.id);
    if (!od || od.ownerId !== ws.ownerId) throw new HttpError(404, '订单不存在');
    // 回调没到（本机开发、网络抖动）时主动查一次单
    if (od.status === 'pending' && od.channel !== 'mock' && Date.now() - Date.parse(od.createdAt) > 4000) {
      const paid = await pay.providers[od.channel]?.query(od.id).catch(() => null);
      if (paid) settle(od.id, paid.tradeNo, paid.amount);
    }
    return { order: publicOrder(repo.order(od.id)!), balance: repo.ws(ws.id)!.balance };
  });
  r.post('/api/billing/orders/:id/mock-pay', req => {
    const ws = W(req), od = repo.order(req.params.id);
    if (!od || od.ownerId !== ws.ownerId) throw new HttpError(404, '订单不存在');
    if (od.channel !== 'mock' || !pay.providers.mock) throw new HttpError(400, '只有模拟支付能这样付');
    settle(od.id, `MOCK${Date.now()}`, od.amount);
    return { order: publicOrder(repo.order(od.id)!), balance: repo.ws(ws.id)!.balance };
  });
  for (const ch of ['wechat', 'alipay'] as const) {
    r.post(`/api/pay/notify/${ch}`, async (req, res) => {
      const prov = pay.providers[ch];
      if (!prov) throw new HttpError(404, '没开通');
      const raw = (await readBuffer(req.raw, 64 * 1024)).toString('utf8');
      try {
        const paid = await prov.notify(req.raw.headers, raw);
        if (paid) settle(paid.orderId, paid.tradeNo, paid.amount);
        res.writeHead(prov.ack.status, { 'content-type': prov.ack.type }).end(prov.ack.body);
      } catch (e) {
        console.warn(`${ch} 回调处理失败：`, (e as Error).message);
        if (ch === 'wechat') res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 'FAIL', message: (e as Error).message }));
        else res.writeHead(200, { 'content-type': 'text/plain' }).end('fail');
      }
    });
  }
  r.get('/api/admin/billing', req => {
    admin(req, 'orders');
    const day = new Date(); day.setHours(0, 0, 0, 0);
    return { config: billing(), channels: pay.info.channels, mock: pay.info.mock, orders: repo.allOrders(), today: repo.orderTotals(day.toISOString()), month: repo.orderTotals(new Date(Date.now() - 30 * 864e5).toISOString()) };
  });
  /** 充值套餐和诊断价格：存进技能中心「积分规则」（一个新版本，能回滚） */
  r.put('/api/admin/billing', async req => {
    const a = admin(req, 'points');
    const d = await body(req, z.object({ packages: z.array(z.object({ id: z.string().min(1).max(20), n: z.string().min(1).max(12), price: z.number().int().min(1).max(10_000_000), points: z.number().int().min(1).max(10_000_000), bonus: z.number().int().min(0).max(10_000_000), tag: z.string().max(6).optional() })).min(1).max(8), diagPrice: z.number().int().min(1).max(10_000_000) }));
    const c = normalizeBilling(d), cur = skills.data('points');
    const v = skills.save('points', { ...cur, config: { ...cur.config, packages: c.packages, diagPrice: c.diagPrice } }, '改充值套餐', a.email);
    audit(a, '修改充值套餐', 'points', { version: v, packages: c.packages.length, diagPrice: c.diagPrice });
    return { config: billing() };
  });
  r.post('/api/admin/billing/orders/:id/refund', req => {
    const a = admin(req, 'orders'); admin(req, 'points'); // 退款要财务权限（客服只能看订单）
    if (!repo.refundOrder(req.params.id)) throw new HttpError(400, '只有已支付的订单能标记退款');
    const revoked = growth.onRefund(req.params.id);
    audit(a, '订单退款', req.params.id, { revokedRewards: revoked });
    return { ok: true, note: `已扣回点数${revoked ? `，这笔订单带出的 ${revoked} 笔奖励（首充 / 返点）也收回了` : ''}。钱要在微信 / 支付宝商户后台原路退。` };
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

  /* ---------- 管理后台（dazheip 后台同款）：ADMIN_EMAILS 里的是超级管理员，别的后台账号按「管理权限」里的角色 ---------- */
  const adm = registerAdmin(r, {
    db, repo, skills, ups, growth, studioAi,
    adminOf: req => adminOf(ctx(req).user),
    reloadUpstreams,
    clearAiRuntime: keys => keys.forEach(k => ops.setSetting(k, null)),
    payInfo: () => pay.info,
    providerInfo: () => providerInfo,
    copyVars: req => systemVars(aiCtx(W(req))),
    adminEmails: o.adminEmails, dazheipAdminUrl: o.dazheipAdminUrl,
  });
  const admin = adm.need, audit = adm.audit;
  r.get('/api/admin/overview', req => { admin(req, 'overview'); const days = Math.min(90, Math.max(1, Number(req.query.get('days') ?? 7))); return { ...ops.overview(days), settings: { genPaused: ops.genPaused() }, config: { inviteRequired: o.inviteRequired, authRequired: !!o.authRequired, initialPoints: o.initialPoints, dailyJobsPerUser: o.dailyJobsPerUser, dailyBudget: o.dailyBudget }, ai: providerInfo }; });
  r.get('/api/admin/modules', req => { admin(req, 'modules'); return { modules: MODULES, presets: PRESETS, config: modCfg(), usage: ops.moduleUsage() }; });
  r.put('/api/admin/modules', async req => {
    const a = admin(req, 'modules');
    const st = z.enum(['on', 'beta', 'soon', 'off']);
    const d = await body(req, z.object({ preset: z.enum(['phase1', 'phase2', 'all']).optional(), states: z.record(st).optional(), beta: z.array(z.string().max(120)).max(500).optional(), pro: z.array(z.string().max(40)).max(80).optional(),
      price: z.number().int().min(0).max(100000).optional(), retentionDays: z.number().int().min(0).max(3650).optional(), capacityMb: z.number().int().min(0).max(1024 * 1024).optional(), withParents: z.boolean().optional() }));
    let c = modCfg();
    if (d.preset) c = { ...c, preset: d.preset as Preset, states: presetStates(d.preset as Preset) };
    if (d.states) {
      const states = { ...c.states, ...d.states };
      // 打开子模块时父模块关着：带上 withParents 就一起打开
      if (d.withParents) for (const [id, v] of Object.entries(d.states)) if (v !== 'off') for (const p of closedParents({ ...c, states }, id)) states[p] = v;
      c = { ...c, states };
    }
    c = normalizeConfig({ ...c, ...(d.beta ? { beta: d.beta } : {}), ...(d.pro ? { pro: d.pro } : {}), ...(d.price !== undefined ? { price: d.price } : {}), ...(d.retentionDays !== undefined ? { retentionDays: d.retentionDays } : {}), ...(d.capacityMb !== undefined ? { capacityMb: d.capacityMb } : {}) }, o.modulesPreset, DIAG_PRICE);
    saveModCfg(c);
    audit(a, '修改模块开关', 'modules', d);
    return { config: modCfg(), warn: Object.entries(c.states).filter(([id, v]) => v !== 'off' && closedParents(c, id).length).map(([id]) => ({ id, parents: closedParents(c, id) })) };
  });
  r.get('/api/admin/users', req => { admin(req, 'users'); return { users: ops.users() }; });
  r.post('/api/admin/users/:id/points', async req => {
    const a = admin(req, 'points');
    const { delta, reason } = await body(req, z.object({ delta: z.number().int().min(-100000).max(100000), reason: z.string().trim().max(80).default('后台用户页') }));
    if (!ops.addPoints(req.params.id, delta, reason)) throw new HttpError(404, '没有这个用户');
    audit(a, '调整积分', req.params.id, { delta, reason });
    return { users: ops.users() };
  });
  r.get('/api/admin/invites', req => { admin(req, 'codes'); return { invites: ops.listInvites() }; });
  r.post('/api/admin/invites', async req => { const a = admin(req, 'codes'); const d = await body(req, z.object({ count: z.number().int().min(1).max(100), maxUses: z.number().int().min(1).max(1000).default(1), note: z.string().max(40).default('') })); const codes = ops.createInvites(d.count, d.maxUses, d.note); audit(a, '生成邀请码', d.note, { count: d.count, maxUses: d.maxUses }); return { codes, invites: ops.listInvites() }; });
  r.get('/api/admin/redeem', req => { admin(req, 'codes'); return { codes: repo.redeemCodes() }; });
  r.post('/api/admin/redeem', async req => {
    const a = admin(req, 'codes');
    const d = await body(req, z.object({ count: z.number().int().min(1).max(100), points: z.number().int().min(1).max(100000), maxUses: z.number().int().min(1).max(1000).default(1), note: z.string().max(40).default('') }));
    const codes = Array.from({ length: d.count }, () => randomBytes(4).toString('hex').toUpperCase());
    codes.forEach(c => repo.createRedeem(c, d.points, d.maxUses, d.note));
    audit(a, '生成兑换码', d.note, { count: d.count, points: d.points, maxUses: d.maxUses });
    return { codes, list: repo.redeemCodes() };
  });
  r.get('/api/admin/feedback', req => { admin(req, 'feedback'); return { feedback: ops.listFeedback() }; });
  r.post('/api/admin/feedback/:id', async req => { admin(req, 'feedback'); const { status } = await body(req, z.object({ status: z.enum(['new', 'read', 'done']) })); ops.setFeedback(req.params.id, status); return { feedback: ops.listFeedback() }; });
  r.put('/api/admin/settings', async req => { const a = admin(req, 'modules'); const d = await body(req, z.object({ genPaused: z.boolean() })); ops.setGenPaused(d.genPaused); audit(a, d.genPaused ? '暂停生成' : '恢复生成', 'settings'); return { settings: { genPaused: ops.genPaused() } }; });

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
  // 旧版「AI 服务」接口（新版在「上游接口」页）：留着给老脚本用
  r.get('/api/admin/ai', req => { admin(req, 'upstreams'); return { status: ai.status(), tiers: [...videoModels().filter(m => !m.off).map(m => ({ id: m.id, n: m.n, d: m.d })), { id: 'draft', n: '样片（低价预览）', d: '开了样片模式时所有档位都先用它出低清预览' }] }; });
  r.post('/api/admin/ai/models', async req => { admin(req, 'upstreams'); const [llm, video] = await Promise.all([listModels(ai.endpoints.llm), listModels(ai.endpoints.video)]); return { llm, video }; });
  r.put('/api/admin/ai', async req => {
    const a = admin(req, 'upstreams');
    const d = await body(req, z.object({ llmModel: z.string().trim().max(120).nullable().optional(), llmModelFine: z.string().trim().max(120).nullable().optional(), llmFallbacks: z.array(z.string().trim().min(1).max(120)).max(5).optional(), videoModels: z.record(z.string().trim().max(120)).optional() }));
    if (d.llmModel !== undefined) ops.setSetting('llm_model', d.llmModel || null);
    if (d.llmModelFine !== undefined) ops.setSetting('llm_model_fine', d.llmModelFine || null);
    if (d.llmFallbacks) ops.setSetting('llm_fallbacks', d.llmFallbacks.join(','));
    if (d.videoModels) ops.setSetting('video_models', JSON.stringify(Object.fromEntries(Object.entries(d.videoModels).filter(([, v]) => v))));
    audit(a, '切换模型', 'ai', d);
    return { status: ai.status() };
  });
  r.post('/api/admin/ai/test', async req => {
    admin(req, 'upstreams');
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
        if (!req.path.startsWith('/api/auth/') && !req.path.startsWith('/api/pay/notify/')) {
          const c = ctx(req); if (c.setCookie) res.setHeader('set-cookie', c.setCookie);
          // 模块开关：隐藏、预告、不在内测名单的模块，接口直接拒绝（管理员不受限，方便预览）
          const mid = moduleForApi(req.method, req.path);
          if (mid && !isAdmin(c.user) && viewFor(modCfg(), c.user?.email ?? null)[mid] !== 'on') throw new HttpError(403, '这个功能还没开放');
        }
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

  return { server: createServer((q, s) => { void handle(q, s); }), db, repo, ops, signedUrl, providerInfo, retention, policy };
}
