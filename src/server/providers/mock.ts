// Mock 供应方：离线可跑、结果确定，逻辑与交互原型一致。延迟可通过 MOCK_DELAY_MS 调整（测试时设为 0）。
// 只用用户自己的资料（人设档案、知识库、素材文件名）和中性的通用句，不写演示项目里的具体事实。
import { CATS, FAMILIES, LIVE_OPENERS } from '../../shared/catalog.ts';
import { rewriteLocal } from '../../shared/copy.ts';
import { mockTts } from './tts.ts';
import type { Providers, TopicDraft, Ctx } from './types.ts';

const delay = (ms: number) => new Promise(r => setTimeout(r, Number(process.env.MOCK_DELAY_MS ?? ms)));
const bare = (s: string) => s.replace(/[，。？?！!]+$/, '');
const PARA: Record<number, number> = { 30: 3, 45: 4, 60: 5, 90: 6 };
const catOf = (ctx: Ctx) => ['designer', 'deco', 'custom', 'material', 'soft', 'agent', 'dev', 'stay'].indexOf(ctx.persona.id);
/** 转化目标：用户自己填的优先 */
const goalOf = (ctx: Ctx) => ctx.positioning.goal || ctx.persona.goal;
/** 一句话的主题：定位 → 常讲的栏目 → 行业 */
const themeOf = (ctx: Ctx) => ctx.positioning.line || ctx.positioning.pillars[0] || CATS[Math.max(0, catOf(ctx))];
const first = (s: string, n = 16) => s.split(/[，。；;,、]/)[0].replace(/\s+/g, '').slice(0, n);

export function detectPlatform(u: string): string {
  return /xhslink|xiaohongshu/.test(u) ? '小红书' : /mp\.weixin|weixin\.qq/.test(u) ? '公众号' : /douyin|v\.dy/.test(u) ? '抖音' : /bilibili|b23\.tv/.test(u) ? 'B 站' : '网页';
}

export const mockProviders: Providers = {
  topics: {
    async fromCase(ctx, { text, imageKeys }) {
      await delay(600);
      const base = first(text || themeOf(ctx), 14);
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
        topic: { title: `${first(themeOf(ctx), 14)}：先看结果，再说为什么`, hook: '结果画面开场，接一句反问', dir: '项目案例', type: 0, heat: 2, k: ctx.persona.att[0], why: `复刻对标的${learn[0] || '开头'}` },
      };
    },
    async fromMaterials(ctx, { keys, note }) {
      await delay(300);
      return { title: note ? note.slice(0, 18) : `这 ${keys.length} 个画面，讲清${first(themeOf(ctx), 10)}`, hook: '用素材里最有动作的一张开场', dir: '项目案例', type: 0, heat: 1, k: keys[0] || ctx.persona.att[0], why: `用了 ${keys.length} 份素材` };
    },
    async angles(_ctx, t) {
      const b = bare(t.title);
      return [{ label: '反常识', title: `${b}，大多数人做反了` }, { label: '清单', title: `${b}：看这 3 个点就够` }, { label: '对比', title: '做对和做错，差在哪一步' },
        { label: '故事', title: '上个项目的业主，一开始并不同意' }, { label: '数据', title: t.hook || `${b}，算一笔账` }];
    },
    async forColumn(_ctx, col, materials) {
      await delay(200);
      const facts = materials.map(m => first(m, 16)).filter(Boolean);
      const f = (i: number, d: string) => facts[i % Math.max(1, facts.length)] ?? d;
      const by: Record<string, string[]> = {
        转化: [`${col.name}：${f(0, '最近完工的这一套')}`, `${f(1, '这个项目')}，业主最满意的是哪一处`, `${col.name}｜预算花在哪，一条讲清`],
        流量: [`${f(0, '这件事')}，大多数人做反了`, `关于${f(1, col.name)}，我只说一句真话`, `${col.name}：看这 3 个点就够`],
        人设: [`${col.name}：${f(0, '我的一天')}`, `为什么我${f(1, '一直做这一行')}`, `${col.name}｜收工以后的我`],
      };
      return (by[col.kind] ?? by.转化).map((title, i) => ({ title: title.slice(0, 40), hook: i === 0 ? '结果画面开场' : '一句反问开场' }));
    },
  },
  copy: {
    async generate(ctx, t, { kind, len, tone, version, materials }) {
      await delay(400);
      const p = ctx.persona, c = catOf(ctx), b = bare(t.title), biz = p.biz[0];
      const base = [
        `先说结论：${b}，关键不在看起来怎么样，而在住进去以后好不好用。`,
        `很多人在这一步吃亏，${t.dir === '知识科普' ? '是因为没人告诉你标准是什么' : '是因为只看了效果图，没想过以后每天怎么用'}。`,
        '我的做法是先问清楚怎么用，再决定怎么做。',
        '每个细节都按这个思路来，能保证住进去几年都省心。',
        `${t.hook ? `${bare(t.hook)}，` : ''}这是我最想让你看到的地方。`,
        '如果你也遇到这种情况，记住一句话：先想清楚怎么用，再决定怎么做。',
      ];
      const fx: Record<string, (s: string) => string> = {
        亲切: s => s, 专业: s => s.replace('我的做法是', '我们的方案是'),
        犀利: s => s.replace('很多人在这一步吃亏', '说句不好听的，大多数人在这一步吃亏'), 幽默: s => s.replace('先说结论', '先交代一下案发现场'),
      };
      // 有知识库素材：用素材里的具体内容替换通用句（模型版会按素材改写成口语）
      const mats = (materials ?? []).map(m => m.text.replace(/\s+/g, '').slice(0, 60)).filter(Boolean);
      if (mats.length) base.splice(1, mats.length, ...mats.map((m, i) => (i === 0 ? `说个真事：${m}` : m)));
      let body = base.slice(0, PARA[len] ?? 4).map(fx[tone]);
      if (version > 1) body = body.slice(1).concat(body[0]);
      const fam = FAMILIES[biz.tpl];
      const titles = [t.title, `${b}｜${first(themeOf(ctx), 12)}`, `${ctx.positioning.aud[0] ?? '准备装修的你'}一定要看：${b}`];
      const hooks = [`${bare(t.hook || b)}。`, `你是不是也以为，${b}很简单？`, `做了这么多年${CATS[Math.max(0, c)]}，关于${b}，我只说一句真话。`];
      return {
        topicId: t.id, kind, len, tone, titles, title: titles[(version - 1) % 3], hooks, hook: hooks[(version - 1) % 3],
        body, shots: body.map((_, i) => fam[Math.min(i + 1, fam.length - 1)].d),
        cta: `${goalOf(ctx)}，我帮你看看能怎么做。`,
        tags: [`#${CATS[Math.max(0, c)]}`, `#${t.dir}`, `#${biz.n}`, '#装修', '#家居灵感'], live: 62, version,
      };
    },
    async rewrite(_ctx, d, how, hook) { await delay(200); return rewriteLocal(d, how, hook); },
    async diagnose(ctx, qa) {
      await delay(500);
      const all = qa.map(x => x.a).join('；'), p = ctx.persona, c = Math.max(0, catOf(ctx));
      const has = (re: RegExp) => re.test(all);
      // 只认「多少平的别墅 / 大平层 / 项目」，工厂、展厅的面积不算
      const big = all.match(/(\d{3,4})\s*(?:平|㎡)(?:以上)?(?:的)?(?:别墅|大平层|大宅|房子|项目)/)?.[1];
      const years = all.match(/(\d{1,2})\s*年/)?.[1];
      const hobby = all.match(/(旅行|旅游|钓鱼|摄影|跑步|徒步|收藏|喝茶|骑行|露营|老木头|古董)/)?.[1];
      const style = all.match(/(意式|老钱|侘寂|法式|现代|极简|中古|新中式|原木)/)?.[1];
      const craft = all.match(/(护墙板|木作|全屋定制|橱柜|岩板|瓷砖|软装|门窗|地板|别墅|大平层|老房)/)?.[1];
      const pro = [big ? `${big}平以上大宅` : craft ? `${craft}` : CATS[c], years ? `${years}年一线经验` : '懂施工细节', style ? `${style}风格` : p.biz[0].n].filter(Boolean);
      const personality = [has(/不同|反|错|其实/) ? '敢下判断' : '说话实在', has(/业主|客户/) ? '站在业主这边' : '重细节', hobby ? `爱${hobby}` : '有生活感'];
      const brand = [style ? `${style}生活方式` : '高品质交付', has(/工厂|自己有|代理|品牌/) ? '源头工厂' : '本地口碑'];
      const name = ctx.positioning.name || '我';
      return {
        tags: { personality, pro, brand },
        position: `${pro[0]}方向的${p.n}，只讲真实案例和踩过的坑`,
        account: qa.find(x => x.q.includes('账号'))?.a ? '现有内容偏零散：案例和日常混在一起，没有固定栏目，观众记不住你是谁。' : '还没给账号信息，补一下主页截图可以拆得更准。',
        visual: `封面统一用实景大图 + 一行大字；主色跟着${style ?? '你的作品'}走，少用花字。`,
        nicknames: [`${name}｜${pro[0]}`, `${name}说${p.n.slice(0, 2)}`],
        bio: `${pro.slice(0, 2).join(' · ')}\n只讲真实案例和踩过的坑\n${goalOf(ctx)}`,
        columns: [
          { name: `${pro[0]}案例合集`.slice(0, 20), kind: '转化', type: 'tour', perWeek: 1, why: '你反复提到这类项目，最能带来咨询' },
          { name: `${style ?? p.n}观点`.slice(0, 20), kind: '流量', type: 'talk', perWeek: 2, why: '你有自己的判断，短口播最容易打开流量' },
          { name: '工地实拍', kind: '转化', type: 'real', perWeek: 1, why: '现场素材最真实，建立信任' },
          { name: hobby ? `${hobby}里的设计` : '我的一天', kind: '人设', type: 'vlog', perWeek: 1, why: '让观众认识你这个人，不只是你的作品' },
        ],
      };
    },
    async footage(ctx, clips, idea) {
      await delay(400);
      const open = idea ? `${idea.replace(/[。！？]$/, '')}，带你看一下。` : '今天带你看一下我们的现场。';
      const mid = ['先看这里，{x}。', '再往里走，{x}。', '注意这个细节，{x}。', '这一步很多人会忽略，{x}。', '还有这里，{x}。'];
      // 说明来自文件名时：括号里是用户自己起的名字，只用它，不编画面
      const lines = clips.map((c, i) => {
        const x = c.note.match(/（(.+)）/)?.[1] ?? c.note.replace(/^一[段张](\d+(\.\d+)? 秒的)?(视频|照片)：?/, '');
        if (i === 0) return open;
        if (i === clips.length - 1) return `做对了，住进去才省心。${goalOf(ctx)}。`;
        return mid[(i - 1) % mid.length].replace('{x}', x);
      });
      return { title: (idea || lines[0]).replace(/[，。！？].*$/, '').slice(0, 24), lines };
    },
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
      return `今天带大家看一下我们刚完工的项目。最花心思的是收纳和细节，用了三年还是这个样子。${goalOf(ctx)}，我帮你看看。`;
    },
  },
  tts: mockTts,
  vision: null,
};
