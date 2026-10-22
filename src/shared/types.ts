// 领域类型：前后端共用。数据库行、接口返回、页面状态都以这里为准。

export type PersonaId = 'designer' | 'deco' | 'custom' | 'material' | 'soft' | 'agent' | 'dev' | 'stay';

/** 画面占位键：原型里用 CSS 画的场景；真实素材上线后由图片 URL 取代 */
export type SceneKey = string;

export interface Business { n: string; d: string; tpl: ShotFamily; k: SceneKey; len: string }
export interface Persona {
  id: PersonaId; n: string; proj: string; acct: string; acct2: string; ph: string;
  aud: string[]; focus: string; goal: string; att: SceneKey[];
  read: [string, string][]; biz: Business[]; topics: [string, string, string][]; next: string;
}

export type ShotFamily = 'story' | 'house' | 'product' | 'site' | 'talk' | 'tour';
export interface ShotTemplate {
  t: string; d: string; v: string; dur: number; fr: string; an: string; mv: string; cp: string; md: string; src: string; k?: SceneKey; b?: SceneKey;
}

export interface VideoModel {
  id: string; n: string; d: string; min: number; max: number; res: string[];
  draft: boolean; pd: number; pf: number; off?: boolean;
}

/* ---------- IP 与选题 ---------- */
export type TopicSource = 'hot' | 'case' | 'ai' | 'bench' | 'mat' | 'plan' | 'angle' | 'tool';
export interface Positioning {
  name: string; line: string; aud: string[]; pillars: string[];
  tone: Tone; tags: string[];
}
export type Tone = '亲切' | '专业' | '犀利' | '幽默';

export interface Topic {
  id: string; cat: number; title: string; hook: string; why: string;
  dir: string; type: 0 | 1 | 2; heat: 1 | 2 | 3; k: SceneKey;
  ageMonths: number; source: TopicSource; fav: boolean; createdAt: string;
}

export type CopyKind = '口播' | '图文笔记' | '分镜脚本';
export type CopyLen = 30 | 45 | 60 | 90;
export interface CopyDraft {
  id: string; topicId: string; kind: CopyKind; len: CopyLen; tone: Tone;
  titles: string[]; title: string; hooks: string[]; hook: string;
  body: string[]; shots: string[]; cta: string; tags: string[];
  live: number; version: number; assetIds: string[]; updatedAt: string;
}

/* ---------- 素材 ---------- */
export type AssetType = '照片' | '视频' | '人物' | '音频';
export interface Asset {
  id: string; type: AssetType; name: string; k: SceneKey;
  url: string | null; mime: string | null; size: number; used: number; source: string; createdAt: string;
}

/* ---------- 生成 ---------- */
export type Ratio = '9:16' | '16:9' | '1:1' | '3:4';
export type Resolution = '480p' | '720p' | '1080p' | '4K';
export type VoiceId = 'me' | 'p1' | 'p2' | 'p3' | 'none';
export interface GenSettings {
  copy: string; prompt: string; title: string; topicId: string | null; assetIds: string[];
  model: string; len: number; ratio: Ratio; res: Resolution; draft: boolean;
  voice: VoiceId; speed: number; bgm: string; subs: boolean; ambience: boolean; cover: boolean; style: string;
}
export interface PlannedShot { dur: number; line: string; k: SceneKey; generated: boolean; /** 真实视频服务生成后回填 */ videoUrl?: string | null }

export type IssueCode = 'model_off' | 'res_unsupported' | 'no_copy' | 'copy_too_long' | 'voice_missing' | 'voice_busy' | 'no_assets';
export interface GenIssue { code: IssueCode; blocking: boolean; text: string; fixes: { id: string; label: string }[] }

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export interface Job {
  id: string; kind: 'video' | 'video_final' | 'cover' | 'voice_clone';
  status: JobStatus; step: number; steps: string[]; cost: number; title: string;
  input: GenSettings | Record<string, unknown>; output: VideoOutput | Record<string, unknown> | null;
  error: string | null; createdAt: string; updatedAt: string;
}
export interface VideoOutput { draft: boolean; shots: PlannedShot[]; title: string; res: string; ratio: string; len: number; model: string; voice: string; /** 合成好的整条视频（存在自己的存储） */ videoUrl?: string; composeError?: string }

/* ---------- 排期 ---------- */
export interface Plan {
  id: string; account: string; weekdays: number[]; hour: number; needOk: boolean; budget: number; running: boolean;
  mix: { n: string; v: number }[]; added: string[]; skipped: string[]; backlog: string[];
}
export type SlotPin = 'cand' | 'fixed';
export interface Slot { planId: string; date: string; topicId: string; pin: SlotPin; why: string; column: string }
export type SlotState = 'done' | 'review' | 'gen' | 'plan' | 'cand' | 'paused' | 'gap';
export interface SlotView extends Slot { state: SlotState; topic: Topic; weekday: string; label: string }

/* ---------- 工作区 ---------- */
export type VoiceCloneState = 'none' | 'busy' | 'ready';
export interface Workspace {
  id: string; persona: PersonaId; positioning: Positioning; balance: number; voiceClone: VoiceCloneState; theme: string;
}
