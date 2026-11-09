// 后台（dazheip 后台同款）新增的接口：数据总览、技能中心、上游接口、积分系统、邀请赠送、出片任务、管理权限、操作日志。
// 每个接口按后台角色检查权限（shared/admin.ts），改东西的都记操作日志（audit_log）。
import { z } from 'zod';
import type { DB } from './db.ts';
import { now } from './db.ts';
import { HttpError, body, type Req, type Router } from './http.ts';
import type { Skills } from './skills/registry.ts';
import type { Upstreams } from './upstreams.ts';
import type { Growth, PointsCfg, ReferralCfg } from './growth.ts';
import { rulesText } from './growth.ts';
import type { StudioAi } from './studio-ai.ts';
import type { Repo } from './repo.ts';
import { ROLES, type AdminMe, type AdminPerm, type AdminRole } from '../shared/admin.ts';
import { CATEGORY_NAME, type SkillData, type SkillView } from '../shared/skills.ts';
import { GIFT_KINDS, KIND_NAME, type LedgerKind } from '../shared/points.ts';
import { VTYPES, costOf, sampleCost, type VType } from '../shared/studio.ts';
import { totalPoints, yuan } from '../shared/billing.ts';

type Row = Record<string, any>;
export interface AdminDeps {
  db: DB; repo: Repo; skills: Skills; ups: Upstreams; growth: Growth; studioAi: StudioAi;
  adminOf: (req: Req) => AdminMe | null;
  reloadUpstreams: () => void;
  /** 清掉旧版「AI 服务」页存的模型覆盖（改了上游接口里的模型名以后，以上游接口为准） */
  clearAiRuntime: (keys: ('llm_model' | 'llm_model_fine' | 'llm_fallbacks' | 'video_models')[]) => void;
  payInfo: () => { channels: string[]; mock: boolean };
  providerInfo: () => { copy: string; video: string; tts: string; vision: string };
  /** 文案写手试运行用：当前后台账号工作区的人设变量（行业、人设、定位、目标…） */
  copyVars: (req: Req) => Record<string, string>;
  adminEmails: string[]; dazheipAdminUrl: string;
}

/** 出片任务的成片类型名：新版（一键生成视频）存了 studio = 成片类型；老任务按旧的视频类型猜 */
const OLD_TYPE: Record<string, string> = { tour: '空间漫游', talk: '真人口播', house: '改造前后', story: '案例故事', product: '产品种草', site: '工地记录', vlog: 'Vlog', real: '实拍出片（旧版）' };
const typeName = (g: Record<string, any>) => (g.studio && VTYPES.find(t => t.id === g.studio)?.n) || OLD_TYPE[g.type] || '其他';

/** dazheip 后台原有的菜单（我们这边没有，点了跳过去） */
export const DAZHEIP_MENU = [
  ['knowledge', '知识与情报'], ['strategy', '策略中心'], ['persona', '默认人设'], ['samples', '样本案例'], ['compliance', '合规规则'],
  ['members', '会员管理'], ['notice', '通知管理'], ['service', '在线客服'], ['course', '实战课堂'], ['settings', '系统设置'],
] as const;

export function registerAdmin(r: Router, d: AdminDeps) {
  const { db, skills, ups, growth } = d;
  const need = (req: Req, perm: AdminPerm) => {
    const a = d.adminOf(req);
    if (!a) throw new HttpError(403, '只有后台账号能看');
    if (!a.perms.includes(perm)) throw new HttpError(403, `你的后台角色（${a.roleName}）没有这个权限`);
    return a;
  };
  const audit = (a: AdminMe, action: string, target: string, detail?: unknown) => {
    db.prepare('INSERT INTO audit_log (actor, action, target, detail, created_at) VALUES (?,?,?,?,?)').run(a.email, action, target, detail === undefined ? null : JSON.stringify(detail).slice(0, 4000), now());
  };
  const one = (sql: string, ...a: (string | number)[]) => db.prepare(sql).get(...a) as Row;
  const since = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

  /* ---------- 我是谁、菜单 ---------- */
  r.get('/api/admin/me', req => {
    const a = d.adminOf(req);
    if (!a) throw new HttpError(403, '只有后台账号能看');
    return { me: a, roles: ROLES, dazheip: { base: d.dazheipAdminUrl, menu: DAZHEIP_MENU.map(([id, n]) => ({ id, n, url: `${d.dazheipAdminUrl}/${id}` })) } };
  });

  /* ---------- 数据总览 ---------- */
  r.get('/api/admin/dashboard', req => {
    need(req, 'overview');
    const days = Math.min(90, Math.max(1, Number(req.query.get('days') ?? 30))), s = since(days);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const kinds = db.prepare(`SELECT kind, COALESCE(SUM(delta),0) AS s, COUNT(*) AS n FROM ledger WHERE created_at >= ? GROUP BY kind`).all(s) as Row[];
    const kindSum = (k: string) => Number(kinds.find(x => x.kind === k)?.s ?? 0);
    const jobs = db.prepare(`SELECT input, kind, status, cost FROM jobs WHERE created_at >= ? AND kind LIKE 'video%'`).all(s) as Row[];
    // 成片类型覆盖（dazheip「品类样本覆盖」同款）：按一键生成视频的成片类型数
    const cover = new Map<string, { n: number; final: number; sample: number; failed: number; cost: number }>();
    for (const j of jobs) {
      let g: Row = {}; try { g = JSON.parse(j.input) ?? {}; } catch { /* 旧数据 */ }
      const name = typeName(g), c = cover.get(name) ?? { n: 0, final: 0, sample: 0, failed: 0, cost: 0 };
      c.n++; if (j.kind === 'video_final') c.final++; else c.sample++; if (j.status === 'failed') c.failed++; else c.cost += Number(j.cost) || 0;
      cover.set(name, c);
    }
    const daily = db.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM users WHERE created_at >= ? GROUP BY day`).all(since(14)) as Row[];
    const dailyJobs = db.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM jobs WHERE created_at >= ? GROUP BY day`).all(since(14)) as Row[];
    const dailyPay = db.prepare(`SELECT substr(paid_at,1,10) AS day, COALESCE(SUM(amount),0) AS amount FROM orders WHERE status='paid' AND paid_at >= ? GROUP BY day`).all(since(14)) as Row[];
    const upList = skills.files().filter(f => f.category === 'upstream');
    return {
      days,
      tiles: {
        users: one('SELECT COUNT(*) AS n FROM users').n, usersNew: one('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', today.toISOString()).n,
        payers: one(`SELECT COUNT(DISTINCT owner_id) AS n FROM orders WHERE status='paid'`).n,
        orders: one(`SELECT COUNT(*) AS n FROM orders WHERE status='paid'`).n, revenue: one(`SELECT COALESCE(SUM(amount),0) AS s FROM orders WHERE status='paid'`).s,
        revenuePeriod: one(`SELECT COALESCE(SUM(amount),0) AS s FROM orders WHERE status='paid' AND paid_at >= ?`, s).s,
        jobs: jobs.length, finals: jobs.filter(j => j.kind === 'video_final').length, failed: jobs.filter(j => j.status === 'failed').length,
        spent: Math.round(-(kindSum('spend') + kindSum('refund'))),
        issuedPaid: Math.round(kindSum('recharge')), issuedGift: Math.round(GIFT_KINDS.reduce((a, k) => a + kindSum(k), 0)),
        balance: Math.round(one('SELECT COALESCE(SUM(balance),0) AS s FROM owners o WHERE EXISTS (SELECT 1 FROM users u WHERE u.owner_id=o.id)').s),
        referrals: one('SELECT COUNT(*) AS n FROM referrals WHERE created_at >= ?', s).n,
        diagUnlocks: one(`SELECT COUNT(*) AS n FROM orders WHERE status='paid' AND product='diag'`).n,
        skills: skills.files().length, skillsEdited: skills.files().filter(f => skills.activeVersion(f.id)).length,
        upstreams: upList.length, upstreamsOn: upList.filter(f => ups.status(f.id).configured).length,
        feedbackNew: one(`SELECT COUNT(*) AS n FROM feedback WHERE status='new'`).n,
      },
      coverage: [...cover.entries()].map(([name, c]) => ({ name, ...c, cost: Math.round(c.cost) })).sort((a, b) => b.n - a.n),
      typePrices: VTYPES.map(t => ({ id: t.id, n: t.n, pts: t.pts, sample: sampleCost(t.pts), secs: t.secs, enabled: t.enabled !== false })),
      trend: [...Array(14)].map((_, i) => { const day = since(13 - i).slice(0, 10); return { day, users: daily.find(x => x.day === day)?.n ?? 0, jobs: dailyJobs.find(x => x.day === day)?.n ?? 0, amount: dailyPay.find(x => x.day === day)?.amount ?? 0 }; }),
      ai: d.providerInfo(), pay: d.payInfo(),
    };
  });

  /* ---------- 技能中心 ---------- */
  const view = (id: string, full = false): SkillView => {
    const f = skills.file(id);
    const { config: _c, prompts: _p, ...meta } = f;
    return {
      ...meta, doc: full ? f.doc : '', examples: full ? f.examples : [],
      data: full ? skills.data(id) : { enabled: skills.data(id).enabled, prompts: {}, config: {} },
      defaults: full ? skills.defaults(id) : { enabled: true, prompts: {}, config: {} },
      activeVersion: skills.activeVersion(id), versions: full ? skills.versions(id) : skills.versions(id).slice(0, 1), stats: skills.stats(id),
      upstream: f.category === 'upstream' ? ups.status(id) : undefined,
    };
  };
  r.get('/api/admin/skills', req => {
    need(req, 'skills');
    return { skills: skills.files().map(f => view(f.id)), categories: CATEGORY_NAME };
  });
  r.get('/api/admin/skills/:id', req => {
    need(req, 'skills');
    if (!skills.has(req.params.id)) throw new HttpError(404, '没有这个技能');
    return { skill: view(req.params.id, true), calls: skills.recentCalls(req.params.id) };
  });
  r.get('/api/admin/skills/:id/versions/:v', req => {
    need(req, 'skills');
    const v = Number(req.params.v), data = v ? skills.version(req.params.id, v) : skills.defaults(req.params.id);
    if (!data) throw new HttpError(404, '没有这一版');
    return { data };
  });
  const dataSchema = z.object({ enabled: z.boolean(), prompts: z.record(z.string().max(20000)), config: z.record(z.unknown()) });
  r.put('/api/admin/skills/:id', async req => {
    const a = need(req, 'skills'), id = req.params.id;
    if (!skills.has(id)) throw new HttpError(404, '没有这个技能');
    if (skills.file(id).category === 'upstream') throw new HttpError(400, '上游接口在「上游接口」页改');
    const b = await body(req, z.object({ data: dataSchema, note: z.string().trim().max(200).default('') }));
    let v: number;
    try { v = skills.save(id, b.data as SkillData, b.note || '后台修改', a.email); } catch (e) { throw new HttpError(400, (e as Error).message); }
    audit(a, '保存技能', id, { version: v, note: b.note });
    return { skill: view(id, true), version: v };
  });
  r.post('/api/admin/skills/:id/activate', async req => {
    const a = need(req, 'skills'), id = req.params.id;
    const b = await body(req, z.object({ version: z.number().int().min(0) }));
    try { skills.activate(id, b.version); } catch (e) { throw new HttpError(400, (e as Error).message); }
    audit(a, b.version ? '切换技能版本' : '技能恢复默认', id, { version: b.version });
    return { skill: view(id, true) };
  });
  r.post('/api/admin/skills/:id/enabled', async req => {
    const a = need(req, 'skills'), id = req.params.id;
    const b = await body(req, z.object({ enabled: z.boolean() }));
    const cur = skills.data(id);
    const v = skills.save(id, { ...cur, enabled: b.enabled }, b.enabled ? '启用' : '停用', a.email);
    audit(a, b.enabled ? '启用技能' : '停用技能', id, { version: v });
    return { skill: view(id, true) };
  });
  /** 试运行：可以拿没保存的草稿跑；force 强制走大模型 / 规则 */
  r.post('/api/admin/skills/:id/test', async req => {
    need(req, 'skills');
    const id = req.params.id;
    if (!skills.has(id)) throw new HttpError(404, '没有这个技能');
    const b = await body(req, z.object({ input: z.record(z.unknown()).default({}), data: dataSchema.optional(), force: z.enum(['llm', 'rule']).optional() }));
    const o = { data: b.data as SkillData | undefined, force: b.force, log: false };
    const inp = b.input as Record<string, any>;
    const f = skills.file(id);
    try {
      switch (id) {
        case 'video-advise': return await d.studioAi.advise({ mats: inp.mats ?? [], copy: String(inp.copy ?? ''), pick: inp.pick ?? 'auto' }, o);
        case 'storyboard': return await d.studioAi.storyboard({ copy: String(inp.copy ?? ''), type: (inp.type ?? 'talk') as VType, face: inp.face === 'none' ? 'none' : 'avatar', mats: inp.mats ?? [], target: Number(inp.target) || undefined }, o);
        case 'publish-pack': return await d.studioAi.pack({ type: (inp.type ?? 'talk') as VType, lines: Array.isArray(inp.lines) ? inp.lines.map(String) : [], city: inp.city }, o);
        case 'diag-agent': return await d.studioAi.diagNext({ msgs: inp.msgs ?? [], asked: Number(inp.asked) || 0 }, o);
        case 'diag-report': return await d.studioAi.diagReport({ answers: Array.isArray(inp.answers) ? inp.answers.map(String) : [], name: inp.name }, o);
        case 'diag-topics': return await d.studioAi.diagTopics({ result: inp.result, counts: inp.counts ?? [] }, o);
        case 'copywriter': return await d.studioAi.copyTest({ clips: Array.isArray(inp.clips) ? inp.clips.map(String).slice(0, 12) : [], idea: String(inp.idea ?? ''), vars: d.copyVars(req) }, o);
      }
      if (f.category === 'upstream') { const t = await ups.test(id); return { out: t, path: 'rule', ms: t.ms }; }
      return { out: preview(id, (b.data as SkillData | undefined)?.config), path: 'rule', ms: 0 };
    } catch (e) { throw new HttpError(400, `试运行出错：${(e as Error).message}`); }
  });
  /** 规则类技能的「效果预览」 */
  const preview = (id: string, cfg?: Record<string, unknown>) => {
    const c = (cfg ?? skills.config(id)) as Record<string, any>;
    if (id === 'video-types') return { 价格表: (c.types as typeof VTYPES).map(t => ({ 类型: t.n, 启用: t.enabled !== false ? '是' : '否', 成片价: t.pts, 样片价: sampleCost(t.pts), 推荐时长: `${t.secs} 秒`, '改成 60 秒': costOf(t.id, '60 秒') })) };
    if (id === 'points') { const p = c as PointsCfg; return { 套餐: p.packages.map(k => ({ 名称: k.n, 价格: yuan(k.price), 到账: totalPoints(k), '每元': (totalPoints(k) / (k.price / 100)).toFixed(1) })), 口径: `1 ${p.pointName}≈${p.secondsPerPoint} 秒；样片 = 成片 × ${p.sampleRate}；新访客 ${p.initialPoints ?? '跟环境变量'}；注册送 ${p.signupBonus}；诊断 ${yuan(p.diagPrice)}`, 举例: VTYPES.slice(0, 3).map(t => `${t.n}：成片 ${t.pts}，样片 ${Math.max(p.sampleMin, Math.round(t.pts * p.sampleRate / 5) * 5)}`) }; }
    if (id === 'referral') { const x = c as ReferralCfg; return { 规则文案: rulesText(x), '好友注册': `邀请人 +${x.invite.inviterPoints}，好友 +${x.invite.inviteePoints}（${{ register: '注册就发', first_gen: '好友第一次出片后发', first_pay: '好友第一次充值后发' }[x.invite.rewardOn]}）`, '好友充 ¥299（3500 点）': `邀请人返 ${Math.floor(3500 * x.rebate.rate)} 点；好友首充自己再得 ${x.firstRecharge.fixed + Math.floor(3500 * x.firstRecharge.rate)} 点` }; }
    return c;
  };
  r.get('/api/admin/skills/:id/export', (req, res) => {
    need(req, 'skills');
    const id = req.params.id, f = skills.file(id), dd = skills.data(id);
    const out = { id, name: f.name, category: f.category, exportedAt: now(), version: skills.activeVersion(id), enabled: dd.enabled, prompts: dd.prompts, config: f.category === 'upstream' ? { enabled: dd.enabled } : dd.config };
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${id}-v${out.version}.json"` }).end(JSON.stringify(out, null, 2));
  });

  /* ---------- 上游接口 ---------- */
  const upList = () => skills.files().filter(f => f.category === 'upstream').map(f => ({ id: f.id, name: f.name, summary: f.summary, doc: f.doc, fields: f.fields, status: ups.status(f.id), meta: ups.meta(f.id), stats: skills.stats(f.id), usage: f.id === 'up-llm' ? skills.stats('up-llm') : null }));
  r.get('/api/admin/upstreams', req => {
    need(req, 'upstreams');
    return { upstreams: upList(), videoProvider: ups.videoProvider(), ai: d.providerInfo(), pay: d.payInfo(), videoStats: skills.stats('upstream:video') };
  });
  r.put('/api/admin/upstreams/video-provider', async req => {
    const a = need(req, 'upstreams'), b = await body(req, z.object({ provider: z.enum(['auto', 'seedance', 'newapi', 'mock']) }));
    ups.setVideoProvider(b.provider); d.reloadUpstreams(); audit(a, '切换视频服务', b.provider);
    return { videoProvider: ups.videoProvider(), ai: d.providerInfo() };
  });
  r.put('/api/admin/upstreams/:id', async req => {
    const a = need(req, 'upstreams'), id = req.params.id;
    if (!skills.has(id) || skills.file(id).category !== 'upstream') throw new HttpError(404, '没有这个上游接口');
    const b = await body(req, z.object({ enabled: z.boolean().optional(), values: z.record(z.string().max(20000).nullable()).optional() }));
    try { ups.save(id, b, a.email); } catch (e) { throw new HttpError(400, (e as Error).message); }
    const v = b.values ?? {};
    if (id === 'up-llm' && ['model', 'fineModel', 'fallbacks'].some(k => k in v)) d.clearAiRuntime(['llm_model', 'llm_model_fine', 'llm_fallbacks']);
    if ((id === 'up-seedance' || id === 'up-newapi') && ['s25', 's20', 's20f', 'draft'].some(k => k in v)) d.clearAiRuntime(['video_models']);
    d.reloadUpstreams();
    // 日志里不记密钥本身，只记改了哪些字段
    audit(a, '修改上游接口', id, { enabled: b.enabled, fields: Object.keys(b.values ?? {}) });
    return { upstreams: upList(), ai: d.providerInfo(), pay: d.payInfo() };
  });
  r.post('/api/admin/upstreams/:id/test', async req => {
    need(req, 'upstreams');
    const b = await body(req, z.object({ values: z.record(z.string().max(20000)).default({}) }));
    return await ups.test(req.params.id, b.values);
  });
  r.post('/api/admin/upstreams/:id/models', async req => {
    need(req, 'upstreams');
    const id = req.params.id, st = ups.env();
    const ep = id === 'up-llm' ? { base: st.LLM_BASE_URL, key: st.LLM_API_KEY } : id === 'up-newapi' ? { base: st.VIDEO_BASE_URL, key: st.VIDEO_API_KEY } : id === 'up-vision' ? { base: st.VISION_BASE_URL || st.LLM_BASE_URL, key: st.VISION_API_KEY || st.LLM_API_KEY } : null;
    if (!ep?.base || !ep.key) throw new HttpError(400, '先填好接口地址和 API Key 并保存');
    try {
      const res = await fetch(`${ep.base.replace(/\/$/, '')}/models`, { headers: { authorization: `Bearer ${ep.key}` }, signal: AbortSignal.timeout(20000) });
      const j = await res.json().catch(() => ({})) as { data?: { id: string }[]; error?: { message?: string } };
      if (!res.ok) throw new Error(`${res.status}${j.error?.message ? `：${j.error.message}` : ''}`);
      return { models: (j.data ?? []).map(m => m.id).sort() };
    } catch (e) { throw new HttpError(502, `拉不到模型列表：${(e as Error).message}`); }
  });

  /* ---------- 积分系统 ---------- */
  r.get('/api/admin/points', req => {
    need(req, 'points');
    const days = Math.min(365, Math.max(1, Number(req.query.get('days') ?? 30))), s = since(days);
    const byKind = (db.prepare(`SELECT kind, COALESCE(SUM(delta),0) AS s, COUNT(*) AS n FROM ledger WHERE created_at >= ? GROUP BY kind`).all(s) as Row[])
      .map(x => ({ kind: x.kind as LedgerKind, name: KIND_NAME[x.kind as LedgerKind] ?? x.kind, sum: Math.round(x.s), n: x.n }));
    const q = String(req.query.get('q') ?? '').trim(), kind = String(req.query.get('kind') ?? '');
    const where = ['l.created_at >= ?'], args: (string | number)[] = [s];
    if (q) { where.push('(u.email LIKE ? OR u.name LIKE ? OR l.reason LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (kind) { where.push('l.kind = ?'); args.push(kind); }
    const ledger = db.prepare(`SELECT l.delta, l.reason, l.kind, l.created_at AS createdAt, u.email, u.name FROM ledger l LEFT JOIN users u ON u.owner_id = l.owner_id
      WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT 300`).all(...args) as Row[];
    return {
      days, byKind, kinds: KIND_NAME, ledger,
      balance: Math.round(one('SELECT COALESCE(SUM(balance),0) AS s FROM owners o WHERE EXISTS (SELECT 1 FROM users u WHERE u.owner_id=o.id)').s),
      config: skills.config('points'), version: skills.activeVersion('points'),
      types: VTYPES.map(t => ({ id: t.id, n: t.n, pts: t.pts, secs: t.secs, sample: sampleCost(t.pts), enabled: t.enabled !== false })),
    };
  });
  r.put('/api/admin/points', async req => {
    const a = need(req, 'points');
    const b = await body(req, z.object({ config: z.record(z.unknown()), note: z.string().max(200).default('') }));
    const cur = skills.data('points');
    try { const v = skills.save('points', { ...cur, config: { ...cur.config, ...b.config } }, b.note || '积分规则', a.email); audit(a, '修改积分规则', 'points', { version: v }); }
    catch (e) { throw new HttpError(400, (e as Error).message); }
    return { config: skills.config('points') };
  });
  /** 成片类型的价格（改的是「成片类型与价格」技能里的 pts / secs / enabled） */
  r.put('/api/admin/points/types', async req => {
    const a = need(req, 'points');
    const b = await body(req, z.object({ types: z.array(z.object({ id: z.string(), pts: z.number().int().min(1).max(100000), secs: z.number().int().min(3).max(600), enabled: z.boolean() })).min(1) }));
    const cur = skills.data('video-types'), types = (cur.config.types as typeof VTYPES).map(t => { const x = b.types.find(y => y.id === t.id); return x ? { ...t, pts: x.pts, secs: x.secs, enabled: x.enabled } : t; });
    try { const v = skills.save('video-types', { ...cur, config: { ...cur.config, types } }, '改价格', a.email); audit(a, '修改成片价格', 'video-types', { version: v, types: b.types }); }
    catch (e) { throw new HttpError(400, (e as Error).message); }
    return { types: VTYPES.map(t => ({ id: t.id, n: t.n, pts: t.pts, secs: t.secs, sample: sampleCost(t.pts), enabled: t.enabled !== false })) };
  });
  r.post('/api/admin/points/adjust', async req => {
    const a = need(req, 'points');
    const b = await body(req, z.object({ email: z.string().trim().toLowerCase().email('邮箱不对'), delta: z.number().int().min(-1_000_000).max(1_000_000).refine(x => x !== 0, '调整数不能是 0'), reason: z.string().trim().min(2, '写一下原因').max(80) }));
    const u = db.prepare('SELECT owner_id FROM users WHERE email=?').get(b.email) as Row | undefined;
    if (!u) throw new HttpError(404, '没有这个用户');
    const real = growth.grant(u.owner_id, b.delta, 'admin', `管理员调整：${b.reason}`);
    audit(a, '调整积分', b.email, { delta: real, reason: b.reason });
    return { delta: real, balance: one('SELECT balance FROM owners WHERE id=?', u.owner_id).balance };
  });

  /* ---------- 邀请赠送 ---------- */
  r.get('/api/admin/referral', req => {
    need(req, 'referral');
    const days = Math.min(365, Math.max(1, Number(req.query.get('days') ?? 30)));
    return {
      stats: growth.adminStats(since(days)), days,
      list: growth.adminList({ status: String(req.query.get('status') ?? '') || undefined, search: String(req.query.get('q') ?? '') || undefined }),
      config: skills.config('referral'), version: skills.activeVersion('referral'), rules: rulesText(skills.config<ReferralCfg>('referral')),
    };
  });
  r.put('/api/admin/referral', async req => {
    const a = need(req, 'referral');
    const b = await body(req, z.object({ config: z.record(z.unknown()), note: z.string().max(200).default('') }));
    const cur = skills.data('referral');
    try { const v = skills.save('referral', { ...cur, config: { ...cur.config, ...b.config } }, b.note || '邀请赠送规则', a.email); audit(a, '修改邀请赠送规则', 'referral', { version: v }); }
    catch (e) { throw new HttpError(400, (e as Error).message); }
    return { config: skills.config('referral'), rules: rulesText(skills.config<ReferralCfg>('referral')) };
  });
  r.post('/api/admin/referral/:id/revoke', async req => {
    const a = need(req, 'referral');
    const b = await body(req, z.object({ note: z.string().trim().min(2, '写一下原因').max(120) }));
    let back = 0;
    try { back = growth.revoke(req.params.id, b.note); } catch (e) { throw new HttpError(404, (e as Error).message); }
    audit(a, '收回邀请奖励', req.params.id, { points: back, note: b.note });
    return { back };
  });

  /* ---------- 出片任务（全站） ---------- */
  r.get('/api/admin/jobs', req => {
    need(req, 'jobs');
    const st = String(req.query.get('status') ?? ''), q = String(req.query.get('q') ?? '').trim();
    const where = [`j.kind LIKE 'video%'`], args: (string | number)[] = [];
    if (st) { where.push('j.status = ?'); args.push(st); }
    if (q) { where.push('(u.email LIKE ? OR j.title LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
    const rows = db.prepare(`SELECT j.id, j.kind, j.status, j.cost, j.title, j.error, j.input, j.created_at AS createdAt, j.updated_at AS updatedAt, u.email
      FROM jobs j JOIN workspaces w ON w.id=j.ws LEFT JOIN users u ON u.owner_id=w.owner_id WHERE ${where.join(' AND ')} ORDER BY j.created_at DESC LIMIT 200`).all(...args) as Row[];
    const refunded = new Set((db.prepare(`SELECT key FROM rewards WHERE key LIKE 'jobrefund:%'`).all() as Row[]).map(x => String(x.key).slice(10)));
    return {
      jobs: rows.map(j => {
        let g: Row = {}; try { g = JSON.parse(j.input) ?? {}; } catch { /* */ }
        return { id: j.id, kind: j.kind, status: j.status, cost: j.cost, title: j.title, error: j.error, createdAt: j.createdAt, updatedAt: j.updatedAt, email: j.email ?? '未登录用户',
          type: typeName(g), model: g.model ?? '', draft: !!g.draft, len: g.len ?? 0, manualRefund: refunded.has(j.id) };
      }),
      counts: Object.fromEntries((db.prepare(`SELECT status, COUNT(*) AS n FROM jobs WHERE kind LIKE 'video%' GROUP BY status`).all() as Row[]).map(x => [x.status, x.n])),
    };
  });
  r.post('/api/admin/jobs/:id/refund', async req => {
    const a = need(req, 'jobs');
    const b = await body(req, z.object({ reason: z.string().trim().min(2, '写一下原因').max(80) }));
    const j = db.prepare('SELECT j.*, w.owner_id FROM jobs j JOIN workspaces w ON w.id=j.ws WHERE j.id=?').get(req.params.id) as Row | undefined;
    if (!j) throw new HttpError(404, '没有这个任务');
    if (j.status === 'failed') throw new HttpError(400, '失败的任务已经自动退过点了');
    const got = growth.reward(`jobrefund:${j.id}`, j.owner_id, Math.round(j.cost), 'refund', `人工退点：${b.reason}`);
    if (!got) throw new HttpError(400, '这个任务已经人工退过了');
    audit(a, '人工退点', j.id, { points: got, reason: b.reason });
    return { points: got };
  });

  /* ---------- 管理权限 ---------- */
  r.get('/api/admin/admins', req => {
    need(req, 'admins');
    const rows = db.prepare('SELECT email, role, note, created_at AS createdAt, created_by AS createdBy FROM admins ORDER BY created_at').all() as Row[];
    return { supers: d.adminEmails, admins: rows, roles: ROLES };
  });
  r.post('/api/admin/admins', async req => {
    const a = need(req, 'admins');
    const b = await body(req, z.object({ email: z.string().trim().toLowerCase().email('邮箱不对'), role: z.enum(['super', 'ops', 'finance', 'tech', 'cs']), note: z.string().max(40).default('') }));
    if (d.adminEmails.includes(b.email)) throw new HttpError(400, '这个邮箱是服务器配置的超级管理员，不用加');
    db.prepare('INSERT INTO admins (email, role, note, created_at, created_by) VALUES (?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET role=excluded.role, note=excluded.note').run(b.email, b.role, b.note, now(), a.email);
    audit(a, '设置后台账号', b.email, { role: b.role as AdminRole });
    return { ok: true };
  });
  r.delete('/api/admin/admins/:email', req => {
    const a = need(req, 'admins'), email = req.params.email.toLowerCase();
    if (email === a.email) throw new HttpError(400, '不能删自己');
    db.prepare('DELETE FROM admins WHERE email=?').run(email);
    audit(a, '删除后台账号', email);
    return { ok: true };
  });

  /* ---------- 操作日志 ---------- */
  r.get('/api/admin/audit', req => {
    need(req, 'audit');
    const q = String(req.query.get('q') ?? '').trim();
    const rows = q
      ? db.prepare('SELECT * FROM audit_log WHERE actor LIKE ? OR action LIKE ? OR target LIKE ? ORDER BY id DESC LIMIT 300').all(`%${q}%`, `%${q}%`, `%${q}%`)
      : db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300').all();
    return { items: (rows as Row[]).map(x => ({ id: x.id, actor: x.actor, action: x.action, target: x.target, detail: x.detail, createdAt: x.created_at })) };
  });

  return { need, audit };
}
