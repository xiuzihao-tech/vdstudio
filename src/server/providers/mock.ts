// Mock 供应方：离线可跑、结果确定，逻辑与交互原型一致。延迟可通过 MOCK_DELAY_MS 调整（测试时设为 0）。
import { CATS, FAMILIES, LIVE_OPENERS } from '../../shared/catalog.ts';
import { rewriteLocal } from '../../shared/copy.ts';
import type { Providers, TopicDraft, Ctx } from './types.ts';

const delay = (ms: number) => new Promise(r => setTimeout(r, Number(process.env.MOCK_DELAY_MS ?? ms)));
const bare = (s: string) => s.replace(/[，。？?！!]+$/, '');
const PARA: Record<number, number> = { 30: 3, 45: 4, 60: 5, 90: 6 };
const catOf = (ctx: Ctx) => ['designer', 'deco', 'custom', 'material', 'soft', 'agent', 'dev', 'stay'].indexOf(ctx.persona.id);

export function detectPlatform(u: string): string {
  return /xhslink|xiaohongshu/.test(u) ? '小红书' : /mp\.weixin|weixin\.qq/.test(u) ? '公众号' : /douyin|v\.dy/.test(u) ? '抖音' : /bilibili|b23\.tv/.test(u) ? 'B 站' : '网页';
}

export const mockProviders: Providers = {
  topics: {
    async fromCase(ctx, { text, imageKeys }) {
      await delay(600);
      const base = (text || ctx.persona.focus).split(/[，,；;。]/)[0].slice(0, 14);
      const k = imageKeys[0] || ctx.persona.att[0];
      const why = `来自你的案例说明${imageKeys.length ? `和 ${imageKeys.length} 张图` : ''}`;
      const out: TopicDraft[] = [
        { title: `${base}，住进去以后才知道的事`, hook: '业主原话开场', dir: '项目案例', type: 2, heat: 1, k, why },
        { title: `同样的预算，${base}我只改了一处`, hook: '前后对比', dir: '项目案例', type: 0, heat: 1, k, why },
        { title: `关于${base}，同行不爱说的一句话`, hook: '本人出镜，反常识开场', dir: '行业观点', type: 1, heat: 1, k, why },
      ];
      return out;
    },
    async analyzeBenchmark(ctx, { url, learn }) {
      await delay(700);
      return {
        platform: detectPlatform(url),
        rows: [['开头', '前 2 秒直接给结果画面，再用一句反问拉住人'], ['结构', '结果 → 原因 → 三个细节 → 一句判断 → 引导'],
          ['表达', '第一人称、短句，每句不超过 15 字'], ['节奏', '平均 2.1 秒一刀，卡在鼓点上'], ['可复刻', learn.join('、') || '开头方式']],
        topic: { title: `${ctx.persona.focus.split('，')[0]}：先看结果，再说为什么`, hook: '结果画面开场，接一句反问', dir: '项目案例', type: 0, heat: 2, k: ctx.persona.att[0], why: `复刻对标的${learn[0] || '开头'}` },
      };
    },
    async fromMaterials(ctx, { keys, note }) {
      await delay(300);
      return { title: note ? note.slice(0, 18) : `这 ${keys.length} 个画面，讲清${ctx.persona.focus.split('，')[0]}`, hook: '用素材里最有动作的一张开场', dir: '项目案例', type: 0, heat: 1, k: keys[0] || ctx.persona.att[0], why: `用了 ${keys.length} 份素材` };
    },
    async angles(ctx, t) {
      const b = bare(t.title);
      return [{ label: '反常识', title: `${b}，大多数人做反了` }, { label: '清单', title: `${b}：看这 3 个点就够` }, { label: '对比', title: '做对和做错，差在哪一步' },
        { label: '故事', title: `${ctx.persona.proj.split(' ')[0]}的业主，一开始并不同意` }, { label: '数据', title: t.hook }];
    },
  },
  copy: {
    async generate(ctx, t, { kind, len, tone, version }) {
      await delay(400);
      const p = ctx.persona, c = catOf(ctx), b = bare(t.title), biz = p.biz[0];
      const base = [
        `先说背景：${p.proj}，${p.read[0][1]}。`,
        `很多人在这一步吃亏，${t.dir === '知识科普' ? '是因为没人告诉你标准是什么' : '是因为只看了效果图，没想过住进去以后'}。`,
        `我的做法是：${p.focus}。`,
        `具体用的是${p.read[1][1]}。这样做，能保证住进去三年都好用。`,
        `${t.hook}，这是我最想让你看到的细节。`,
        '如果你也遇到这种情况，记住一句话：先想清楚怎么用，再决定怎么做。',
      ];
      const fx: Record<string, (s: string) => string> = {
        亲切: s => s, 专业: s => s.replace('我的做法是', '我们的方案是'),
        犀利: s => s.replace('很多人在这一步吃亏', '说句不好听的，大多数人在这一步吃亏'), 幽默: s => s.replace('先说背景', '先交代一下案发现场'),
      };
      let body = base.slice(0, PARA[len] ?? 4).map(fx[tone]);
      if (version > 1) body = body.slice(1).concat(body[0]);
      const fam = FAMILIES[biz.tpl];
      const titles = [t.title, `${b}｜${p.focus.split('，')[0]}`, `${p.aud[0]}一定要看：${b}`];
      const hooks = [`${t.hook}。`, `你是不是也以为，${b}很简单？`, `做了这么多年${CATS[c]}，关于${b}，我只说一句真话。`];
      return {
        topicId: t.id, kind, len, tone, titles, title: titles[(version - 1) % 3], hooks, hook: hooks[(version - 1) % 3],
        body, shots: body.map((_, i) => fam[Math.min(i + 1, fam.length - 1)].d),
        cta: `${p.goal}，我帮你看看你家能怎么做。`,
        tags: [`#${CATS[c]}`, `#${t.dir}`, `#${biz.n}`, '#装修', '#家居灵感'], live: 62, version,
      };
    },
    async rewrite(_ctx, d, how, hook) { await delay(200); return rewriteLocal(d, how, hook); },
    async humanize(_ctx, text) {
      await delay(200);
      return text.split('。').filter(Boolean).map((s, i) => (i % 2 ? '' : LIVE_OPENERS[(i / 2) % LIVE_OPENERS.length]) + s.replace('我们', '我')).join('。') + '。';
    },
  },
  video: {
    inlineImages: true,
    async run({ shots }, onStep) {
      const per = Math.max(150, Math.min(700, shots.length * 120));
      for (let i = 1; i <= 5; i++) { await delay(per); onStep(i); }
    },
  },
  voice: { async clone() { await delay(2500); return { voiceId: `voice_${Date.now()}` }; } },
  transcribe: {
    async transcribe(ctx) {
      await delay(800);
      const p = ctx.persona;
      return `今天带大家看一下${p.proj}。${p.focus}，这是我们最花心思的地方。${p.read[1][1]}，用了三年还是这个样子。${p.goal}，我帮你看看。`;
    },
  },
};
