// AI 供应方接口。页面和路由只依赖这些接口；接真实服务时新增一个实现，在 providers/index.ts 里切换。
import type { CopyDraft, CopyKind, CopyLen, Persona, PlannedShot, Positioning, Tone, Topic, GenSettings } from '../../shared/types.ts';
import type { Rewrite } from '../../shared/copy.ts';

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
  generate(ctx: Ctx, t: Topic, o: { kind: CopyKind; len: CopyLen; tone: Tone; version: number }): Promise<Omit<CopyDraft, 'id' | 'updatedAt' | 'assetIds'>>;
  rewrite(ctx: Ctx, d: CopyDraft, how: Rewrite, hook: string): Promise<{ draft: CopyDraft; changed: number }>;
  humanize(text: string): Promise<string>;
}

/** 视频生成（Seedance 等）。run 内部负责提交、轮询，并逐步回报进度 */
export interface VideoProvider {
  run(input: { settings: GenSettings; shots: PlannedShot[]; final: boolean }, onStep: (i: number) => void): Promise<void>;
}

/** 声音克隆与配音 */
export interface VoiceProvider { clone(sample: { bytes: number; mime: string }): Promise<{ voiceId: string }> }

/** 语音转写 / 视频提文案 */
export interface TranscribeProvider { transcribe(ctx: Ctx, src: { kind: 'audio' | 'video'; ref: string }): Promise<string> }

export interface Providers { topics: TopicProvider; copy: CopyProvider; video: VideoProvider; voice: VoiceProvider; transcribe: TranscribeProvider }
