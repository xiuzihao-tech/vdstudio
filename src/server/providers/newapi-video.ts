// 视频生成适配器：new-api / one-api 类网关的「异步视频端点」（如 土豆 API https://api.ai-tudou.net）。
//   建任务：POST {base}/videos/generations（土豆「异步视频端点」；老版 new-api 是 /video/generations，可用 VIDEO_CREATE_PATH 改）
//   查任务：GET  {建任务路径}/{task_id}，查不到再试 /video/generations/{id}、/videos/{id}
//   请求体同时带常见的几种写法（duration/seconds、ratio/aspect_ratio、image/images），网关各取所需。
// 各家网关返回字段略有出入，这里对任务 ID、状态、视频地址做兼容解析。
// 环境变量：VIDEO_BASE_URL、VIDEO_API_KEY；档位到模型名的映射可在后台「AI 服务」里改。
import { isDraft, modelOf } from '../../shared/gen.ts';
import { frameSize } from '../compose.ts';
import type { VideoProvider } from './types.ts';

export interface NewApiVideoConfig {
  baseUrl: string; apiKey: string;
  /** 档位 → 网关模型名；传函数时每次生成都现取（后台改了立刻生效） */
  models: Record<string, string> | (() => Record<string, string>);
  pollMs?: number; concurrency?: number; timeoutMs?: number; fetch?: typeof fetch;
  /** 建任务路径，默认 /videos/generations */
  createPath?: string;
}

/** 土豆 API 上可用的视频模型（来自其公开价格页，以后台实时拉取为准） */
// draft：开了「样片模式」时统一用这个最便宜的模型先出 480p 预览（土豆 0.15/秒），满意再按所选档位出成片
export const TUDOU_DEFAULT_MODELS: Record<string, string> = { s25: 'seedance-2.5', s20: 'seedance-2.0', s20f: 'seedance-2.0-fast', wan: 'wan3.0', draft: 'seedance-2.0-mini' };

const DONE = ['completed', 'succeeded', 'success', 'succeed', 'finished', 'done'];
const FAIL = ['failed', 'failure', 'fail', 'error', 'expired', 'cancelled', 'canceled', 'timeout'];

type J = Record<string, any>;
export function pickTaskId(j: J): string | null {
  return j?.task_id ?? j?.id ?? j?.data?.task_id ?? j?.data?.id ?? null;
}
export function pickStatus(j: J): string {
  return String(j?.status ?? j?.data?.status ?? j?.state ?? j?.data?.state ?? '').toLowerCase();
}
/** 找视频地址：常见字段优先，找不到就在整个返回里找第一个视频链接 */
export function pickVideoUrl(j: J): string | null {
  const direct = j?.url ?? j?.video_url ?? j?.data?.url ?? j?.data?.video_url ?? j?.content?.video_url ?? j?.data?.content?.video_url
    ?? j?.metadata?.url ?? j?.data?.output ?? j?.output?.video_url ?? j?.data?.videos?.[0]?.url ?? j?.videos?.[0]?.url;
  if (typeof direct === 'string' && /^https?:\/\//.test(direct)) return direct;
  let found: string | null = null;
  const walk = (v: unknown) => {
    if (found) return;
    if (typeof v === 'string' && /^https?:\/\/\S+\.(mp4|mov|webm)(\?|$)/i.test(v)) found = v;
    else if (v && typeof v === 'object') Object.values(v as object).forEach(walk);
  };
  walk(j);
  return found;
}
const errText = (j: J) => j?.error?.message ?? j?.fail_reason ?? j?.data?.fail_reason ?? j?.message ?? j?.data?.error ?? '';

export function makeNewApiVideo(cfg: NewApiVideoConfig): VideoProvider {
  const f = cfg.fetch ?? fetch, base = cfg.baseUrl.replace(/\/$/, '');
  const headers = { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' };
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const models = () => (typeof cfg.models === 'function' ? cfg.models() : cfg.models);

  const createPath = '/' + (cfg.createPath ?? '/videos/generations').replace(/^\/+|\/+$/g, '');
  const queryPaths = [...new Set([createPath, '/video/generations', '/videos'])];
  let goodQuery: string | null = null;

  async function create(body: unknown): Promise<string> {
    const res = await f(`${base}${createPath}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({})) as J;
    const id = pickTaskId(j);
    if (!res.ok || !id) throw new Error(`视频任务创建失败（${res.status}）${errText(j) ? `：${errText(j)}` : ''}`);
    return id;
  }
  async function get(id: string): Promise<J> {
    let last = { status: 0, j: {} as J };
    for (const p of goodQuery ? [goodQuery] : queryPaths) {
      const res = await f(`${base}${p}/${encodeURIComponent(id)}`, { headers });
      const j = await res.json().catch(() => ({})) as J;
      if (res.ok) { goodQuery = p; return j; }
      last = { status: res.status, j };
      if (res.status !== 404 && res.status !== 405) break;
    }
    throw new Error(`查询视频任务失败（${last.status}）${errText(last.j) ? `：${errText(last.j)}` : ''}`);
  }

  return {
    async run({ settings: g, shots, frames, final }, onStep) {
      const m = modelOf(g.model), map = models(), draft = !final && isDraft(g);
      const model = (draft && map.draft) || map[g.model];
      if (!model) throw new Error(`没有为「${m.n}」配置视频模型，请在后台「AI 服务」里设置`);
      const resolution = draft ? '480p' : g.res === '4K' ? '1080p' : g.res;
      const [width, height] = frameSize(g.ratio, resolution);
      onStep(1);
      const urls: (string | null)[] = shots.map(() => null);
      let done = 0;
      const deadline = Date.now() + (cfg.timeoutMs ?? 20 * 60e3);
      const one = async (i: number) => {
        const s = shots[i];
        const prompt = [s.line && `画面配合这句口播：${s.line}`, g.prompt, g.style !== 'AI 推荐' && `风格：${g.style}`, '真实自然光，画面干净，无文字无水印'].filter(Boolean).join('。');
        const duration = Math.min(m.max, Math.max(m.min, Math.round(s.dur)));
        const id = await create({
          model, prompt, duration, seconds: String(duration), width, height, size: `${width}x${height}`,
          resolution, ratio: g.ratio, aspect_ratio: g.ratio, generate_audio: false, watermark: false,
          ...(frames[i] ? { image: frames[i], images: [frames[i]], first_frame_image: frames[i] } : {}),
          metadata: { resolution, ratio: g.ratio, aspect_ratio: g.ratio, generate_audio: false, watermark: false },
        });
        for (;;) {
          if (Date.now() > deadline) throw new Error('视频生成超时');
          await sleep(cfg.pollMs ?? 8000);
          const t = await get(id);
          const st = pickStatus(t);
          if (DONE.includes(st)) {
            const url = pickVideoUrl(t);
            if (!url) throw new Error(`第 ${i + 1} 镜完成了，但没拿到视频地址`);
            urls[i] = url; break;
          }
          if (FAIL.includes(st)) throw new Error(`第 ${i + 1} 镜生成失败${errText(t) ? `：${errText(t)}` : ''}`);
        }
        done++;
        onStep(done === shots.length ? 4 : done * 2 >= shots.length ? 3 : 2);
      };
      const queue = shots.map((_, i) => i);
      await Promise.all(Array.from({ length: Math.min(cfg.concurrency ?? 2, shots.length) }, async () => { while (queue.length) await one(queue.shift()!); }));
      onStep(5);
      return { shotVideos: urls };
    },
  };
}
