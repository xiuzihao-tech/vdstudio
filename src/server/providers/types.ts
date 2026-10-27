// AI 供应方接口。页面和路由只依赖这些接口；接真实服务时新增一个实现，在 providers/index.ts 里切换。
import type { CopyDraft, CopyKind, CopyLen, Persona, PlannedShot, Positioning, Tone, Topic, GenSettings } from '../../shared/types.ts';
import type { Rewrite } from '../../shared/copy.ts';
import type { DiagReport } from '../../shared/kb.ts';

export interface TopicDraft { title: string; hook: string; dir: string; type: 0 | 1 | 2; heat: 1 | 2 | 3; k: string; why: string }
export interface Ctx { persona: Persona; positioning: Positioning }

/** 大哲选题库：热门选题、案例策划、对标拆解、深挖角度 */
export interface TopicProvider {
  fromCase(ctx: Ctx, input: { text: string; imageKeys: string[] }): Promise<TopicDraft[]>;
  analyzeBenchmark(ctx: Ctx, input: { url: string; learn: string[] }): Promise<{ platform: string; rows: [string, string][]; topic: TopicDraft }>;
  fromMaterials(ctx: Ctx, input: { keys: string[]; note: string }): Promise<TopicDraft>;
  angles(ctx: Ctx, t: Topic): Promise<{ label: string; title: string }[]>;
}

/** 文案大模型 */
export interface CopyProvider {
  generate(ctx: Ctx, t: Topic, o: { kind: CopyKind; len: CopyLen; tone: Tone; version: number; quality?: 'fast' | 'fine';
    /** 系统从知识库挑好的素材（这条只用这些，不要自己编） */ materials?: { kind: string; text: string }[];
    /** 本人的说话习惯：只做语气参考 */ habits?: string[]; /** 不说的话 */ avoid?: string[]; column?: string; tags?: string[] }): Promise<Omit<CopyDraft, 'id' | 'updatedAt' | 'assetIds'>>;
  /** AI 面诊：按回答出 IP 定位报告 */
  diagnose(ctx: Ctx, qa: { section: string; q: string; a: string }[]): Promise<Omit<DiagReport, 'createdAt'>>;
  /** 实拍出片：每段素材写一句画外音（返回的句数 = 素材数） */
  footage(ctx: Ctx, clips: { type: string; note: string }[], idea: string, materials: string[]): Promise<string[]>;
  rewrite(ctx: Ctx, d: CopyDraft, how: Rewrite, hook: string): Promise<{ draft: CopyDraft; changed: number }>;
  humanize(ctx: Ctx, text: string): Promise<string>;
}

/** 视频生成（Seedance 等）。run 内部负责提交、轮询，并逐步回报进度 */
export interface VideoProvider {
  /** frames：每镜首帧图片的公网地址（没有则为 null）。返回每镜生成好的视频地址（Mock 不返回） */
  run(input: {
    settings: GenSettings; shots: PlannedShot[]; final: boolean; frames: (string | null)[];
    /** 服务重启前已经提交过的各镜任务 ID：有就不再提交（不重复花钱），直接接着查 */
    known?: (string | null)[];
    /** 每镜任务提交成功时回调，用来把任务 ID 存进数据库 */
    onTask?: (i: number, taskId: string) => void;
  }, onStep: (i: number) => void): Promise<{ shotVideos?: (string | null)[]; /** 第 i 镜失败的原因（其余镜照常返回）；全部失败时直接抛错 */ errors?: (string | null)[] } | void>;
  /** 能否在服务重启后接着查任务（Mock 不能） */
  resumable?: boolean;
  /** 首帧图能否用 base64 内联发送。false = 只认公网链接（土豆），本机没有公网地址时就发不了首帧 */
  inlineImages?: boolean;
}

/** 声音克隆与配音 */
export interface VoiceProvider { clone(sample: { bytes: number; mime: string }): Promise<{ voiceId: string }> }

/** 语音转写 / 视频提文案 */
export interface TranscribeProvider { transcribe(ctx: Ctx, src: { kind: 'audio' | 'video'; ref: string }): Promise<string> }

export interface Providers { topics: TopicProvider; copy: CopyProvider; video: VideoProvider; voice: VoiceProvider; transcribe: TranscribeProvider }
