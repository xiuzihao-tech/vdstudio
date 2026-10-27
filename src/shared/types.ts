// 领域类型：前后端共用。数据库行、接口返回、页面状态都以这里为准。
import type { ShotSource, ShotSpec, VideoType } from './video.ts';

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
  draft: boolean; /** 样片用的清晰度（默认 480p；土豆的样片模型最低 720p） */ draftRes?: string; pd: number; pf: number; off?: boolean;
  /** 支持的画面比例；不写表示四种都行（土豆只认 9:16 / 16:9 / 1:1） */ ratios?: string[];
}

/* ---------- IP 与选题 ---------- */
export type TopicSource = 'hot' | 'case' | 'ai' | 'bench' | 'mat' | 'plan' | 'angle' | 'tool';
export interface Positioning {
  name: string; line: string; aud: string[]; pillars: string[];
  tone: Tone; tags: string[];
  /** 人设档案：转化目标、发哪些平台（新手引导里填） */
  goal?: string; platforms?: string[];
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
  /** 视频类型（第 1 步）；老数据没有 = 按旧规则平均拆镜 */
  type?: VideoType;
  /** 数字人：none 不出镜；clone 真人分身；photo 照片形象 */
  avatar?: AvatarMode;
  emotion?: string; pause?: number; bgmVol?: number; seed?: boolean;
  /** 第 3 步确认过的分镜；有就严格按它生成（每镜的时长、来源、首帧、描述、景别运镜都下发） */
  shots?: ShotSpec[];
  /** 沿用上一版的镜头（单镜重做、换配音时）：下标 → 已有的视频地址 */
  reuse?: (string | null)[];
  /** music = 只换音乐：配音和画面都沿用，不收配音费 */
  remix?: 'music';
}
export type AvatarMode = 'none' | 'clone' | 'photo';
export interface PlannedShot {
  dur: number; line: string; k: SceneKey; generated: boolean;
  /** 真实视频服务生成后回填（转存后是本站 /files 地址） */ videoUrl?: string | null;
  /** 中转站原始链接（会过期，仅留档） */ sourceUrl?: string;
  /** 第 3 步的逐镜参数（新链路才有） */
  source?: ShotSource; assetId?: string | null; prompt?: string; size?: string; move?: string; model?: string; trans?: string;
  /** 这一镜沿用上一版、不重新生成 */ reused?: boolean;
  /** 这一镜生成失败（其余镜照常出片，这一镜的点数已退） */ failed?: string;
}

export type IssueCode = 'model_off' | 'res_unsupported' | 'ratio_unsupported' | 'no_copy' | 'copy_too_long' | 'voice_missing' | 'voice_busy' | 'no_assets' | 'frame_unusable' | 'avatar_missing' | 'avatar_busy';
export interface GenIssue { code: IssueCode; blocking: boolean; text: string; fixes: { id: string; label: string }[] }

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export interface Job {
  id: string; kind: 'video' | 'video_final' | 'cover' | 'voice_clone';
  status: JobStatus; step: number; steps: string[]; cost: number; title: string;
  input: GenSettings | Record<string, unknown>; output: VideoOutput | Record<string, unknown> | null;
  error: string | null; createdAt: string; updatedAt: string;
}
/** 生成任务在视频服务那边的记录：每镜的任务 ID（没提交为 null）和当时的分镜，重启后靠它接着查 */
export interface JobExternal { tasks: (string | null)[]; shots: PlannedShot[]; final: boolean }
export interface VideoOutput { /** 有镜头失败、其余照常出片 */ partial?: boolean; type?: string; draft: boolean; shots: PlannedShot[]; title: string; res: string; ratio: string; len: number; model: string; voice: string; /** 合成好的整条视频（存在自己的存储） */ videoUrl?: string; composeError?: string }

/* ---------- 排期 ---------- */
/** 托管程度：plan 只排计划；copy 自动写文案；sample 自动出样片 */
export type AutoLevel = 'plan' | 'copy' | 'sample';
export interface SlotMetrics { views: number; likes: number; comments: number; leads: number }
export interface Plan {
  auto: AutoLevel;
  id: string; account: string; weekdays: number[]; hour: number; needOk: boolean; budget: number; running: boolean;
  mix: { n: string; v: number }[]; added: string[]; skipped: string[]; backlog: string[];
}
export type SlotPin = 'cand' | 'fixed';
export interface Slot { planId: string; date: string; topicId: string; pin: SlotPin; why: string; column: string }
export type SlotState = 'done' | 'review' | 'gen' | 'plan' | 'cand' | 'paused' | 'gap';
/** AI 运营：一条内容走到哪一步了 */
export interface SlotProgress { copy: boolean; sample: 'none' | 'running' | 'done' | 'failed'; final: boolean; published: boolean; reviewed: boolean; jobId: string | null; metrics: SlotMetrics | null }
export interface SlotView extends Slot { state: SlotState; topic: Topic; weekday: string; label: string; progress?: SlotProgress }

/* ---------- 工作区 ---------- */
export type VoiceCloneState = 'none' | 'busy' | 'ready';
export interface Workspace {
  id: string; persona: PersonaId; positioning: Positioning; balance: number; voiceClone: VoiceCloneState; theme: string;
  /** 数字人形象：clone = 真人分身，photo = 照片形象（none / busy 审核中 / ready 可用） */
  avatars: { clone: VoiceCloneState; photo: VoiceCloneState };
}
