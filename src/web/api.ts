// 前端 API 客户端：所有请求都走这里，错误统一抛 ApiError（message 是可直接给用户看的中文）。
import type { Asset, CopyDraft, GenIssue, GenSettings, Job, Persona, PersonaId, Plan, PlannedShot, Positioning, SlotView, Topic, VideoModel, Workspace } from '../shared/types.ts';
import type { CopyCheck, Rewrite } from '../shared/copy.ts';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function call<T>(method: string, path: string, data?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const isRaw = data instanceof Blob || data instanceof ArrayBuffer;
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: isRaw ? headers : { 'content-type': 'application/json', ...headers },
    body: data === undefined ? undefined : isRaw ? (data as BodyInit) : JSON.stringify(data),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* 非 JSON */ }
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `请求失败（${res.status}）`);
  return json as T;
}

export interface Session { workspace: Workspace; persona: Persona; personas: { id: PersonaId; n: string }[]; models: VideoModel[]; today: string }
export type EmptyDay = { date: string; empty: true; weekday: string; label: string };
export type DayView = SlotView | EmptyDay;
export interface PlanBundle { plan: Plan; slots: DayView[] }
export interface TopicList { topics: Topic[]; scheduled: Record<string, string> }
export interface TopicFilter { cat: number | 'all'; dir: string; type: number | '不限'; heat: number | '不限'; period: number | '不限' }

const qs = (o: Record<string, unknown>) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  session: () => call<Session>('GET', '/api/session'),
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

  genCopy: (topicId: string, o: { kind?: string; len?: number; tone?: string; version?: number }) => call<{ draft: CopyDraft; check: CopyCheck }>('POST', '/api/copy/generate', { topicId, ...o }),
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

  genCheck: (g: GenSettings) => call<{ issues: GenIssue[]; shots: PlannedShot[]; cost: number; finalCost: number }>('POST', '/api/gen/check', g),
  generate: (settings: GenSettings, final: boolean, title: string) => call<Job>('POST', '/api/gen', { settings, final, title }),
  jobs: () => call<{ jobs: Job[] }>('GET', '/api/jobs'),
  job: (id: string) => call<Job>('GET', `/api/jobs/${id}`),

  plans: () => call<{ plans: PlanBundle[] }>('GET', '/api/plans'),
  addPlan: (account: string) => call<{ plans: PlanBundle[] }>('POST', '/api/plans', { account }),
  patchPlan: (id: string, p: Partial<Plan>) => call<{ plans: PlanBundle[] }>('PATCH', `/api/plans/${id}`, p),
  slot: (planId: string, date: string, action: 'approve' | 'next' | 'unpin' | 'set' | 'skip' | 'add', topicId?: string) =>
    call<{ message: string; plans: PlanBundle[] }>('POST', `/api/plans/${planId}/slots/${date}`, { action, topicId }),
  approveAll: (planId: string) => call<{ message: string; plans: PlanBundle[] }>('POST', `/api/plans/${planId}/approve-all`),
  reroll: (planId: string) => call<{ message: string; plans: PlanBundle[] }>('POST', `/api/plans/${planId}/reroll`),
  backlog: (planId: string, topicId: string, remove = false) => call<{ plans: PlanBundle[] }>('POST', `/api/plans/${planId}/backlog`, { topicId, remove }),
  published: () => call<{ items: { title: string; account: string; date: string }[] }>('GET', '/api/published'),

  covers: () => call<{ covers: { id: string; title: string; style: string }[] }>('GET', '/api/covers'),
  addCover: (title: string, style: string, generate: boolean) => call<{ covers: { id: string; title: string; style: string }[]; balance: number }>('POST', '/api/covers', { title, style, generate }),
};
