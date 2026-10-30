// 视频生成适配器：new-api / one-api 类网关的「异步视频端点」（如 土豆 API https://api.ai-tudou.net）。
//   建任务：POST {base}/videos/generations（土豆「异步视频端点」；老版 new-api 是 /video/generations，可用 VIDEO_CREATE_PATH 改）
//   查任务：GET  {建任务路径}/{task_id}，查不到再试 /video/generations/{id}、/videos/{id}
//   请求体同时带常见的几种写法（duration/seconds、ratio/aspect_ratio、image/images），网关各取所需。
// 各家网关返回字段略有出入，这里对任务 ID、状态、视频地址做兼容解析。
// 环境变量：VIDEO_BASE_URL、VIDEO_API_KEY；档位到模型名的映射可在后台「AI 服务」里改。
import { draftResOf, isDraft, modelOf } from '../../shared/gen.ts';
import { shotPrompt } from '../../shared/video.ts';
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
// draft：开了「样片模式」时统一用这个最便宜的模型先出预览（土豆 seedance-2.0-mini，0.15/秒，最低 720p），满意再按所选档位出成片
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
/** 从「可选：720p, 1080p, 2k」这类错误里挑最低的清晰度 */
export function lowestOption(msg: string): string | null {
  const text = String(msg);
  // 取最后一个「可选 / allowed / supported / options」后面的部分，避免把「没有 480p」里的 480p 当成可选值
  const kws = [...text.matchAll(/可选|allowed|supported|options?|available/gi)];
  if (!kws.length) return null;
  const tail = text.slice(kws[kws.length - 1].index!);
  const opts = [...tail.matchAll(/\b(\d{3,4}p|\d+k)\b/gi)].map(m => m[1]);
  const px = (s: string) => (/k$/i.test(s) ? Number(s.slice(0, -1)) * 1000 : Number(s.slice(0, -1)));
  return opts.sort((a, b) => px(a) - px(b))[0] ?? null;
}
const errText = (j: J): string => String(j?.error?.message ?? j?.fail_reason ?? j?.data?.fail_reason ?? j?.message ?? j?.data?.error ?? '');

export function makeNewApiVideo(cfg: NewApiVideoConfig): VideoProvider {
  const f = cfg.fetch ?? fetch, base = cfg.baseUrl.replace(/\/$/, '');
  const headers = { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' };
  // unref：轮询等待不拦着进程退出（服务本身由 HTTP 服务器保持运行）
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms).unref());
  const models = () => (typeof cfg.models === 'function' ? cfg.models() : cfg.models);

  const createPath = '/' + (cfg.createPath ?? '/videos/generations').replace(/^\/+|\/+$/g, '');
  // 土豆文档的查询路径是 /v1/tasks/{id}；老版 new-api 用建任务路径 + /{id}
  const queryPaths = [...new Set(['/tasks', createPath, '/video/generations', '/videos'])];
  let goodQuery: string | null = null;

  async function create(body: J, retried = false): Promise<string> {
    const res = await f(`${base}${createPath}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({})) as J;
    const id = pickTaskId(j);
    if (res.ok && id) return id;
    // 清晰度不被这个模型支持时，网关会列出可选值（如「没有分辨率 480p，可选：720p, 1080p」）：换成可选里最低的一档再交一次
    const alt = !retried && res.status === 400 ? lowestOption(errText(j)) : null;
    if (alt && alt !== body.resolution) {
      console.warn(`视频模型不支持 ${body.resolution}，改用 ${alt} 重新提交`);
      return create({ ...body, resolution: alt, extra: { ...(body.extra ?? {}), resolution: alt }, metadata: { ...(body.metadata ?? {}), resolution: alt } }, true);
    }
    throw new Error(`视频任务创建失败（${res.status}）${errText(j) ? `：${errText(j)}` : ''}`);
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
    resumable: true,
    inlineImages: false, // 土豆文档：图片必须是公网 URL，不接受本地路径或 base64
    async run({ settings: g, shots, frames, final, known, onTask }, onStep) {
      const map = models(), draft = !final && isDraft(g);
      // 每镜可以单独换模型；样片模式统一用最便宜的样片模型
      const modelFor = (id: string) => (draft && map.draft) || map[id];
      if (!modelFor(g.model)) throw new Error(`没有为「${modelOf(g.model).n}」配置视频模型，请在后台「AI 服务」里设置`);
      for (const s of shots) if (!s.reused && s.source !== 'clip' && !modelFor(s.model || g.model)) throw new Error(`没有为「${modelOf(s.model || g.model).n}」配置视频模型，请在后台「AI 服务」里设置`);
      const resolution = draft ? draftResOf(g.model) : g.res === '4K' ? '1080p' : g.res;
      const [width, height] = frameSize(g.ratio, resolution);
      onStep(1);
      const urls: (string | null)[] = shots.map(s => (s.reused ? s.videoUrl ?? null : null));
      const errors: (string | null)[] = shots.map(() => null);
      const todo = shots.map((s, i) => i).filter(i => !shots[i].reused && shots[i].source !== 'clip');
      let done = 0;
      const deadline = Date.now() + (cfg.timeoutMs ?? 20 * 60e3);
      const submit = (i: number) => {
        const s = shots[i], m = modelOf(s.model || g.model);
        // 新链路：画面描述 + 景别运镜 + 台词；旧链路只有台词
        const prompt = s.prompt !== undefined ? shotPrompt({ prompt: s.prompt, size: s.size ?? '中景', move: s.move ?? '固定', line: s.line, source: s.source ?? 'ai' }, g)
          : [s.line && `画面配合这句口播：${s.line}`, g.prompt, g.style !== 'AI 推荐' && `风格：${g.style}`, '真实自然光，画面干净，无文字无水印'].filter(Boolean).join('。');
        const duration = Math.min(m.max, Math.max(m.min, Math.round(s.dur)));
        // 环境声：插入画面按用户设置，数字人出镜的镜头不要（之后要对口型）
        const audio = !!g.ambience && s.source !== 'avatar';
        return create({
          model: modelFor(s.model || g.model), prompt, duration, seconds: String(duration), width, height, size: `${width}x${height}`,
          resolution, ratio: g.ratio, aspect_ratio: g.ratio, generate_audio: audio, watermark: false,
          ...(frames[i] ? { input_reference: frames[i], images: [frames[i]], image: frames[i] } : {}),
          // 土豆文档建议比例、清晰度也放进 extra；其他 new-api 网关读 metadata
          extra: { aspect_ratio: g.ratio, resolution, ...(frames[i] ? { images: [frames[i]] } : {}) },
          metadata: { resolution, ratio: g.ratio, aspect_ratio: g.ratio, generate_audio: audio, watermark: false },
        });
      };
      const one = async (i: number) => {
        let id = known?.[i] || null;
        // 失败自动重试 1 次（重新提交），再失败就记下原因，不拖累其他镜
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            if (!id) { id = await submit(i); onTask?.(i, id); }
            for (;;) {
              if (Date.now() > deadline) throw new Error('视频生成超时');
              await sleep(cfg.pollMs ?? 8000);
              const t = await get(id);
              const st = pickStatus(t);
              if (DONE.includes(st)) {
                const url = pickVideoUrl(t);
                if (!url) throw new Error('完成了，但没拿到视频地址');
                urls[i] = url; break;
              }
              if (FAIL.includes(st)) throw new Error(`生成失败${errText(t) ? `：${errText(t)}` : ''}`);
            }
            errors[i] = null; break;
          } catch (e) {
            errors[i] = String((e as Error).message ?? e);
            id = null;
            if (attempt === 0) console.warn(`第 ${i + 1} 镜失败，重试一次：${errors[i]}`);
          }
        }
        done++;
        onStep(done === todo.length ? 4 : done * 2 >= todo.length ? 3 : 2);
      };
      const queue = [...todo];
      await Promise.all(Array.from({ length: Math.min(cfg.concurrency ?? 2, Math.max(1, todo.length)) }, async () => { while (queue.length) await one(queue.shift()!); }));
      if (todo.length && todo.every(i => errors[i])) throw new Error(todo.length === 1 ? `第 ${todo[0] + 1} 镜${errors[todo[0]]}` : `所有镜头都没生成成功：第 ${todo[0] + 1} 镜${errors[todo[0]]}`);
      onStep(5);
      return { shotVideos: urls, errors };
    },
  };
}
