// 知识库与 AI 面诊：知识库按条存「能讲出来的素材」，写文案时由系统挑素材、轮换使用（不让模型自己挑，避免每条都说「十年」）。
// 规则前后端共用。
export type KbSection = 'personal' | 'pro' | 'brand';
export type KbKind = 'story' | 'opinion' | 'detail' | 'quote' | 'resume' | 'habit' | 'avoid';
export const SECTION_NAME: Record<KbSection, string> = { personal: '个人', pro: '专业', brand: '品牌' };
export const SECTION_HINT: Record<KbSection, string> = { personal: '履历、创业经历、兴趣爱好、平时最喜欢做的事', pro: '做这行多少年、代理什么品牌、做过的案例和楼盘、扎根哪里、和谁合作过', brand: '品牌的调性和风格、和别家的区别' };
export const KIND_NAME: Record<KbKind, string> = { story: '故事', opinion: '观点', detail: '细节', quote: '客户原话', resume: '履历', habit: '说话习惯', avoid: '不说的话' };
export const KIND_HINT: Record<KbKind, string> = {
  story: '一个案例的经过和结果，越具体越好', opinion: '你的主张、反常识的判断', detail: '数字、工艺、材料、现场细节',
  quote: '业主或客户说过的原话', resume: '资历、奖项、年限——最多偶尔提一次', habit: '口头禅、常用说法（只做语气参考，不写进内容）', avoid: '不想在视频里说的话题或词',
};

export interface KbItem { id: string; section: KbSection; kind: KbKind; text: string; tags: string[]; source: string; used: number; lastUsed: string | null; createdAt: string }

/** 按中文双字切词，粗略算两段文字有多相关（够用，不依赖向量库） */
export function grams(s: string): Set<string> {
  const t = String(s || '').replace(/[\s，。、！？!?,.;；:：「」“”"'（）()…—\-#]/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
export function relevance(a: string, b: string): number {
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let n = 0; A.forEach(g => { if (B.has(g)) n++; });
  return n / Math.sqrt(A.size * B.size);
}

/**
 * 写一条文案要用哪几条素材：
 * - 只从故事、观点、细节、客户原话、履历里挑；说话习惯只当语气参考，不说的话当禁区；
 * - 越相关越优先，最近用过的往后排，用得越多越往后排；
 * - 履历最多 1 条，而且最近 4 次写文案里用过履历就不再用（「十年」不会每条都出现）；
 * - 默认挑 3 条。
 */
export function pickMaterials(items: KbItem[], topic: string, o: { n?: number; recentResume?: boolean } = {}): KbItem[] {
  const n = o.n ?? 3;
  const pool = items.filter(i => i.kind !== 'habit' && i.kind !== 'avoid');
  const ts = (i: KbItem) => (i.lastUsed ? Date.parse(i.lastUsed) : 0);
  const newest = Math.max(1, ...pool.map(ts));
  const score = (i: KbItem) => relevance(i.text + i.tags.join(''), topic) * 3 + (i.kind === 'story' || i.kind === 'detail' ? 0.4 : 0) - i.used * 0.15 - (ts(i) && ts(i) >= newest - 36e5 ? 1 : 0);
  const sorted = [...pool].sort((a, b) => score(b) - score(a));
  const out: KbItem[] = [];
  for (const i of sorted) {
    if (out.length >= n) break;
    if (i.kind === 'resume' && (o.recentResume || out.some(x => x.kind === 'resume'))) continue;
    out.push(i);
  }
  return out;
}

/** AI 腔：生成后自检，命中就改一次 */
export const AI_CLICHES = ['不仅', '更是', '在当今', '随着', '总而言之', '综上所述', '让我们一起', '值得一提的是', '赋能', '打造极致', '完美诠释', '匠心', '品质生活'];
export const cliches = (s: string) => AI_CLICHES.filter(w => s.includes(w));

/* ---------- AI 面诊 ---------- */
export interface DiagQuestion { id: string; section: KbSection; kind: KbKind; q: string; hint: string }
/** 面诊提问：按大哲一对一定位的三块来问；回答都会存进知识库 */
export const DIAG_QUESTIONS: DiagQuestion[] = [
  { id: 'p1', section: 'personal', kind: 'story', q: '先聊聊你自己：怎么入的这一行？中间有没有一个转折点？', hint: '比如：原来做什么、为什么出来单干、第一单是怎么来的' },
  { id: 'p2', section: 'personal', kind: 'detail', q: '工作之外你最喜欢做什么？', hint: '旅行、钓鱼、收藏、带娃……越具体越好，会用来做人设栏目' },
  { id: 'p3', section: 'personal', kind: 'opinion', q: '你现在的账号发了些什么？你自己最满意、最不满意的各是哪一条？', hint: '可以贴主页链接或截图' },
  { id: 'r1', section: 'pro', kind: 'resume', q: '你做这行多少年了？做过多少个项目、拿过什么奖？', hint: '这类资历会存成「履历」，文案里偶尔用一次' },
  { id: 'r2', section: 'pro', kind: 'story', q: '讲一个你最得意的案例：业主是谁、难在哪、你怎么解决的、结果怎样？', hint: '面积、预算、风格、业主说的话都可以' },
  { id: 'r3', section: 'pro', kind: 'opinion', q: '你在这行有什么和别人不一样的观点？哪件事大多数人做错了？', hint: '这类观点最适合做流量口播' },
  { id: 'r4', section: 'pro', kind: 'quote', q: '业主或客户说过哪句话让你印象最深？', hint: '原话就行，不用修饰' },
  { id: 'b1', section: 'brand', kind: 'detail', q: '你代理或主做的是什么品牌？它的风格和调性是什么？', hint: '比如：意式、老钱风、侘寂；和别家最大的区别' },
  { id: 'b2', section: 'brand', kind: 'detail', q: '你主要做哪里、做什么样的客户？', hint: '城市、楼盘、面积段、预算段' },
];

export interface DiagColumn { name: string; kind: '流量' | '转化' | '人设'; type: string; perWeek: number; why: string }
export interface DiagReport {
  tags: { personality: string[]; pro: string[]; brand: string[] };
  /** 一句话定位 */
  position: string;
  account: string; visual: string; nicknames: string[]; bio: string;
  columns: DiagColumn[];
  createdAt: string;
}
export interface Diagnosis { unlocked: boolean; answers: Record<string, string>; report: DiagReport | null }
/** 解锁 AI 运营（含 AI 面诊）的点数（示意，正式价格大哲定） */
export const DIAG_PRICE = 300;
