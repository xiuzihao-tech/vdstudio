// 选择供应方实现：默认全部 Mock；配了哪个服务的密钥，就把那一块换成真实实现。
// 文案：LLM_BASE_URL + LLM_API_KEY（+ LLM_MODEL 默认模型；后台可改）
// 视频：VIDEO_BASE_URL + VIDEO_API_KEY → new-api 异步视频端点（土豆 API 等）；或 ARK_API_KEY → 火山方舟直连
// AI_PROVIDER=mock 强制全部 Mock（测试用）。
import { mockProviders } from './mock.ts';
import { makeLlm } from './llm.ts';
import { DEFAULT_MODELS, makeSeedance } from './seedance.ts';
import { makeNewApiVideo, TUDOU_DEFAULT_MODELS } from './newapi-video.ts';
import type { Providers } from './types.ts';

export type ProviderInfo = { copy: 'mock' | 'llm'; video: 'mock' | 'seedance' | 'newapi' };

/** 运行时可改的 AI 设置（存在 settings 表，后台「AI 服务」页修改，不用重启） */
export interface AiRuntime { get(k: 'llm_model' | 'video_models'): string | undefined }
const noRuntime: AiRuntime = { get: () => undefined };

/** 给后台看的接入详情（不含密钥） */
export interface AiStatus {
  copy: { kind: ProviderInfo['copy']; baseUrl?: string; model?: string; envModel?: string };
  video: { kind: ProviderInfo['video']; baseUrl?: string; models?: Record<string, string> };
}

export function loadProviders(env: NodeJS.ProcessEnv = process.env, rt: AiRuntime = noRuntime) {
  const p: Providers = { ...mockProviders, topics: { ...mockProviders.topics }, copy: { ...mockProviders.copy } };
  const info: ProviderInfo = { copy: 'mock', video: 'mock' };
  const llmModel = () => rt.get('llm_model') || env.LLM_MODEL || '';
  const videoModels = (defaults: Record<string, string>) => () => {
    try { return { ...defaults, ...JSON.parse(rt.get('video_models') || '{}') }; } catch { return defaults; }
  };
  let videoMap: (() => Record<string, string>) | null = null;

  if (env.AI_PROVIDER !== 'mock') {
    if (env.LLM_API_KEY && env.LLM_BASE_URL) {
      const llm = makeLlm({ baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: llmModel });
      p.copy = llm.copy;
      p.topics = { ...p.topics, fromCase: llm.topics.fromCase, angles: llm.topics.angles };
      info.copy = 'llm';
    }
    if (env.VIDEO_API_KEY && env.VIDEO_BASE_URL) {
      videoMap = videoModels({ ...TUDOU_DEFAULT_MODELS, ...envModels(env) });
      p.video = makeNewApiVideo({ baseUrl: env.VIDEO_BASE_URL, apiKey: env.VIDEO_API_KEY, models: videoMap, pollMs: env.VIDEO_POLL_MS ? Number(env.VIDEO_POLL_MS) : undefined });
      info.video = 'newapi';
    } else if (env.ARK_API_KEY) {
      videoMap = videoModels({ s25: env.SEEDANCE_MODEL_S25 ?? DEFAULT_MODELS.s25, s20: env.SEEDANCE_MODEL_S20 ?? DEFAULT_MODELS.s20, s20f: env.SEEDANCE_MODEL_S20F ?? DEFAULT_MODELS.s20f });
      p.video = makeSeedance({
        apiKey: env.ARK_API_KEY, baseUrl: env.ARK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3', models: videoMap(),
        pollMs: env.SEEDANCE_POLL_MS ? Number(env.SEEDANCE_POLL_MS) : undefined, watermark: env.SEEDANCE_WATERMARK === '1',
      });
      info.video = 'seedance';
    }
  }

  const status = (): AiStatus => ({
    copy: { kind: info.copy, baseUrl: info.copy === 'llm' ? env.LLM_BASE_URL : undefined, model: info.copy === 'llm' ? llmModel() : undefined, envModel: env.LLM_MODEL },
    video: { kind: info.video, baseUrl: info.video === 'newapi' ? env.VIDEO_BASE_URL : info.video === 'seedance' ? env.ARK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3' : undefined, models: videoMap?.() },
  });
  /** 后台用：调供应方的 /models 列出可用模型、做连通测试 */
  const endpoints = {
    llm: info.copy === 'llm' ? { baseUrl: env.LLM_BASE_URL!, apiKey: env.LLM_API_KEY! } : null,
    video: info.video === 'newapi' ? { baseUrl: env.VIDEO_BASE_URL!, apiKey: env.VIDEO_API_KEY! } : null,
  };
  return { providers: p, info, status, endpoints, llmModel };
}

/** .env 里单独指定的档位模型：VIDEO_MODEL_S25=seedance-2.5 … */
function envModels(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['s25', 's20', 's20f', 'wan']) { const v = env[`VIDEO_MODEL_${k.toUpperCase()}`]; if (v) out[k] = v; }
  return out;
}
