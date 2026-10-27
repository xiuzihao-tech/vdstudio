// 文案大模型适配器：兼容 OpenAI Chat Completions 的接口（豆包/方舟、DeepSeek、通义、OpenAI 等）。
// 环境变量：LLM_BASE_URL（如 https://ark.cn-beijing.volces.com/api/v3 或 https://api.deepseek.com/v1）、LLM_API_KEY、LLM_MODEL
import { z } from 'zod';
import { CATS, FAMILIES } from '../../shared/catalog.ts';
import type { CopyProvider, Ctx, TopicDraft, TopicProvider } from './types.ts';
import { HttpError } from '../http.ts';

export interface LlmConfig {
  baseUrl: string; apiKey: string;
  /** 默认模型；传函数时每次调用现取（后台切换模型立即生效） */
  model: string | (() => string);
  /** 「精写」用的模型（不设就用默认模型） */
  fineModel?: () => string;
  /** 主模型出错（服务端错误、模型不存在、超时）时依次改用的备用模型 */
  fallbacks?: () => string[];
  timeoutMs?: number; fetch?: typeof fetch;
}
export type Quality = 'fast' | 'fine';
/** 换一个模型可能就好了的错误：网关 / 上游故障、模型下线、限流 */
const RETRYABLE = (status: number, msg: string) => status >= 500 || status === 404 || status === 429 || (status >= 400 && /model|模型|channel|渠道|分组/i.test(msg));

const catOf = (ctx: Ctx) => ['designer', 'deco', 'custom', 'material', 'soft', 'agent', 'dev', 'stay'].indexOf(ctx.persona.id);
const PARA: Record<number, number> = { 30: 3, 45: 4, 60: 5, 90: 6 };

function system(ctx: Ctx) {
  const p = ctx.persona, pos = ctx.positioning;
  return [
    `你是「大哲 IP」的短视频文案助手，服务${CATS[catOf(ctx)]}行业的内容创作者。`,
    `账号：${pos.name}。定位：${pos.line}。受众：${pos.aud.join('、')}。语气：${pos.tone}。人设标签：${pos.tags.join('、')}。`,
    `当前项目：${p.proj}；重点：${p.focus}；转化目标：${pos.goal || p.goal}。${pos.pillars.length ? `常讲的栏目：${pos.pillars.join('、')}。` : ''}${pos.platforms?.length ? `发布平台：${pos.platforms.join('、')}。` : ''}`,
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

/**
 * 模型偶尔会把镜头说明混进口播（「第一段镜头：开门入户……口播：我进门……」），这里只留要说出口的话。
 */
export function spokenOnly(s: string): string {
  let t = String(s ?? '').trim();
  const m = t.match(/(?:口播|台词|旁白|画外音)\s*[:：]\s*([\s\S]+)$/);
  if (m) t = m[1];
  t = t.replace(/^(?:第\s*[一二三四五六七八九十\d]+\s*(?:段|镜|镜头|个镜头)[^:：]{0,12}[:：]\s*)/, '');
  return t.replace(/^[「“"]|[」”"]$/g, '').trim();
}

export function makeLlm(cfg: LlmConfig) {
  const f = cfg.fetch ?? fetch;
  const primary = () => (typeof cfg.model === 'function' ? cfg.model() : cfg.model);
  /** 这次调用依次尝试的模型：精写先用精写模型，不行再退回默认模型，最后是备用模型 */
  const chain = (q: Quality) => [...new Set([q === 'fine' ? cfg.fineModel?.() ?? '' : '', primary(), ...(cfg.fallbacks?.() ?? [])].filter(Boolean))];
  let lastUsed = '';

  async function chat<T>(ctx: Ctx, user: string, schema: z.ZodType<T>, temperature = 0.8, quality: Quality = 'fast'): Promise<T> {
    const models = chain(quality);
    if (!models.length) throw new HttpError(503, '还没选文案模型，请在后台「AI 服务」里选一个');
    let lastErr: HttpError | null = null;
    for (const model of models) {
      try { const out = await once(model, ctx, user, schema, temperature); lastUsed = model; return out; }
      catch (e) {
        lastErr = e instanceof HttpError ? e : new HttpError(502, String((e as Error).message));
        if (!(lastErr as HttpError & { retry?: boolean }).retry) throw lastErr;
        console.warn(`文案模型 ${model} 出错，换下一个：${lastErr.message}`);
      }
    }
    throw lastErr!;
  }

  async function once<T>(model: string, ctx: Ctx, user: string, schema: z.ZodType<T>, temperature: number): Promise<T> {
    const fail = (status: number, msg: string, retry: boolean) => Object.assign(new HttpError(status, msg), { retry });
    const send = async (jsonMode: boolean) => {
      const ac = new AbortController(), h = setTimeout(() => ac.abort(), cfg.timeoutMs ?? 90_000);
      try {
        return await f(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST', signal: ac.signal,
          headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, temperature, ...(jsonMode ? { response_format: { type: 'json_object' } } : {}), messages: [{ role: 'system', content: system(ctx) }, { role: 'user', content: user }] }),
        });
      } catch (e) { throw fail(502, (e as Error).name === 'AbortError' ? '文案模型超时，稍后再试' : '连不上文案模型', true); }
      finally { clearTimeout(h); }
    };
    // 先要求 JSON 输出；部分模型 / 网关不支持 response_format 会回 400，就去掉再试一次（提示词里已要求只输出 JSON）
    let res = await send(true);
    if (res.status === 400) res = await send(false);
    if (!res.ok) {
      const msg = String(await res.json().then((j: any) => j?.error?.message ?? '').catch(() => ''));
      throw fail(502, `文案模型出错（${res.status}）${msg ? `：${msg.slice(0, 120)}` : ''}`, RETRYABLE(res.status, msg));
    }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? '';
    // 格式不对也换个模型再试（有备用模型时）
    try { return schema.parse(extractJson(text)); } catch { throw fail(502, '文案模型返回的格式不对，再试一次', true); }
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
    async generate(ctx, t, { kind, len, tone, version, quality, materials, habits, avoid, column, tags }) {
      const n = PARA[len] ?? 4, biz = ctx.persona.biz[0], fam = FAMILIES[biz.tpl];
      // 知识库这一层：只给系统挑好的几条素材，并告诉模型怎么用（用细节说话、资历不直说、只用一次）
      const kb = materials?.length ? `\n这条只用下面这些素材（来自本人知识库，不要编别的经历和数字）：\n${materials.map((m, i) => `${i + 1}. 【${m.kind}】${m.text}`).join('\n')}\n用法：挑 1–2 条最贴题的，用具体的人、事、数字讲出来；「履历」类不要直接报年限和头衔，要化成一个细节或一句判断；同一个事实只出现一次。` : '';
      const voice = habits?.length ? `\n本人平时这样说话（只学语气和句子长短，不要照抄、不要硬塞口头禅）：${habits.join(' / ')}` : '';
      const no = avoid?.length ? `\n不要提：${avoid.join('、')}` : '';
      const col = column ? `\n栏目：${column}${tags?.length ? `；人设标签：${tags.join('、')}` : ''}` : '';
      const r = await chat(ctx, `为选题写一条${kind}，目标时长 ${len} 秒（口播约每秒 4.5 字）。语气：${tone}。这是第 ${version} 版，和之前的写法要有区别。
选题：${t.title}
开头参考：${t.hook}
方向：${t.dir}
${kb}${voice}${no}${col}
写法：像本人对着镜头说话——短句、有判断、有具体细节；不要排比、对仗、成语堆砌，不要每段都升华，不要硬加语气词。
要求：标题 3 个；开头钩子 3 个（一句话）；正文 ${n} 段，每段对应一个镜头，**只写这一镜要说出口的话**，不要写镜头说明、不要写「口播：」「第几段」；开头 + 正文 + 结尾合计约 ${Math.round(len * 4.5)} 字（每段不超过 ${Math.round((len * 4.5) / (n + 1))} 字）；结尾引导落到「${ctx.persona.goal}」；话题标签 5 个（带 #）。
${quality === 'fine' ? '这是「精写」：多花心思在开头钩子和细节画面感上，句子要有节奏，少用套话。\n' : ''}输出：{"titles":[],"hooks":[],"body":[],"cta":"","tags":[]}`, copySchema, 0.9, quality ?? 'fast');
      return {
        topicId: t.id, kind, len, tone, titles: r.titles, title: r.titles[0], hooks: r.hooks.map(spokenOnly), hook: spokenOnly(r.hooks[0]),
        body: r.body.map(spokenOnly).filter(Boolean), shots: r.body.map((_, i) => fam[Math.min(i + 1, fam.length - 1)].d), cta: r.cta, tags: r.tags, live: 70, version,
      };
    },
    async rewrite(ctx, d, how, hook) {
      const ask = { live: '改得更像本人对着镜头说话：短句、具体、有判断；不要硬加语气词、不要排比，不改意思', short: '每段都缩短，删掉修饰，意思不变', long: '在倒数第二段前补一段有细节的内容', alt: '换一种说法，意思不变' }[how];
      const extra = how === 'alt' && hook.startsWith('去掉这些 AI 腔') ? `。${hook}` : '';
      const r = await chat(ctx, `${ask}${extra}。原正文（JSON 数组）：${JSON.stringify(d.body)}。输出：{"body":[]}`, z.object({ body: z.array(z.string().max(400)).min(1).max(12) }), 0.7);
      const changed = r.body.filter((x, i) => x !== d.body[i]).length;
      return { draft: { ...d, body: r.body, live: how === 'live' ? Math.min(94, d.live + 14) : d.live }, changed };
    },
    async diagnose(ctx, qa) {
      const r = await chat(ctx, `你是大哲 IP 研究院的定位顾问，按一对一面诊的方法，根据下面的问答给这位创作者做 IP 定位。
问答：
${qa.map(x => `【${x.section}】问：${x.q}\n答：${x.a}`).join('\n')}
要求：标签必须来自回答里反复出现、能区分他和同行的东西（比如「千平大宅」），不要泛泛的词；个性标签要落到对做内容的意义（如「敢下判断」），不要只写 MBTI；栏目 3–5 个，覆盖流量 / 转化 / 人设三类，每个栏目写清用什么视频类型（real 实拍出片、talk 真人口播、tour 空间漫游、house 改造前后、product 产品种草、site 工地记录、story 案例故事、vlog）、每周几条、为什么。
输出：{"tags":{"personality":[],"pro":[],"brand":[]},"position":"一句话定位","account":"现有账号的问题","visual":"视觉建议","nicknames":[],"bio":"简介","columns":[{"name":"","kind":"流量|转化|人设","type":"","perWeek":1,"why":""}]}`,
        z.object({ tags: z.object({ personality: z.array(z.string().max(20)).max(5), pro: z.array(z.string().max(20)).max(5), brand: z.array(z.string().max(20)).max(5) }), position: z.string().max(80), account: z.string().max(300), visual: z.string().max(300), nicknames: z.array(z.string().max(30)).max(4), bio: z.string().max(200),
          columns: z.array(z.object({ name: z.string().max(20), kind: z.enum(['流量', '转化', '人设']), type: z.string().max(10), perWeek: z.number().int().min(1).max(7), why: z.string().max(80) })).min(1).max(6) }), 0.6, 'fine');
      return r;
    },
    async footage(ctx, clips, idea, materials) {
      const r = await chat(ctx, `用户拍了 ${clips.length} 段素材，要串成一条画外音视频。按素材顺序，每段写一句画外音（第 i 句配第 i 段），口语、具体，第一句是钩子，最后一句落到转化目标。
${idea ? `用户想讲的：${idea}\n` : ''}素材：
${clips.map((c, i) => `${i + 1}. ${c.note}`).join('\n')}
${materials.length ? `可以用的本人素材：${materials.join(' / ')}\n` : ''}输出：{"lines":[]}（正好 ${clips.length} 句）`, z.object({ lines: z.array(z.string().max(120)).min(1).max(30) }), 0.8);
      return clips.map((_, i) => r.lines[i] ?? '');
    },
    async humanize(ctx, text) {
      const r = await chat(ctx, `把下面这段文案改得更口语、更像真人在说话，意思不变，长度差不多。原文：${text}\n输出：{"text":""}`, z.object({ text: z.string().max(6000) }), 0.7);
      return r.text;
    },
  };
  return { topics, copy, chat, chain, lastUsed: () => lastUsed };
}
