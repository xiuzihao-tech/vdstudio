// 前端 API 客户端：所有请求都走这里，错误统一抛 ApiError（message 是可直接给用户看的中文）。
import type { DiagQuestion, DiagReport, Diagnosis, KbItem } from '../shared/kb.ts';
import type { SlotMetrics, Asset, CopyDraft, GenIssue, GenSettings, Job, Persona, PersonaId, Plan, PlannedShot, Positioning, SlotView, Topic, VideoModel, Workspace } from '../shared/types.ts';
import type { CopyCheck, Rewrite } from '../shared/copy.ts';
import { API_BASE, CREDENTIALS } from './config.ts';

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

export interface Session { user: { email: string; name: string } | null; isAdmin: boolean; authRequired: boolean; inviteRequired: boolean; limits: { dailyJobs: number; jobsToday: number; genPaused: boolean }; ai: { copy: 'mock' | 'llm'; video: 'mock' | 'seedance' | 'newapi'; /** 素材图能否当首帧发给视频服务 */ firstFrame?: boolean }; workspace: Workspace; persona: Persona; personas: { id: PersonaId; n: string }[]; models: VideoModel[]; today: string }
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
  register: (email: string, password: string, name: string, invite?: string) => call<{ user: { email: string; name: string }; message: string }>('POST', '/api/auth/register', { email, password, name, invite: invite || undefined }),
  authConfig: () => call<{ authRequired: boolean; inviteRequired: boolean }>('GET', '/api/auth/config'),
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
    setPaused: (genPaused: boolean) => call<{ settings: { genPaused: boolean } }>('PUT', '/api/admin/settings', { genPaused }),
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
  upload: (f: File, source = '上传') => call<Asset>('POST', '/api/assets', f, { 'content-type': f.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(f.name), 'x-source': encodeURIComponent(source) }),
  deleteAsset: (id: string) => call<{ ok: true }>('DELETE', `/api/assets/${id}`),

  kb: () => call<{ items: KbItem[] }>('GET', '/api/kb'),
  addKb: (k: Pick<KbItem, 'section' | 'kind' | 'text'> & { tags?: string[] }) => call<{ items: KbItem[] }>('POST', '/api/kb', k),
  updateKb: (id: string, k: Partial<Pick<KbItem, 'section' | 'kind' | 'text' | 'tags'>>) => call<{ items: KbItem[] }>('PUT', `/api/kb/${id}`, k),
  deleteKb: (id: string) => call<{ items: KbItem[] }>('DELETE', `/api/kb/${id}`),
  diagnosis: () => call<{ diagnosis: Diagnosis; questions: DiagQuestion[]; price: number }>('GET', '/api/diagnosis'),
  unlock: () => call<{ diagnosis: Diagnosis }>('POST', '/api/diagnosis/unlock'),
  answer: (qid: string, text: string) => call<{ diagnosis: Diagnosis }>('PUT', '/api/diagnosis/answer', { qid, text }),
  makeReport: () => call<{ diagnosis: Diagnosis }>('POST', '/api/diagnosis/report'),
  editReport: (p: Partial<Pick<DiagReport, 'tags' | 'columns'>>) => call<{ diagnosis: Diagnosis }>('PUT', '/api/diagnosis/report', p),
  writeCopy: (o: { idea?: string; topicId?: string; len?: number; kb?: boolean; column?: string }) => call<{ draft: CopyDraft; used: { id: string; kind: string; text: string }[]; cliches: string[] }>('POST', '/api/copy/write', o),
  footage: (assetIds: string[], idea: string) => call<{ lines: string[]; assets: { id: string; note: string }[]; used: { id: string; kind: string; text: string }[] }>('POST', '/api/gen/footage', { assetIds, idea }),
  genVoice: (lines: string[], speed: number, voice: string) => call<{ provider: string; secs: number[] }>('POST', '/api/gen/voice', { lines, speed, voice }),
  createAvatar: (kind: 'clone' | 'photo', file: Blob | null) => call<{ avatars: Workspace['avatars'] }>('POST', '/api/avatars', file ?? new Blob(['demo']), { 'content-type': file?.type || 'application/octet-stream', 'x-kind': kind, 'x-consent': 'yes', ...(file ? {} : { 'x-sample': 'demo' }) }),
  deleteAvatar: (kind: 'clone' | 'photo') => call<{ avatars: Workspace['avatars'] }>('DELETE', `/api/avatars/${kind}`),
  ledger: () => call<{ items: { delta: number; reason: string; createdAt: string }[] }>('GET', '/api/ledger'),
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

  covers: () => call<{ covers: { id: string; title: string; style: string }[] }>('GET', '/api/covers'),
  addCover: (title: string, style: string, generate: boolean) => call<{ covers: { id: string; title: string; style: string }[]; balance: number }>('POST', '/api/covers', { title, style, generate }),
};
