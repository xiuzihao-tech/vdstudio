// 看懂素材：把视频按时间截几张图（照片就用照片本身）发给能看图的模型，返回一句「拍了什么」、几个标签和最适合用的一段。
// 用 OpenAI 兼容的 /chat/completions（图片按 image_url 传 Base64）；VISION_MODEL 没配时不启用，素材说明只按文件名给，不编画面内容。
import { z } from 'zod';
import { extractJson } from './llm.ts';

export interface VisionNote { note: string; tags: string[]; best: [number, number] | null }
export interface VisionProvider {
  model: string;
  describe(frames: { jpg: Buffer; at: number }[], o: { name: string; type: '视频' | '照片'; dur: number | null }): Promise<VisionNote>;
}

const out = z.object({ note: z.string().min(1).max(80), tags: z.array(z.string().max(12)).max(8).default([]), best: z.tuple([z.number(), z.number()]).nullable().optional() });

export function makeVision(cfg: { baseUrl: string; apiKey: string; model: string; timeoutMs?: number; fetch?: typeof fetch }): VisionProvider {
  const f = cfg.fetch ?? fetch;
  return {
    model: cfg.model,
    async describe(frames, o) {
      const what = o.type === '视频'
        ? `一段 ${o.dur ? `${o.dur.toFixed(1)} 秒的` : ''}视频按时间顺序截的 ${frames.length} 张画面（分别在第 ${frames.map(x => x.at.toFixed(1)).join(' / ')} 秒）`
        : '一张照片';
      const prompt = [
        `你在帮家装、家居行业的从业者整理现场素材。下面是${what}，文件名「${o.name}」。`,
        '用一句话（不超过 30 个字）说清拍了什么：空间或部位、主体、看得到的工艺或材料细节、镜头怎么动。只写画面里看得到的，不要猜品牌、价格和面积。',
        '再给 3–6 个标签（空间、工艺、材料、施工节点之类）。',
        o.type === '视频' ? '如果有一段最适合剪进短视频（3–8 秒，画面稳、主体清楚），给出开始和结束的秒数；没有就给 null。' : '照片不用给 best，填 null。',
        '只输出 JSON：{"note":"","tags":[],"best":[开始秒,结束秒] 或 null}',
      ].join('\n');
      const res = await f(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000),
        headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: cfg.model, temperature: 0.2,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...frames.map(x => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${x.jpg.toString('base64')}` } }))] }],
        }),
      });
      if (!res.ok) throw new Error(`看图模型出错（${res.status}）`);
      const data = await res.json() as { choices?: { message?: { content?: string } }[] };
      const r = out.parse(extractJson(data.choices?.[0]?.message?.content ?? ''));
      const best = r.best && o.dur && r.best[1] > r.best[0] ? [Math.max(0, r.best[0]), Math.min(o.dur, r.best[1])] as [number, number] : null;
      return { note: r.note, tags: r.tags, best };
    },
  };
}
