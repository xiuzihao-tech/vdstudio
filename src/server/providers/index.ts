// 选择供应方实现。环境变量 AI_PROVIDER=mock（默认）；接入真实服务后在这里加分支。
import { mockProviders } from './mock.ts';
import type { Providers } from './types.ts';

export function loadProviders(): Providers {
  const which = process.env.AI_PROVIDER ?? 'mock';
  switch (which) {
    case 'mock': return mockProviders;
    default: throw new Error(`未知的 AI_PROVIDER：${which}（目前只实现了 mock）`);
  }
}
