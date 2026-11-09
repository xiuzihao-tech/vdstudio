// 前端 API 客户端：所有请求都走这里，错误统一抛 ApiError（message 是可直接给用户看的中文）。
import type { DiagQuestion, DiagReport, Diagnosis, KbItem } from '../shared/kb.ts';
import type { ModState, ModView, ModuleConfig, ModuleDef, Preset } from '../shared/modules.ts';
import type { SlotMetrics, Asset, CopyDraft, GenIssue, GenSettings, Job, Persona, PersonaId, Plan, PlannedShot, Positioning, SlotView, Topic, VideoModel, Workspace } from '../shared/types.ts';
import type { CopyCheck, Rewrite } from '../shared/copy.ts';
import { API_BASE, CREDENTIALS } from './config.ts';
import type { MakeDraft, StudioState } from '../shared/studio.ts';
import type { BillingConfig, Order, PayChannel, Product } from '../shared/billing.ts';
import type { AdminMe, AdminRole, AdminPerm } from '../shared/admin.ts';
import type { SkillCategory, SkillData, SkillView, UpstreamField, UpstreamStatus, SkillStats } from '../shared/skills.ts';
import type { LedgerItem, LedgerKind } from '../shared/points.ts';
import type { Catalog, DiagMsg, DiagResult, Mat, Shot, VType } from '../shared/studio.ts';

export interface AiStatus {
  copy: { kind: 'mock' | 'llm'; baseUrl?: string; model?: string; envModel?: string; fineModel?: string; fallbacks?: string[] };
  video: { kind: 'mock' | 'seedance' | 'newapi'; baseUrl?: string; models?: Record<string, string> };
}
export interface ModelList { ok: boolean; error: string | null; models: string[] }

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function call<T>(method: string, path: string, data?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const isRaw = data instanceof Blob || data instanceof ArrayBuffer;
  const res = await fetch(API_BASE + path, {
    method, credentials: CREDENTIALS,
    headers: isRaw ? headers : { 'content-type': 'application/json', ...headers },
    body: data === undefined ? undefined : isRaw ? (data as BodyInit) : JSON.stringify(data),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* 非 JSON */ }
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `请求失败（${res.status}）`);
  return json as T;
}

export interface Session { user: { email: string; name: string } | null; isAdmin: boolean; authRequired: boolean; inviteRequired: boolean; limits: { dailyJobs: number; jobsToday: number; genPaused: boolean }; ai: { copy: 'mock' | 'llm'; video: 'mock' | 'seedance' | 'newapi'; tts: 'mock' | 'minimax' | 'none'; vision: 'llm' | 'none'; /** 素材图能否当首帧发给视频服务 */ firstFrame?: boolean }; workspace: Workspace; persona: Persona; personas: { id: PersonaId; n: string }[]; models: VideoModel[]; today: string;
  /** 模块开关：每个模块对这个用户是能用 / 预告 / 看不到 */
  modules: Record<string, ModView>; modulePro: string[];
  storage: { retentionDays: number; capacityMb: number; usedBytes: number };
  /** 后台账号（没有 = 不是后台账号） */
  admin: AdminMe | null;
  /** 技能中心里的目录：成片类型和价格、样片、积分口径、数字人、诊断和发布包装的参数（后台改了马上生效） */
  catalog: ServerCatalog }
export interface ServerCatalog extends Catalog {
  diag: { stages: string[]; welcome: string; minAnswers: number; demoName: string; demoAnswers: string[]; sample: DiagResult };
  pack: { tagMin: number; tagMax: number; titleMax: number; banned: string[] };
}

/* ---------- 后台（dazheip 后台同款）返回的数据 ---------- */
export interface AdminMenu { id: string; n: string; url: string }
export interface AdminDashboard {
  days: number;
  tiles: { users: number; usersNew: number; payers: number; orders: number; revenue: number; revenuePeriod: number; jobs: number; finals: number; failed: number; spent: number;
    issuedPaid: number; issuedGift: number; balance: number; referrals: number; diagUnlocks: number; skills: number; skillsEdited: number; upstreams: number; upstreamsOn: number; feedbackNew: number };
  coverage: { name: string; n: number; final: number; sample: number; failed: number; cost: number }[];
  typePrices: { id: string; n: string; pts: number; sample: number; secs: number; enabled: boolean }[];
  trend: { day: string; users: number; jobs: number; amount: number }[];
  ai: { copy: string; video: string; tts: string; vision: string }; pay: { channels: string[]; mock: boolean };
}
export interface SkillRun { out: any; path: 'llm' | 'rule'; ms: number; error?: string; prompt?: { system: string; user: string; missing: string[] }; raw?: string; model?: string }
export interface SkillCall { path: string; ok: number; ms: number; error: string | null; createdAt: string }
export interface UpstreamView { id: string; name: string; summary: string; doc: string; fields: UpstreamField[]; status: UpstreamStatus; meta: { updatedAt: string | null; by: string | null }; stats: SkillStats }
export interface AiInfo { copy: string; video: string; tts: string; vision: string }
export interface PointsAdmin {
  days: number; byKind: { kind: LedgerKind; name: string; sum: number; n: number }[]; kinds: Record<LedgerKind, string>;
  ledger: { delta: number; reason: string; kind: LedgerKind; createdAt: string; email: string | null; name: string | null }[];
  balance: number; config: PointsConfig; version: number;
  types: { id: string; n: string; pts: number; secs: number; sample: number; enabled: boolean }[];
}
export interface PointsConfig { pointName: string; secondsPerPoint: number; sampleRate: number; sampleMin: number; minCost: number; initialPoints: number | null; signupBonus: number; lowBalance: number; diagPrice: number; orderTtlMin: number; packages: { id: string; n: string; price: number; points: number; bonus: number; tag?: string }[] }
export interface ReferralConfig {
  enabled: boolean;
  invite: { inviterPoints: number; inviteePoints: number; rewardOn: 'register' | 'first_gen' | 'first_pay'; dailyCap: number; monthlyCap: number; ipDailyLimit: number };
  rebate: { rate: number; scope: 'first' | 'all'; days: number; capPerInvitee: number };
  firstRecharge: { fixed: number; rate: number };
  shareDaily: number; shareTitle: string; shareText: string; rules: string[];
}
export type RefStatus = 'pending' | 'rewarded' | 'capped' | 'blocked' | 'revoked';
export interface ReferralRow { id: string; code: string; inviter: string | null; inviterName: string | null; invitee: string | null; inviteeName: string | null; ip: string | null; status: RefStatus; statusName: string; note: string; createdAt: string; activatedAt: string | null; paid: number; inviterPoints: number; inviteePoints: number }
export interface ReferralAdmin {
  stats: { clicks: number; registrations: number; rewarded: number; payers: number; payAmount: number; points: Record<string, number>; top: { email: string | null; name: string | null; n: number; ok: number; earned: number }[] };
  days: number; list: ReferralRow[]; config: ReferralConfig; version: number; rules: string[];
}
export interface MyReferral {
  code: string; clicks: number; earned: number; enabled: boolean; invited: number; rewarded: number; recharged: number;
  cfg: { inviter: number; invitee: number; rate: number; days: number; rewardOn: 'register' | 'first_gen' | 'first_pay'; shareTitle: string; shareText: string; shareDaily: number; rules: string[] };
  records: { who: string; email: string; createdAt: string; status: RefStatus; statusName: string; paid: boolean; points: number }[];
}
export interface AdminJob { id: string; kind: string; status: string; cost: number; title: string; error: string | null; createdAt: string; updatedAt: string; email: string; type: string; model: string; draft: boolean; len: number; manualRefund: boolean }
export interface AuditItem { id: number; actor: string; action: string; target: string; detail: string | null; createdAt: string }
export interface ModuleUsage { opens: number; users: number; done: number | null }
export interface StorageInfo { retentionDays: number; capacityMb: number; usedBytes: number; expiring: { kind: 'asset' | 'video'; id: string; name: string; url: string | null; expiresAt: string; daysLeft: number }[] }
export type EmptyDay = { date: string; empty: true; weekday: string; label: string };
export type DayView = SlotView | EmptyDay;
export interface PlanBundle { plan: Plan; slots: DayView[] }
export interface TopicList { topics: Topic[]; scheduled: Record<string, string> }
export interface TopicFilter { cat: number | 'all'; dir: string; type: number | '不限'; heat: number | '不限'; period: number | '不限' }

export interface AdminOverview {
  since: string; funnel: { label: string; owners: number }[]; daily: { day: string; active: number; gens: number; drafts: number }[];
  jobs: { status: string; n: number; cost: number }[]; totals: { users: number; newUsers: number; feedbackNew: number; spentToday: number };
  events: { name: string; n: number }[]; settings: { genPaused: boolean };
  config: { inviteRequired: boolean; authRequired: boolean; initialPoints: number; dailyJobsPerUser: number; dailyBudget: number }; ai: Session['ai'];
}
export interface AdminUser { id: string; email: string; name: string; invite: string | null; createdAt: string; balance: number; jobs: number; spent: number; lastActive: string | null }
export interface Invite { code: string; note: string; maxUses: number; used: number; createdAt: string }
export interface Feedback { id: string; page: string; text: string; contact: string; status: string; createdAt: string; email: string | null; name: string | null }

const qs = (o: Record<string, unknown>) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  session: () => call<Session>('GET', '/api/session'),
  register: (email: string, password: string, name: string, invite?: string, ref?: string) => call<{ user: { email: string; name: string }; message: string; gift: number }>('POST', '/api/auth/register', { email, password, name, invite: invite || undefined, ref: ref || undefined }),
  authConfig: () => call<{ authRequired: boolean; inviteRequired: boolean; demoLogin?: { email: string; password: string } }>('GET', '/api/auth/config'),
  /** 后台登录：只有后台账号能登进去 */
  adminLogin: (email: string, password: string) => call<{ me: AdminMe }>('POST', '/api/auth/admin-login', { email, password }),
  track: (name: string, props?: Record<string, string | number | boolean>) => call<{ ok: true }>('POST', '/api/events', { name, props }).catch(() => undefined),
  feedback: (text: string, page: string, contact: string) => call<{ ok: true }>('POST', '/api/feedback', { text, page, contact }),
  admin: {
    overview: (days: number) => call<AdminOverview>('GET', `/api/admin/overview?days=${days}`),
    users: () => call<{ users: AdminUser[] }>('GET', '/api/admin/users'),
    addPoints: (id: string, delta: number) => call<{ users: AdminUser[] }>('POST', `/api/admin/users/${id}/points`, { delta }),
    invites: () => call<{ invites: Invite[] }>('GET', '/api/admin/invites'),
    createInvites: (count: number, maxUses: number, note: string) => call<{ codes: string[]; invites: Invite[] }>('POST', '/api/admin/invites', { count, maxUses, note }),
    feedback: () => call<{ feedback: Feedback[] }>('GET', '/api/admin/feedback'),
    setFeedback: (id: string, status: string) => call<{ feedback: Feedback[] }>('POST', `/api/admin/feedback/${id}`, { status }),
    ai: () => call<{ status: AiStatus; tiers: { id: string; n: string; d?: string }[] }>('GET', '/api/admin/ai'),
    aiModels: () => call<{ llm: ModelList; video: ModelList }>('POST', '/api/admin/ai/models'),
    aiSave: (p: { llmModel?: string | null; llmModelFine?: string | null; llmFallbacks?: string[]; videoModels?: Record<string, string> }) => call<{ status: AiStatus }>('PUT', '/api/admin/ai', p),
    aiTest: () => call<{ ok: boolean; ms: number; model: string; reply: string | null; error: string | null }>('POST', '/api/admin/ai/test'),
    redeemCodes: () => call<{ codes: { code: string; points: number; maxUses: number; used: number; note: string; createdAt: string }[] }>('GET', '/api/admin/redeem'),
    createRedeem: (count: number, points: number, maxUses: number, note: string) => call<{ codes: string[] }>('POST', '/api/admin/redeem', { count, points, maxUses, note }),
    modules: () => call<{ modules: ModuleDef[]; presets: Record<Preset, string>; config: ModuleConfig; usage: Record<string, ModuleUsage> }>('GET', '/api/admin/modules'),
    saveModules: (p: Partial<Omit<ModuleConfig, 'states'>> & { states?: Record<string, ModState>; withParents?: boolean }) => call<{ config: ModuleConfig; warn: { id: string; parents: string[] }[] }>('PUT', '/api/admin/modules', p),
    billing: () => call<{ config: BillingConfig; channels: PayChannel[]; mock: boolean; orders: (Order & { email: string | null; name: string | null })[]; today: { n: number; amount: number; points: number }; month: { n: number; amount: number; points: number } }>('GET', '/api/admin/billing'),
    saveBilling: (c: BillingConfig) => call<{ config: BillingConfig }>('PUT', '/api/admin/billing', c),
    refundOrder: (id: string) => call<{ ok: true; note: string }>('POST', `/api/admin/billing/orders/${id}/refund`),
    setPaused: (genPaused: boolean) => call<{ settings: { genPaused: boolean } }>('PUT', '/api/admin/settings', { genPaused }),

    /* ---------- 新后台：数据总览、技能中心、上游接口、积分、邀请、任务、后台账号、日志 ---------- */
    me: () => call<{ me: AdminMe; roles: Record<AdminRole, { n: string; d: string; perms: AdminPerm[] }>; dazheip: { base: string; menu: AdminMenu[] } }>('GET', '/api/admin/me'),
    dashboard: (days = 30) => call<AdminDashboard>('GET', `/api/admin/dashboard?days=${days}`),
    skills: () => call<{ skills: SkillView[]; categories: Record<SkillCategory, string> }>('GET', '/api/admin/skills'),
    skill: (id: string) => call<{ skill: SkillView; calls: SkillCall[] }>('GET', `/api/admin/skills/${id}`),
    skillVersion: (id: string, v: number) => call<{ data: SkillData }>('GET', `/api/admin/skills/${id}/versions/${v}`),
    saveSkill: (id: string, data: SkillData, note: string) => call<{ skill: SkillView; version: number }>('PUT', `/api/admin/skills/${id}`, { data, note }),
    activateSkill: (id: string, version: number) => call<{ skill: SkillView }>('POST', `/api/admin/skills/${id}/activate`, { version }),
    enableSkill: (id: string, enabled: boolean) => call<{ skill: SkillView }>('POST', `/api/admin/skills/${id}/enabled`, { enabled }),
    testSkill: (id: string, input: Record<string, unknown>, data?: SkillData, force?: 'llm' | 'rule') => call<SkillRun>('POST', `/api/admin/skills/${id}/test`, { input, data, force }),
    exportSkill: async (id: string) => {
      const res = await fetch(`${API_BASE}/api/admin/skills/${id}/export`, { credentials: CREDENTIALS });
      if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.error ?? `导出失败（${res.status}）`);
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `${id}.json`;
      return { name, blob: await res.blob() };
    },
    upstreams: () => call<{ upstreams: UpstreamView[]; videoProvider: string; ai: AiInfo; pay: { channels: string[]; mock: boolean }; videoStats: SkillStats }>('GET', '/api/admin/upstreams'),
    saveUpstream: (id: string, p: { enabled?: boolean; values?: Record<string, string | null> }) => call<{ upstreams: UpstreamView[]; ai: AiInfo; pay: { channels: string[]; mock: boolean } }>('PUT', `/api/admin/upstreams/${id}`, p),
    testUpstream: (id: string, values: Record<string, string>) => call<{ ok: boolean; ms: number; message: string }>('POST', `/api/admin/upstreams/${id}/test`, { values }),
    upstreamModels: (id: string) => call<{ models: string[] }>('POST', `/api/admin/upstreams/${id}/models`, {}),
    setVideoProvider: (provider: string) => call<{ videoProvider: string; ai: AiInfo }>('PUT', '/api/admin/upstreams/video-provider', { provider }),
    points: (q: { days?: number; q?: string; kind?: string } = {}) => call<PointsAdmin>('GET', `/api/admin/points?${qs({ days: q.days ?? 30, q: q.q ?? '', kind: q.kind ?? '' })}`),
    savePoints: (config: Partial<PointsConfig>, note = '') => call<{ config: PointsConfig }>('PUT', '/api/admin/points', { config, note }),
    saveTypes: (types: { id: string; pts: number; secs: number; enabled: boolean }[]) => call<{ types: PointsAdmin['types'] }>('PUT', '/api/admin/points/types', { types }),
    adjust: (email: string, delta: number, reason: string) => call<{ delta: number; balance: number }>('POST', '/api/admin/points/adjust', { email, delta, reason }),
    referral: (q: { days?: number; status?: string; q?: string } = {}) => call<ReferralAdmin>('GET', `/api/admin/referral?${qs({ days: q.days ?? 30, status: q.status ?? '', q: q.q ?? '' })}`),
    saveReferral: (config: Partial<ReferralConfig>, note = '') => call<{ config: ReferralConfig; rules: string[] }>('PUT', '/api/admin/referral', { config, note }),
    revokeReferral: (id: string, note: string) => call<{ back: number }>('POST', `/api/admin/referral/${id}/revoke`, { note }),
    jobs: (q: { status?: string; q?: string } = {}) => call<{ jobs: AdminJob[]; counts: Record<string, number> }>('GET', `/api/admin/jobs?${qs({ status: q.status ?? '', q: q.q ?? '' })}`),
    refundJob: (id: string, reason: string) => call<{ points: number }>('POST', `/api/admin/jobs/${id}/refund`, { reason }),
    admins: () => call<{ supers: string[]; admins: { email: string; role: AdminRole; note: string; createdAt: string; createdBy: string }[]; roles: Record<AdminRole, { n: string; d: string; perms: AdminPerm[] }> }>('GET', '/api/admin/admins'),
    addAdmin: (email: string, role: AdminRole, note: string) => call<{ ok: true }>('POST', '/api/admin/admins', { email, role, note }),
    removeAdmin: (email: string) => call<{ ok: true }>('DELETE', `/api/admin/admins/${encodeURIComponent(email)}`),
    audit: (q = '') => call<{ items: AuditItem[] }>('GET', `/api/admin/audit?${qs({ q })}`),
  },
  /** 一键生成视频 / 诊断的 AI 技能（服务端按技能中心的提示词和规则出；接了大模型走模型） */
  studioAi: {
    advise: (mats: Pick<Mat, 'kind' | 'name'>[], copy: string, pick: VType | 'auto') => call<{ advice: { type: VType; why: string; [k: string]: unknown }; path: 'llm' | 'rule' }>('POST', '/api/studio/advise', { mats: mats.slice(0, 40).map(m => ({ kind: m.kind, name: m.name.slice(0, 120) })), copy: copy.slice(0, 4000), pick }),
    storyboard: (mats: Mat[], copy: string, type: VType, face: 'avatar' | 'none', target?: number) => call<{ shots: Shot[]; path: 'llm' | 'rule' }>('POST', '/api/studio/storyboard', { mats: mats.slice(0, 40).map(m => ({ id: m.id.slice(0, 40), name: m.name.slice(0, 120), kind: m.kind, k: m.k.slice(0, 20) })), copy: copy.slice(0, 4000), type, face, target: target ? Math.max(3, Math.min(600, Math.round(target))) : undefined }),
    pack: (type: VType, lines: string[], city?: string) => call<{ title: string; caption: string; tags: [string, string[]][]; pick: string[]; banned: string[]; tagMin: number; tagMax: number; titleMax: number; path: 'llm' | 'rule' }>('POST', '/api/studio/pack', { type, lines: lines.slice(0, 20).map(l => l.slice(0, 300)), city }),
    diagNext: (msgs: DiagMsg[], asked: number) => call<{ msg: DiagMsg & { done?: boolean }; path: 'llm' | 'rule' }>('POST', '/api/studio/diag/next', { msgs: msgs.slice(-400).map(m => ({ ...m, text: m.text.slice(0, 2000) })), asked: Math.min(400, asked) }),
    diagReport: (answers: string[], name?: string) => call<{ result: DiagResult; path: 'llm' | 'rule' }>('POST', '/api/studio/diag/report', { answers: answers.slice(-200).map(a => a.slice(0, 2000)), name: name?.slice(0, 20) }),
    diagTopics: (r: DiagResult, counts: number[]) => {
      // 用户能改栏目名、标签：按服务端的长度上限截一下，免得多打几个字就整个请求被拒
      const cut = (x: unknown, n: number) => String(x ?? '').slice(0, n);
      const result = { who: cut(r.who, 20), tags: { personal: r.tags.personal.map(t => cut(t, 30)), pro: r.tags.pro.map(t => cut(t, 40)), brand: r.tags.brand.map(t => cut(t, 60)) },
        columns: r.columns.slice(0, 8).map(c => ({ n: cut(c.n, 20), d: cut(c.d, 200), eg: cut(c.eg, 80), freq: Math.max(1, Math.min(7, Math.round(c.freq) || 1)), src: cut(c.src, 60), type: c.type, ask: cut(c.ask, 80), unit: cut(c.unit, 6) })) };
      return call<{ topics: { title: string; column: string; type: VType; why: string }[]; path: 'llm' | 'rule'; schedule: { weekdays: number[]; time: string } }>('POST', '/api/studio/diag/topics', { result, counts: counts.slice(0, 8).map(n => Math.max(0, Math.min(99, Math.round(n)))) });
    },
  },
  /** 邀请有礼 */
  referral: {
    mine: () => call<({ needLogin: true }) | ({ needLogin: false } & MyReferral)>('GET', '/api/referral'),
    click: (code: string) => call<{ ok: boolean }>('POST', '/api/referral/click', { code }),
    preview: (code: string) => call<{ preview: { name: string; bonus: number } | null }>('GET', `/api/referral/preview?code=${encodeURIComponent(code)}`),
    share: () => call<{ points: number }>('POST', '/api/referral/share'),
  },
  login: (email: string, password: string) => call<{ user: { email: string; name: string }; message: string }>('POST', '/api/auth/login', { email, password }),
  logout: () => call<{ ok: true }>('POST', '/api/auth/logout'),
  switchPersona: (persona: PersonaId) => call<Session>('POST', '/api/session/persona', { persona }),
  savePositioning: (p: Positioning) => call<Session>('PUT', '/api/workspace/positioning', p),
  setTheme: (theme: string) => call<{ ok: true }>('PUT', '/api/workspace/theme', { theme }),

  topics: (f: TopicFilter) => call<TopicList>('GET', `/api/topics?${qs(f as unknown as Record<string, unknown>)}`),
  allTopics: () => call<TopicList>('GET', '/api/topics/all'),
  addTopic: (t: Partial<Topic> & { title: string }) => call<Topic>('POST', '/api/topics', t),
  fav: (id: string, fav: boolean) => call<Topic>('POST', `/api/topics/${id}/fav`, { fav }),
  angles: (id: string) => call<{ angles: { label: string; title: string }[] }>('GET', `/api/topics/${id}/angles`),
  fromCase: (text: string, imageKeys: string[]) => call<{ topics: Topic[] }>('POST', '/api/topics/from-case', { text, imageKeys }),
  benchmark: (url: string, learn: string[]) => call<{ platform: string; rows: [string, string][]; topic: Omit<Topic, 'id' | 'cat' | 'ageMonths' | 'source' | 'fav' | 'createdAt'> }>('POST', '/api/topics/benchmark', { url, learn }),
  fromMaterials: (assetIds: string[], note: string) => call<Topic>('POST', '/api/topics/from-materials', { assetIds, note }),

  genCopy: (topicId: string, o: { kind?: string; len?: number; tone?: string; version?: number; quality?: 'fast' | 'fine' }) => call<{ draft: CopyDraft; check: CopyCheck }>('POST', '/api/copy/generate', { topicId, ...o }),
  rewrite: (draft: CopyDraft, how: Rewrite) => call<{ draft: CopyDraft; changed: number; check: CopyCheck }>('POST', '/api/copy/rewrite', { draft, how }),
  drafts: () => call<{ drafts: CopyDraft[] }>('GET', '/api/drafts'),
  draft: (topicId: string) => call<{ draft: CopyDraft | null }>('GET', `/api/drafts/${topicId}`),
  saveDraft: (d: CopyDraft) => call<CopyDraft>('PUT', '/api/drafts', d),

  banned: (text: string) => call<{ hits: [string, string][] }>('POST', '/api/tools/banned', { text }),
  humanize: (text: string) => call<{ text: string }>('POST', '/api/tools/humanize', { text }),
  transcribe: (kind: 'audio' | 'video', ref: string) => call<{ text: string }>('POST', '/api/tools/transcribe', { kind, ref }),
  cloneVoice: (sample: Blob, demo: boolean) => call<{ voiceClone: string }>('POST', '/api/voice/clone', sample, { 'content-type': sample.type || 'audio/webm', 'x-consent': 'yes', ...(demo ? { 'x-sample': 'demo' } : {}) }),

  assets: () => call<{ assets: Asset[] }>('GET', '/api/assets'),
  storage: () => call<StorageInfo>('GET', '/api/storage'),
  upload: (f: File, source = '上传') => call<Asset>('POST', '/api/assets', f, { 'content-type': f.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(f.name), 'x-source': encodeURIComponent(source) }),
  deleteAsset: (id: string) => call<{ ok: true }>('DELETE', `/api/assets/${id}`),

  kb: () => call<{ items: KbItem[] }>('GET', '/api/kb'),
  addKb: (k: Pick<KbItem, 'section' | 'kind' | 'text'> & { tags?: string[] }) => call<{ items: KbItem[] }>('POST', '/api/kb', k),
  updateKb: (id: string, k: Partial<Pick<KbItem, 'section' | 'kind' | 'text' | 'tags'>>) => call<{ items: KbItem[] }>('PUT', `/api/kb/${id}`, k),
  deleteKb: (id: string) => call<{ items: KbItem[] }>('DELETE', `/api/kb/${id}`),
  diagnosis: () => call<{ diagnosis: Diagnosis; questions: DiagQuestion[]; price: number }>('GET', '/api/diagnosis'),
  /** 面诊传资料：主页链接，或截图 / 介绍资料文件 */
  diagAttach: (x: { url: string; note?: string } | File) => x instanceof File
    ? call<{ items: KbItem[] }>('POST', '/api/diagnosis/attach', x, { 'content-type': x.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(x.name) })
    : call<{ items: KbItem[] }>('POST', '/api/diagnosis/attach', x),
  diagAttachments: () => call<{ items: KbItem[] }>('GET', '/api/diagnosis/attach'),
  /** 知识库资料导入：一个链接，或一份文件（文字文件按段拆成几条） */
  kbImport: (x: { url: string; note?: string; section?: string } | File, section = 'pro') => x instanceof File
    ? call<{ added: number; items: KbItem[] }>('POST', '/api/kb/import', x, { 'content-type': x.type || 'text/plain', 'x-file-name': encodeURIComponent(x.name), 'x-section': section })
    : call<{ added: number; items: KbItem[] }>('POST', '/api/kb/import', { section, ...x }),
  unlock: () => call<{ diagnosis: Diagnosis }>('POST', '/api/diagnosis/unlock'),
  answer: (qid: string, text: string) => call<{ diagnosis: Diagnosis }>('PUT', '/api/diagnosis/answer', { qid, text }),
  makeReport: () => call<{ diagnosis: Diagnosis }>('POST', '/api/diagnosis/report'),
  editReport: (p: Partial<Pick<DiagReport, 'tags' | 'columns'>>) => call<{ diagnosis: Diagnosis }>('PUT', '/api/diagnosis/report', p),
  writeCopy: (o: { idea?: string; topicId?: string; len?: number; kb?: boolean; column?: string; style?: string }) => call<{ draft: CopyDraft; used: { id: string; kind: string; text: string }[]; cliches: string[]; column: string | null }>('POST', '/api/copy/write', o),
  footage: (assetIds: string[], idea: string, style?: string) => call<{ title: string; lines: string[]; assets: { id: string; note: string; noteSrc: string; dur: number | null; best: [number, number] | null }[]; used: { id: string; kind: string; text: string }[] }>('POST', '/api/gen/footage', { assetIds, idea, style }),
  addSamples: () => call<{ added: number }>('POST', '/api/assets/samples'),
  genVoice: (lines: string[], speed: number, voice: string) => call<{ provider: string; secs: number[] }>('POST', '/api/gen/voice', { lines, speed, voice }),
  createAvatar: (kind: 'clone' | 'photo', file: Blob | null) => call<{ avatars: Workspace['avatars'] }>('POST', '/api/avatars', file ?? new Blob(['demo']), { 'content-type': file?.type || 'application/octet-stream', 'x-kind': kind, 'x-consent': 'yes', ...(file ? {} : { 'x-sample': 'demo' }) }),
  deleteAvatar: (kind: 'clone' | 'photo') => call<{ avatars: Workspace['avatars'] }>('DELETE', `/api/avatars/${kind}`),
  ledger: () => call<{ items: LedgerItem[] }>('GET', '/api/ledger'),
  redeem: (code: string) => call<{ points: number; balance: number }>('POST', '/api/points/redeem', { code }),
  genCheck: (g: GenSettings) => call<{ issues: GenIssue[]; shots: PlannedShot[]; cost: number; finalCost: number }>('POST', '/api/gen/check', g),
  generate: (settings: GenSettings, final: boolean, title: string) => call<Job>('POST', '/api/gen', { settings, final, title }),
  jobs: () => call<{ jobs: Job[] }>('GET', '/api/jobs'),
  job: (id: string) => call<Job>('GET', `/api/jobs/${id}`),

  plans: () => call<{ plans: PlanBundle[]; did?: string[] }>('GET', '/api/plans'),
  slotMetrics: (planId: string, date: string, metrics: SlotMetrics) => call<{ message: string; plans: PlanBundle[] }>('POST', `/api/plans/${planId}/slots/${date}`, { action: 'metrics', metrics }),
  addPlan: (account: string) => call<{ plans: PlanBundle[] }>('POST', '/api/plans', { account }),
  patchPlan: (id: string, p: Partial<Plan>) => call<{ plans: PlanBundle[] }>('PATCH', `/api/plans/${id}`, p),
  slot: (planId: string, date: string, action: 'approve' | 'next' | 'unpin' | 'set' | 'skip' | 'add' | 'publish' | 'unpublish', topicId?: string) =>
    call<{ message: string; plans: PlanBundle[] }>('POST', `/api/plans/${planId}/slots/${date}`, { action, topicId }),
  approveAll: (planId: string) => call<{ message: string; plans: PlanBundle[] }>('POST', `/api/plans/${planId}/approve-all`),
  reroll: (planId: string) => call<{ message: string; plans: PlanBundle[] }>('POST', `/api/plans/${planId}/reroll`),
  backlog: (planId: string, topicId: string, remove = false) => call<{ plans: PlanBundle[] }>('POST', `/api/plans/${planId}/backlog`, { topicId, remove }),
  published: () => call<{ items: { title: string; account: string; date: string }[] }>('GET', '/api/published'),

  studio: () => call<{ state: StudioState }>('GET', '/api/studio'),
  saveStudio: (p: Partial<StudioState>) => call<{ state: StudioState }>('PUT', '/api/studio', p),
  resetStudio: () => call<{ state: StudioState }>('POST', '/api/studio/reset'),
  /** Seedance 2.5 样片模式：sample 先出 480p 样片；final 出 1080p 成片（fromJob = 沿用的样片） */
  render: (draft: Pick<MakeDraft, 'type' | 'face' | 'avatar' | 'title' | 'opt' | 'mats' | 'shots'>, mode: 'sample' | 'final', fromJob?: string) => call<{ job: Job; cost: number; balance: number }>('POST', '/api/studio/render', { draft, mode, fromJob }),

  billing: () => call<BillingConfig & { channels: PayChannel[]; mock: boolean; balance: number; orders: Order[] }>('GET', '/api/billing'),
  createOrder: (product: Product, channel: PayChannel, packageId?: string) => call<{ order: Order & { qr: string | null } }>('POST', '/api/billing/orders', { product, channel, packageId }),
  order: (id: string) => call<{ order: Order & { qr: string | null }; balance: number }>('GET', `/api/billing/orders/${id}`),
  mockPay: (id: string) => call<{ order: Order; balance: number }>('POST', `/api/billing/orders/${id}/mock-pay`),

  covers: () => call<{ covers: { id: string; title: string; style: string }[] }>('GET', '/api/covers'),
  addCover: (title: string, style: string, generate: boolean) => call<{ covers: { id: string; title: string; style: string }[]; balance: number }>('POST', '/api/covers', { title, style, generate }),
};
