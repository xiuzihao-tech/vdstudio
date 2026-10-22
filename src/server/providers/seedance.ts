// Seedance 视频生成适配器（火山方舟 Ark）。每一镜建一个生成任务，并发提交、轮询到结束，返回每镜视频地址。
// 接口：POST {base}/contents/generations/tasks → {id}；GET {base}/contents/generations/tasks/{id} → {status, content.video_url}
// 状态：queued / running / succeeded / failed / expired。视频地址 24 小时过期，正式版需要转存到自己的对象存储。
// 环境变量：ARK_API_KEY、ARK_BASE_URL（默认 https://ark.cn-beijing.volces.com/api/v3）、SEEDANCE_MODEL_S25 / _S20 / _S20F、SEEDANCE_POLL_MS
import { modelOf, isDraft } from '../../shared/gen.ts';
import type { VideoProvider } from './types.ts';

export interface SeedanceConfig {
  apiKey: string; baseUrl: string; models: Record<string, string>;
  pollMs?: number; concurrency?: number; timeoutMs?: number; watermark?: boolean; fetch?: typeof fetch;
}
export const DEFAULT_MODELS: Record<string, string> = { s25: 'doubao-seedance-2-5-260628', s20: 'doubao-seedance-2-0-260128', s20f: 'doubao-seedance-2-0-fast-260128' };

type Task = { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'expired' | 'cancelled'; content?: { video_url?: string }; error?: { message?: string } };

export function makeSeedance(cfg: SeedanceConfig): VideoProvider {
  const f = cfg.fetch ?? fetch, base = cfg.baseUrl.replace(/\/$/, '');
  const headers = { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' };
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  async function create(body: unknown): Promise<string> {
    const res = await f(`${base}/contents/generations/tasks`, { method: 'POST', headers, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
    if (!res.ok || !j.id) throw new Error(`视频任务创建失败（${res.status}）${j.error?.message ? `：${j.error.message}` : ''}`);
    return j.id;
  }
  async function get(id: string): Promise<Task> {
    const res = await f(`${base}/contents/generations/tasks/${id}`, { headers });
    if (!res.ok) throw new Error(`查询视频任务失败（${res.status}）`);
    return await res.json() as Task;
  }

  return {
    async run({ settings: g, shots, frames }, onStep) {
      const m = modelOf(g.model), model = cfg.models[g.model];
      if (!model) throw new Error(`没有为 ${m.n} 配置方舟模型 ID`);
      const resolution = isDraft(g) ? '480p' : g.res === '4K' ? '1080p' : g.res; // 方舟文档目前最高 1080p
      onStep(1);
      const urls: (string | null)[] = shots.map(() => null);
      let done = 0;
      const deadline = Date.now() + (cfg.timeoutMs ?? 20 * 60e3);
      const one = async (i: number) => {
        const s = shots[i];
        const text = [s.line && `画面配合这句口播：${s.line}`, g.prompt, g.style !== 'AI 推荐' && `风格：${g.style}`, '真实自然光，画面干净'].filter(Boolean).join('。');
        const content: unknown[] = [{ type: 'text', text }];
        if (frames[i]) content.push({ type: 'image_url', image_url: { url: frames[i] }, role: 'first_frame' });
        const id = await create({
          model, content, resolution, ratio: g.ratio, duration: Math.min(m.max, Math.max(m.min, Math.round(s.dur))),
          generate_audio: false, watermark: !!cfg.watermark,
        });
        for (;;) {
          if (Date.now() > deadline) throw new Error('视频生成超时');
          await sleep(cfg.pollMs ?? 10_000);
          const t = await get(id);
          if (t.status === 'succeeded') { urls[i] = t.content?.video_url ?? null; break; }
          if (t.status === 'failed' || t.status === 'expired' || t.status === 'cancelled') throw new Error(`第 ${i + 1} 镜生成失败${t.error?.message ? `：${t.error.message}` : ''}`);
        }
        done++;
        onStep(done === shots.length ? 4 : done * 2 >= shots.length ? 3 : 2);
      };
      // 限并发
      const queue = shots.map((_, i) => i);
      const workers = Array.from({ length: Math.min(cfg.concurrency ?? 2, shots.length) }, async () => { while (queue.length) await one(queue.shift()!); });
      await Promise.all(workers);
      onStep(5);
      return { shotVideos: urls };
    },
  };
}
