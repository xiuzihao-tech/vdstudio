// 选择供应方实现：默认全部 Mock；配了哪个服务的密钥，就把那一块换成真实实现。
// AI_PROVIDER=mock 强制全部 Mock（测试用）。
import { mockProviders } from './mock.ts';
import { makeLlm } from './llm.ts';
import { DEFAULT_MODELS, makeSeedance } from './seedance.ts';
import type { Providers } from './types.ts';

export type ProviderInfo = { copy: 'mock' | 'llm'; video: 'mock' | 'seedance' };

export function loadProviders(env: NodeJS.ProcessEnv = process.env): { providers: Providers; info: ProviderInfo } {
  const p: Providers = { ...mockProviders, topics: { ...mockProviders.topics }, copy: { ...mockProviders.copy } };
  const info: ProviderInfo = { copy: 'mock', video: 'mock' };
  if (env.AI_PROVIDER === 'mock') return { providers: p, info };

  if (env.LLM_API_KEY && env.LLM_BASE_URL && env.LLM_MODEL) {
    const llm = makeLlm({ baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL });
    p.copy = llm.copy;
    p.topics = { ...p.topics, fromCase: llm.topics.fromCase, angles: llm.topics.angles };
    info.copy = 'llm';
  }
  if (env.ARK_API_KEY) {
    p.video = makeSeedance({
      apiKey: env.ARK_API_KEY,
      baseUrl: env.ARK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3',
      models: { s25: env.SEEDANCE_MODEL_S25 ?? DEFAULT_MODELS.s25, s20: env.SEEDANCE_MODEL_S20 ?? DEFAULT_MODELS.s20, s20f: env.SEEDANCE_MODEL_S20F ?? DEFAULT_MODELS.s20f },
      pollMs: env.SEEDANCE_POLL_MS ? Number(env.SEEDANCE_POLL_MS) : undefined,
      watermark: env.SEEDANCE_WATERMARK === '1',
    });
    info.video = 'seedance';
  }
  return { providers: p, info };
}
