// 文案大模型适配器：兼容 OpenAI Chat Completions 的接口（豆包/方舟、DeepSeek、通义、OpenAI 等）。
// 环境变量：LLM_BASE_URL（如 https://ark.cn-beijing.volces.com/api/v3 或 https://api.deepseek.com/v1）、LLM_API_KEY、LLM_MODEL
import { z } from 'zod';
import { CATS, FAMILIES } from '../../shared/catalog.ts';
import type { CopyProvider, Ctx, TopicDraft, TopicProvider } from './types.ts';
import { HttpError } from '../http.ts';

export interface LlmConfig { baseUrl: string; apiKey: string; model: string; timeoutMs?: number; fetch?: typeof fetch }

const catOf = (ctx: Ctx) => ['designer', 'deco', 'custom', 'material', 'soft', 'agent', 'dev', 'stay'].indexOf(ctx.persona.id);
const PARA: Record<number, number> = { 30: 3, 45: 4, 60: 5, 90: 6 };

function system(ctx: Ctx) {
  const p = ctx.persona, pos = ctx.positioning;
  return [
    `你是「大哲 IP」的短视频文案助手，服务${CATS[catOf(ctx)]}行业的内容创作者。`,
    `账号：${pos.name}。定位：${pos.line}。受众：${pos.aud.join('、')}。语气：${pos.tone}。人设标签：${pos.tags.join('、')}。`,
    `当前项目：${p.proj}；重点：${p.focus}；转化目标：${p.goal}。`,
    '要求：说人话、短句、第一人称；不编造数据；不使用广告法禁用的绝对化用语（最、第一、唯一、顶级、保证、100% 等）。',
    '只输出 JSON，不要任何解释或 Markdown。',
  ].join('\n');
}

/** 从模型输出里取出 JSON（兼容包在 ```json 里的情况） */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try { return JSON.parse(t); } catch { /* 继续 */ }
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i >= 0 && j > i) return JSON.parse(t.slice(i, j + 1));
  throw new Error('没有 JSON');
}

export function makeLlm(cfg: LlmConfig) {
  const f = cfg.fetch ?? fetch;
  async function chat<T>(ctx: Ctx, user: string, schema: z.ZodType<T>, temperature = 0.8): Promise<T> {
    const ac = new AbortController(), h = setTimeout(() => ac.abort(), cfg.timeoutMs ?? 60_000);
    let res: Response;
    try {
      res = await f(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', signal: ac.signal,
        headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, temperature, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system(ctx) }, { role: 'user', content: user }] }),
      });
    } catch (e) { throw new HttpError(502, (e as Error).name === 'AbortError' ? '文案模型超时，稍后再试' : '连不上文案模型'); }
    finally { clearTimeout(h); }
    if (!res.ok) throw new HttpError(502, `文案模型出错（${res.status}）`);
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? '';
    try { return schema.parse(extractJson(text)); } catch { throw new HttpError(502, '文案模型返回的格式不对，再试一次'); }
  }

  const topicSchema = z.object({ topics: z.array(z.object({ title: z.string().min(1).max(60), hook: z.string().max(120), dir: z.string(), type: z.number().int().min(0).max(2) })).min(1).max(5) });
  const copySchema = z.object({ titles: z.array(z.string().max(80)).min(1).max(3), hooks: z.array(z.string().max(200)).min(1).max(3), body: z.array(z.string().max(400)).min(1).max(10), cta: z.string().max(200), tags: z.array(z.string().max(30)).max(8) });

  const topics: Pick<TopicProvider, 'fromCase' | 'angles'> = {
    async fromCase(ctx, { text, imageKeys }) {
      const r = await chat(ctx, `根据下面的案例说明，给出 3 个短视频选题。type：0=流量 1=人设 2=转化。dir 从「知识科普、行业观点、产品种草、日常记录、设计游学、项目案例、跨界访谈、人物故事」里选。
案例说明：${text || ctx.persona.focus}
${imageKeys.length ? `附了 ${imageKeys.length} 张现场图。` : ''}
输出：{"topics":[{"title":"","hook":"开头 3 秒怎么拍/说","dir":"","type":0}]}`, topicSchema);
      return r.topics.slice(0, 3).map((t): TopicDraft => ({ title: t.title, hook: t.hook, dir: t.dir, type: t.type as 0 | 1 | 2, heat: 1, k: imageKeys[0] || ctx.persona.att[0], why: '来自你的案例说明' }));
    },
    async angles(ctx, t) {
      const r = await chat(ctx, `选题「${t.title}」，换 5 个讲法，标签分别是 反常识、清单、对比、故事、数据。输出：{"angles":[{"label":"","title":""}]}`,
        z.object({ angles: z.array(z.object({ label: z.string(), title: z.string().max(60) })).min(1).max(6) }));
      return r.angles;
    },
  };

  const copy: CopyProvider = {
    async generate(ctx, t, { kind, len, tone, version }) {
      const n = PARA[len] ?? 4, biz = ctx.persona.biz[0], fam = FAMILIES[biz.tpl];
      const r = await chat(ctx, `为选题写一条${kind}，目标时长 ${len} 秒（口播约每秒 4.5 字）。语气：${tone}。这是第 ${version} 版，和之前的写法要有区别。
选题：${t.title}
开头参考：${t.hook}
方向：${t.dir}
要求：标题 3 个；开头钩子 3 个（一句话）；正文 ${n} 段，每段对应一个镜头；结尾引导落到「${ctx.persona.goal}」；话题标签 5 个（带 #）。
输出：{"titles":[],"hooks":[],"body":[],"cta":"","tags":[]}`, copySchema, 0.9);
      return {
        topicId: t.id, kind, len, tone, titles: r.titles, title: r.titles[0], hooks: r.hooks, hook: r.hooks[0],
        body: r.body, shots: r.body.map((_, i) => fam[Math.min(i + 1, fam.length - 1)].d), cta: r.cta, tags: r.tags, live: 70, version,
      };
    },
    async rewrite(ctx, d, how) {
      const ask = { live: '改得更口语、更像真人在说话，加一点语气词，不改意思', short: '每段都缩短，删掉修饰，意思不变', long: '在倒数第二段前补一段有细节的内容', alt: '换一种说法，意思不变' }[how];
      const r = await chat(ctx, `${ask}。原正文（JSON 数组）：${JSON.stringify(d.body)}。输出：{"body":[]}`, z.object({ body: z.array(z.string().max(400)).min(1).max(12) }), 0.7);
      const changed = r.body.filter((x, i) => x !== d.body[i]).length;
      return { draft: { ...d, body: r.body, live: how === 'live' ? Math.min(94, d.live + 14) : d.live }, changed };
    },
    async humanize(ctx, text) {
      const r = await chat(ctx, `把下面这段文案改得更口语、更像真人在说话，意思不变，长度差不多。原文：${text}\n输出：{"text":""}`, z.object({ text: z.string().max(6000) }), 0.7);
      return r.text;
    },
  };
  return { topics, copy, chat };
}
