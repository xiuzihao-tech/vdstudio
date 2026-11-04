// 视频 IP 新版（苗苗原型）：大哲诊断账号 → 安排发布计划 ← 一键生成视频。两个入口（付费诊断 / 直接出片），最后都回到发布计划。
// 这里放前后端共用的规则：成片类型和价格、AI 怎么推荐、分镜怎么排、诊断问题和结果、选题怎么排进计划。

/* ---------- 成片类型 ---------- */
export type VType = 'tour' | 'explain' | 'talk' | 'before' | 'case' | 'product' | 'site' | 'vlog';
export interface VTypeSpec {
  id: VType; n: string; pts: number; secs: number;
  /** 一句话说清楚这类片长什么样 */
  d: string;
  /** 需要什么素材 */
  need: string;
  /** 默认要不要人声：avatar 数字人出镜；voice 只要声音；none 只放音乐 */
  face: 'avatar' | 'voice' | 'none';
  /** 示意图：一条片按顺序由哪几段组成 */
  parts: [kind: 'avatar' | 'scene' | 'pair' | 'macro', label: string][];
  bgm: string;
  tag?: string;
}
export const VTYPES: VTypeSpec[] = [
  { id: 'tour', n: '空间漫游', pts: 80, secs: 45, d: '不说话，镜头一路走完整套房，配音乐和一句句字幕', need: '照片或视频 5–10 张', face: 'none', parts: [['scene', '入户'], ['scene', '客厅'], ['scene', '餐厨'], ['scene', '主卧'], ['scene', '收尾']], bgm: '轻钢琴', tag: '先上线' },
  { id: 'explain', n: '空间讲解', pts: 70, secs: 50, d: '边走边讲设计判断：先给结论，再讲三处细节', need: '照片或视频 + 一段想法', face: 'avatar', parts: [['avatar', '开场给判断'], ['scene', '细节一'], ['scene', '细节二'], ['scene', '细节三'], ['avatar', '结论']], bgm: '轻电子', tag: '大哲式' },
  { id: 'talk', n: '真人口播', pts: 60, secs: 38, d: '数字人照着文案口播，AI 生成空间画面做穿插，配图字幕全自动', need: '一段文案', face: 'avatar', parts: [['avatar', '开场出镜'], ['scene', '画面穿插'], ['scene', '画面穿插'], ['scene', '画面穿插'], ['avatar', '收尾出镜']], bgm: '轻钢琴' },
  { id: 'before', n: '改造前后', pts: 90, secs: 30, d: '同机位前后对比，卡点一切，三秒抓住眼球', need: '改造前后各几张', face: 'voice', parts: [['pair', '客厅前后'], ['pair', '厨房前后'], ['pair', '卧室前后'], ['scene', '全屋收尾']], bgm: '城市律动' },
  { id: 'case', n: '案例故事', pts: 100, secs: 60, d: '一套房从需求到落地讲成一个故事，有旁白有细节', need: '案例照片 + 业主需求', face: 'voice', parts: [['scene', '业主的难题'], ['scene', '设计判断'], ['macro', '关键细节'], ['scene', '住进去以后'], ['avatar', '一句总结']], bgm: '弦乐氛围' },
  { id: 'product', n: '产品种草', pts: 65, secs: 30, d: '一个卖点讲透：特写、对比、用在家里的样子', need: '产品照片', face: 'voice', parts: [['macro', '卖点特写'], ['pair', '和普通款对比'], ['scene', '用在家里'], ['avatar', '到店看']], bgm: '轻电子' },
  { id: 'site', n: '工地记录', pts: 55, secs: 40, d: '今天到哪个阶段、看哪几处、标准是什么', need: '工地照片或视频', face: 'voice', parts: [['scene', '工地入口'], ['macro', '验收点'], ['macro', '验收点'], ['avatar', '一句结论']], bgm: '城市律动' },
  { id: 'vlog', n: 'Vlog', pts: 70, secs: 45, d: '跟着本人过一天：出门、工地、见客户、收工', need: '随手拍的几段', face: 'voice', parts: [['scene', '早上出门'], ['scene', '工地'], ['scene', '见客户'], ['scene', '收工']], bgm: '城市律动' },
];
export const vtype = (id: string | null | undefined): VTypeSpec => VTYPES.find(t => t.id === id) ?? VTYPES[2];
export const AUTO = 'auto';

/** 「成品长这样」：按模板分类放样片（像即梦的模板效果），创意模板不定期加 */
export const SAMPLE_CATS = ['全部', '空间漫游', '真人口播', '改造前后', '空间讲解', '爆款复刻', '单品展示', '案例讲解', '创意模板', 'TVC 大片'] as const;
export type SampleCat = typeof SAMPLE_CATS[number];
export interface Sample { id: string; cat: SampleCat; type: VType; t: string; d: string; dur: string; play?: string; ask?: number; scenes: string[]; custom?: boolean; soon?: boolean }
export const SAMPLES: Sample[] = [
  { id: 's1', cat: '空间漫游', type: 'tour', t: '龙湖锦璘原著·一镜到底', d: '意式极简·全屋漫游', dur: '00:45', play: '2.1w', ask: 7, scenes: ['entry', 'live', 'kit', 'bed'] },
  { id: 's2', cat: '真人口播', type: 'talk', t: '装修最容易踩的3个坑', d: '数字人口播·观点', dur: '00:38', play: '1.3w', ask: 4, scenes: ['person', 'live', 'kit', 'person'] },
  { id: 's3', cat: '改造前后', type: 'before', t: '140㎡老房焕新', d: '同机位前后对比', dur: '00:30', play: '3.4w', ask: 11, scenes: ['old', 'new', 'old', 'new'] },
  { id: 's4', cat: '空间漫游', type: 'tour', t: '华润悦府·样板间夜景', d: '案场高级感·长镜头', dur: '00:40', play: '9,820', ask: 3, scenes: ['sales', 'hotel', 'bed', 'ext'] },
  { id: 's5', cat: '空间讲解', type: 'explain', t: '这个客厅为什么看着贵', d: '大哲式·边走边讲', dur: '00:28', scenes: ['person', 'live', 'stone', 'person'], soon: true },
  { id: 's6', cat: '爆款复刻', type: 'before', t: '一秒变装·毛坯到入住', d: '卡点转场·爆款同款', dur: '00:15', play: '5.6w', ask: 9, scenes: ['old', 'new'] },
  { id: 's7', cat: '爆款复刻', type: 'tour', t: '跟着节拍看全屋', d: '音乐卡点·一拍一个空间', dur: '00:20', play: '2.8w', ask: 5, scenes: ['entry', 'live', 'kit', 'bed', 'soft'] },
  { id: 's8', cat: '单品展示', type: 'product', t: '电视柜 360° 转一圈', d: '单品旋转展示', dur: '00:12', scenes: ['soft', 'stone'] },
  { id: 's9', cat: '单品展示', type: 'product', t: '两张图做出柜门开合', d: '两张照片生成简单动态', dur: '00:10', scenes: ['store', 'soft'] },
  { id: 's10', cat: '案例讲解', type: 'case', t: '学员案例·240㎡法式', d: '文案 + 旁白讲一套房', dur: '01:00', play: '1.1w', ask: 6, scenes: ['ext', 'live', 'stone', 'bed'] },
  { id: 's11', cat: '创意模板', type: 'tour', t: '家变成手绘动画', d: '生成动画·不定期上新', dur: '00:15', scenes: ['live', 'kit'] },
  { id: 's12', cat: '创意模板', type: 'tour', t: '微缩模型俯瞰全屋', d: '移轴微缩效果', dur: '00:15', scenes: ['live', 'bed'] },
  { id: 's13', cat: 'TVC 大片', type: 'case', t: '品牌 TVC·木作工艺', d: '广告大片·可定制', dur: '01:30', scenes: ['ref', 'stone', 'sales'], custom: true },
];

/* ---------- 这条怎么出 ---------- */
export const OPT = {
  dur: ['AI 推荐', '15 秒', '30 秒', '45 秒', '60 秒'],
  ratio: ['9:16 竖屏', '3:4 竖屏', '1:1 方形', '16:9 横屏'],
  font: ['思源黑体', '思源宋体', '阿里巴巴普惠体', '站酷快乐体'],
  bgm: ['轻钢琴', '城市律动', '弦乐氛围', '轻电子', '不要音乐'],
} as const;
export const FONT_NOTE: Record<string, string> = { 思源黑体: '可免费商用', 思源宋体: '可免费商用', 阿里巴巴普惠体: '可免费商用', 站酷快乐体: '可免费商用' };

/** 数字人：自己的两个（来自「管理我的素材」）+ 系统形象（没有自己的也能出镜） */
export interface AvatarLook { id: string; n: string; d: string; mine?: boolean; skin: string; hair: string; top: string; bg: string; bg2: string; hairStyle: 'short' | 'bob' | 'long' | 'crop'; glasses?: boolean }
export const AVATARS: AvatarLook[] = [
  { id: 'me-clone', n: '我·真人分身', d: '用你 1 分钟正脸视频做的，只改嘴型', mine: true, skin: '#E2B996', hair: '#2A2420', top: '#1F2A36', bg: '#D9CDBB', bg2: '#B9A78E', hairStyle: 'crop' },
  { id: 'me-photo', n: '我·照片形象', d: '一张正脸照片驱动', mine: true, skin: '#E2B996', hair: '#2A2420', top: '#3A3A3A', bg: '#E7E1D6', bg2: '#CFC5B4', hairStyle: 'crop', glasses: true },
  { id: 'lin', n: '林设计师', d: '女 · 干练 · 浅灰西装 · 展厅背景', skin: '#F0C9A8', hair: '#1D1A18', top: '#8E8F91', bg: '#EFEAE2', bg2: '#D8CDBD', hairStyle: 'bob' },
  { id: 'zhou', n: '周老师', d: '男 · 沉稳 · 深色衬衫 · 书房背景', skin: '#D9A986', hair: '#3B3530', top: '#2D3A2F', bg: '#C9B79C', bg2: '#8F7A5E', hairStyle: 'short', glasses: true },
  { id: 'jie', n: '阿杰', d: '男 · 年轻 · 工装 · 工地背景', skin: '#D6A27C', hair: '#14110F', top: '#C98A2B', bg: '#BEB8AD', bg2: '#8F887C', hairStyle: 'crop' },
  { id: 'xia', n: '夏主理人', d: '女 · 亲和 · 米色针织 · 客厅背景', skin: '#F2CDB0', hair: '#4A3426', top: '#D8C4A6', bg: '#F0E6D8', bg2: '#D9C3A6', hairStyle: 'long' },
];
export const avatarOf = (id: string | null | undefined) => AVATARS.find(a => a.id === id) ?? AVATARS[0];
export const VOICES = ['数字人本人声音', 'AI 配音·沉稳男声', 'AI 配音·知性女声', '不要人声，只放音乐'] as const;

/* ---------- 一键生成视频：草稿 ---------- */
export interface Mat { id: string; name: string; kind: 'photo' | 'video'; k: string; url?: string | null; mime?: string | null }
export interface Shot { id: string; title: string; line: string; tip: string; k: string; mat?: Mat | null; avatar?: boolean; secs: number }
export interface MakeDraft {
  step: 1 | 2 | 3 | 4;
  mats: Mat[]; copy: string;
  /** 用户在第 1 步选的类型；auto = 交给 AI */
  pick: VType | typeof AUTO;
  /** 实际用的类型（第 2 步 AI 推荐或用户换的） */
  type: VType;
  face: 'avatar' | 'none'; avatar: string;
  opt: { dur: string; ratio: string; font: string; bgm: string; voice: string };
  shots: Shot[];
  title: string; caption: string; tags: string[]; cover: 'A' | 'B' | 'C';
  /** 从发布计划某一条来的 */
  planId?: string | null;
  cost: number; rendered?: boolean; updatedAt: string;
}

export const chars = (s: string) => s.replace(/\s/g, '').length;
/** 每秒大约念 4.5 个字 */
export const secsOf = (line: string) => Math.max(3, Math.round(chars(line) / 4.5));
export function splitLines(copy: string): string[] {
  const out: string[] = [];
  for (const p of copy.split(/\n+/).flatMap(l => l.match(/[^。！？!?；;]+[。！？!?；;]*/g) ?? []).map(s => s.trim()).filter(Boolean)) {
    if (out.length && chars(p) < 8) out[out.length - 1] += p; else out.push(p);
  }
  return out;
}
const durSecs = (d: string) => /(\d+)/.test(d) ? Number(d.match(/(\d+)/)![1]) : null;

/** 第 2 步：AI 看完素材和文案，推荐做哪一类、怎么出 */
export interface Advice { type: VType; why: string; chips: [string, string][]; fit: 'ok' | 'thin'; fitText: string }
export function advise(d: Pick<MakeDraft, 'mats' | 'copy' | 'pick'>): Advice {
  const photos = d.mats.filter(m => m.kind === 'photo').length, videos = d.mats.filter(m => m.kind === 'video').length, media = photos + videos;
  const has = chars(d.copy) > 0, s = d.copy.slice(0, 400);
  let type: VType;
  if (d.pick !== AUTO) type = d.pick;
  else if (!media) type = /改造|前后|翻新/.test(s) ? 'before' : 'talk';
  else if (!has) type = /前后|改造/.test(d.mats.map(m => m.name).join()) ? 'before' : 'tour';
  else if (/改造|前后|翻新|焕新/.test(s)) type = 'before';
  else if (/工地|验收|施工|水电|防水/.test(s)) type = 'site';
  else if (/产品|板材|岩板|卖点|新品/.test(s)) type = 'product';
  else if (/业主|故事|住进去|回访/.test(s)) type = 'case';
  else type = 'explain';
  const t = vtype(type), mediaTxt = [photos && `${photos} 张照片`, videos && `${videos} 段视频`].filter(Boolean).join('、');
  const why = !media && has ? '你只给了文案，没给画面。没关系——我用数字人照着念，再让 AI 生成空间画面做穿插，字幕自动配。'
    : media && !has ? `你给了${mediaTxt}，没给文案。${type === 'tour' ? '我按画面排一条「空间漫游」：镜头一路走完，配音乐和一句句字幕，不用说话。' : `我按画面排一条「${t.n}」，旁白我先按画面写一版，第 3 步可以改。`}`
      : media && has ? `素材和文案都有。我把每句文案配一张你的照片，缺的镜头 AI 补，字幕自动配。`
        : '还没有素材和文案。可以先按样片做：画面 AI 生成，文案我来写。';
  const needMedia = ['tour', 'before', 'case', 'site', 'product'].includes(type);
  const fit = needMedia && media < 3 ? 'thin' : 'ok';
  return {
    type, why, fit,
    fitText: fit === 'ok' ? '素材匹配，可以出片' : `素材偏少：缺的画面会用 AI 生成，真实感会弱一些，最好补几张你的照片`,
    chips: [
      ['文案', has ? '已提供' : t.face === 'none' ? '不需要' : 'AI 写'],
      ['画面', media ? `你的素材 ${media} 份` : 'AI 生成'],
      ['声音', t.face === 'avatar' ? '数字人' : t.face === 'voice' ? 'AI 配音' : '只放音乐'],
      ['字幕', '自动'],
    ],
  };
}
export function costOf(type: VType, dur: string): number {
  const t = vtype(type), s = durSecs(dur);
  return s ? Math.max(20, Math.round(t.pts * s / t.secs / 5) * 5) : t.pts;
}

/** 每类片的镜头模板：标题、场景、拍摄建议 */
const SCENES: Record<VType, [string, string, string][]> = {
  tour: [['门口一镜推进·玄关', 'entry', '站在门口往里推，竖屏拍 3 秒'], ['客厅全景·横移', 'live', '站在餐厅往客厅推一张全景'], ['餐厨·走动视频', 'kit', '从餐厅走到岛台，边走边拍 6 秒'], ['主卧·细节特写', 'bed', '贴近床头墙拍一张特写'], ['材质特写', 'stone', '侧光贴近拍纹理'], ['收尾·窗景', 'hotel', '对着窗外拍 3 秒']],
  explain: [['开场·数字人出镜', 'person', ''], ['客厅全景·横移', 'live', '站在餐厅往客厅推一张全景'], ['细节·材质特写', 'stone', '贴近拍材质和收口'], ['餐厨·走动视频', 'kit', '从餐厅走到岛台，边走边拍 6 秒'], ['收尾·数字人出镜', 'person', '']],
  talk: [['门口一镜推进·玄关', 'entry', '站在门口往里推，竖屏拍 3 秒'], ['客厅全景·横移', 'live', '站在餐厅往客厅推一张全景'], ['餐厨·走动视频', 'kit', '从餐厅走到岛台，边走边拍 6 秒'], ['主卧·细节特写', 'bed', '贴近洞石纹理拍一张特写'], ['收尾·数字人出镜', 'person', '']],
  before: [['客厅·改造前', 'old', '和改造后站同一个位置拍'], ['客厅·改造后', 'new', '和改造前站同一个位置拍'], ['厨房·前后对比', 'kit', '同机位前后各一张'], ['卧室·前后对比', 'bed', '同机位前后各一张'], ['全屋收尾', 'live', '最满意的一个角度']],
  case: [['业主的难题', 'old', '改之前的现场照片'], ['设计判断·全景', 'live', '最能说明设计思路的一张全景'], ['关键细节', 'stone', '一处工艺或材质特写'], ['住进去以后', 'bed', '有生活痕迹的一张'], ['收尾·一句总结', 'person', '']],
  product: [['卖点特写', 'stone', '微距拍纹理或结构'], ['对比·普通款', 'store', '两样并排放，同一光线'], ['用在家里', 'live', '装好以后的全景'], ['收尾·到店看', 'person', '']],
  site: [['工地入口·交代阶段', 'site', '站在入户门拍一张全景'], ['验收点一', 'site', '贴近拍读数或尺子'], ['验收点二', 'site', '贴近拍收口'], ['收尾·一句结论', 'person', '']],
  vlog: [['早上出门', 'ext', '出门那一刻拍 3 秒'], ['到工地', 'site', '边走边拍'], ['见客户', 'store', '展厅或会议室一角'], ['收工', 'hotel', '傍晚的窗景']],
};
/** 没有文案时，按类型给的旁白 / 字幕 */
const LINES: Record<VType, string[]> = {
  tour: ['推开门，先看玄关这一面。', '客厅没有吊顶，层高全留给了光。', '餐厨打通，动线短了一大截。', '主卧只留一面材质墙。', '住进来，就是这样的日常。'],
  explain: ['这个客厅看着贵，不是因为材料贵。', '第一，整面墙没做复杂造型。', '第二，收口全部做到了 1 毫米以内。', '第三，灯光只用了三种色温。', '想看你家能做成什么样，评论区扣 1。'],
  talk: ['这套140㎡意式极简，我最想让你看两个细节。', '整面岩板没有做复杂造型，靠体块穿插撑住气场。', '开放式餐厨把动线缩短了4米，做饭不再绕圈。', '床头这面洞石，是整套房子最贵也最值的一笔。', '想看你家能做成什么样，评论区扣1，发你清单。'],
  before: ['这是改之前的客厅。', '同一个角度，改完是这样。', '厨房拆了一面墙。', '卧室只换了软装。', '总共花了 28 万，工期 75 天。'],
  case: ['业主说，家里永远收拾不完。', '我做的第一个决定，是把收纳全藏进墙里。', '这道柜门收口，差 1 毫米都看得出来。', '住进去半年，她说终于不用天天收拾了。', '好设计，是让人住得省心。'],
  product: ['这块板，指甲划不出印子。', '和普通款放一起，差别一眼就看出来。', '装在家里，是这个效果。', '想摸实物，来展厅看。'],
  site: ['今天到了水电验收。', '打压 0.8 兆帕，保压 30 分钟不掉。', '线管横平竖直，弯头全部用弹簧弯。', '这一步做好了，后面十年不出问题。'],
  vlog: ['早上 6 点，我又到工地了。', '今天要看柜体进场。', '下午回展厅见一位老客户。', '收工，明天继续。'],
};
/** target：成片目标秒数，镜头时长按台词长短分 */
export function buildShots(d: Pick<MakeDraft, 'mats' | 'copy' | 'type' | 'face'>, target?: number): Shot[] {
  const tpl = SCENES[d.type];
  let lines = splitLines(d.copy);
  if (!lines.length) lines = LINES[d.type];
  // 镜头数跟着句子走，最多 8 镜
  const n = Math.min(8, Math.max(lines.length, 3));
  const merged = lines.length > n ? [...lines.slice(0, n - 1), lines.slice(n - 1).join('')] : lines;
  const media = [...d.mats];
  const raw = merged.map(secsOf), sum = raw.reduce((a, b) => a + b, 0);
  const scale = target ? target / sum : 1;
  return merged.map((line, i) => {
    const last = i === merged.length - 1;
    const t = last && tpl[tpl.length - 1][1] === 'person' ? tpl[tpl.length - 1] : tpl[Math.min(i, tpl.length - (tpl[tpl.length - 1][1] === 'person' ? 2 : 1))];
    const avatar = t[1] === 'person' && d.face === 'avatar';
    const mat = avatar ? null : media.shift() ?? null;
    return { id: `sh${i + 1}`, title: t[1] === 'person' && !avatar ? t[0].replace('数字人出镜', '空镜收尾') : t[0], line, tip: t[2] || '用一张能代表这套房的照片', k: t[1] === 'person' && !avatar ? 'live' : t[1], mat, avatar, secs: Math.max(2, Math.round(raw[i] * scale)) };
  });
}
export const shotReady = (s: Shot) => !!s.mat || !!s.avatar;
export const totalSecs = (shots: Shot[]) => shots.reduce((a, s) => a + s.secs, 0);
export const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;
export function newDraft(now: string): MakeDraft {
  return { step: 1, mats: [], copy: '', pick: AUTO, type: 'talk', face: 'avatar', avatar: 'me-clone', opt: { dur: 'AI 推荐', ratio: 'AI 推荐', font: 'AI 推荐', bgm: 'AI 推荐', voice: 'AI 推荐' }, shots: [], title: '', caption: '', tags: [], cover: 'A', cost: 60, updatedAt: now };
}

/** 第 4 步：标题、文案、话题 */
export function pack(d: Pick<MakeDraft, 'copy' | 'type' | 'shots'>, city = '沈阳'): { title: string; caption: string; tags: [string, string[]][] } {
  const first = (d.shots[0]?.line ?? '').replace(/[。！？!?，,]$/, '');
  const t = vtype(d.type);
  const title = (first.length > 6 ? first : `${t.n}｜${first || '这套房我最想让你看两处'}`).slice(0, 30);
  const body = d.shots.slice(1, 4).map(s => s.line.replace(/[。]$/, '')).join('，');
  const caption = `${first}。${body ? `${body}。` : ''}\n你家装修卡在哪一步？评论区告诉我，挑 3 个免费帮你看。`;
  return {
    title, caption,
    tags: [['地域', [`#${city}装修`, `#${city}设计师`, `#${city}大平层`]], ['品类', [`#${t.n === '真人口播' ? '意式极简' : t.n}`, '#大平层设计', '#全案落地', '#空间设计']], ['流量', ['#装修避坑', '#装修灵感', '#家的样子']]],
  };
}

/* ---------- 安排发布计划 ---------- */
export type PlanStatus = '已排期' | '待确认' | '待生成' | '已发布';
export interface PlanItem {
  id: string; title: string; type: string; account: string; column: string;
  /** 'YYYY-MM-DDTHH:mm' */
  when: string; status: PlanStatus;
  from: 'sample' | 'diag' | 'video';
  why?: string;
  stats?: { play: number; like: number; ask: number };
}
export const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
/** '周四19:00'；今天往后 7 天以外的写「下周一」 */
export function whenLabel(when: string, today: string): string {
  const day = when.slice(0, 10), time = when.slice(11, 16);
  const diff = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5);
  const wd = WD[new Date(`${day}T00:00:00Z`).getUTCDay()];
  if (diff === 0) return `今天${time}`;
  if (diff === 1) return `明天${time}`;
  if (diff > 1 && diff < 7) return `${wd}${time}`;
  if (diff >= 7 && diff < 14) return `下${wd}${time}`;
  return `${Number(day.slice(5, 7))}月${Number(day.slice(8))}日 ${time}`;
}
export const inWeek = (when: string, today: string) => when.slice(0, 10) >= today && when.slice(0, 10) <= addDays(today, 6);
export function weekStats(items: PlanItem[], today: string) {
  const w = items.filter(i => inWeek(i.when, today) && i.status !== '已发布');
  return { total: w.length, done: w.filter(i => i.status === '已排期').length, confirm: w.filter(i => i.status === '待确认').length, gen: w.filter(i => i.status === '待生成').length, accounts: new Set(items.map(i => i.account)).size };
}
export const ACCOUNTS = ['三哥看豪宅', '三哥设计笔记', '三哥本人号'];
export function samplePlan(today: string): PlanItem[] {
  const rows: [string, string, number, string, number, string, PlanStatus][] = [
    ['龙湖锦璘原著·一镜到底', '空间漫游', 0, '案例', 1, '19:00', '已排期'],
    ['装修最容易踩的3个坑', '真人口播', 1, '观点', 2, '12:00', '已排期'],
    ['140㎡老房焕新', '改造前后', 0, '案例', 3, '10:00', '待确认'],
    ['新世界卓锦·空间漫游', '空间漫游', 2, '案例', 3, '19:30', '待确认'],
    ['去工地·节点验收', '工地记录', 1, '人设', 4, '15:00', '待生成'],
    ['旅行里的设计·米兰', 'Vlog', 2, '人设', 5, '20:00', '待生成'],
    ['岩板背景墙到底值不值', '真人口播', 1, '观点', 1, '12:00', '已排期'],
    ['华润悦府·样板间夜景', '空间漫游', 0, '案例', 2, '19:00', '已排期'],
    ['业主回访·住进去半年', '案例故事', 2, '人设', 4, '20:00', '已排期'],
    ['意式极简的3个误区', '真人口播', 1, '观点', 5, '12:00', '待确认'],
    ['洞石床头墙怎么做', '产品种草', 0, '案例', 6, '19:00', '待确认'],
    ['收房那天我做的5件事', '工地记录', 2, '人设', 6, '10:00', '待生成'],
    ['设计师的一天', 'Vlog', 2, '人设', 7, '20:00', '待生成'],
  ];
  return rows.map(([title, type, a, column, d, time, status], i) => ({ id: `p${i + 1}`, title, type, account: ACCOUNTS[a], column, when: `${addDays(today, d)}T${time}`, status, from: 'sample' }));
}
/** 「查看作品数据」的示例：已经发出去的 */
export function sampleWorks(today: string): PlanItem[] {
  const rows: [string, string, number, string, number, number, number, number][] = [
    ['140㎡意式极简｜这两个坑我提前避掉了', '真人口播', 1, '观点', -2, 13200, 486, 4],
    ['龙湖天璞·全屋漫游', '空间漫游', 0, '案例', -3, 21400, 902, 7],
    ['老房焕新，28 万改成这样', '改造前后', 0, '案例', -5, 34100, 1650, 11],
    ['早上 6 点的工地', 'Vlog', 2, '人设', -6, 6800, 310, 2],
    ['水电验收，我只看这 3 处', '工地记录', 1, '人设', -8, 9100, 402, 5],
    ['为什么我不建议做全屋吊顶', '真人口播', 1, '观点', -10, 18700, 760, 6],
  ];
  return rows.map(([title, type, a, column, d, play, like, ask], i) => ({ id: `w${i + 1}`, title, type, account: ACCOUNTS[a], column, when: `${addDays(today, d)}T19:00`, status: '已发布', from: 'sample', stats: { play, like, ask } }));
}

/* ---------- 大哲诊断账号 ---------- */
export const DIAG_PRICE = 899;
export const STAGES = ['身份与品牌', '个性抓取', '专业与优势', '愿望与栏目'] as const;
/** 问题方向（苗苗会给正式版，这里先放一版）：每段三问，问完还能接着聊，直到用户说够了 */
export const DIAG_QS: [stage: number, q: string][] = [
  [0, '你的公司名称、主营品牌是什么？在哪个城市？'],
  [0, '做这行多少年了？之前是做什么的？'],
  [0, '你的客户主要在哪个范围？（城市、楼盘、预算）'],
  [1, '朋友和员工平时怎么评价你？说三个词。'],
  [1, '有没有一件事，你特别较真、别人觉得没必要？'],
  [1, '你一天通常怎么过？几点到工地或公司？'],
  [2, '你最擅长做哪类项目？做过最得意的一套是哪个？'],
  [2, '客户最后选你，最常说的理由是什么？'],
  [2, '你的品牌有什么别人比不了的？（规模、展厅、合作方）'],
  [3, '做账号，你最想吸引什么样的客户？'],
  [3, '哪些内容你愿意每周固定拍？（工地、案例、观点、日常）'],
  [3, '有什么是你不想在镜头里讲的？'],
];
export const DIAG_MORE = ['还有想补充的吗？比如最近一个让你印象深的项目，或者客户说过的一句话。', '再聊一个：你觉得同行最常犯的错是什么？', '我这边差不多聊透了。还想说就接着说，说够了点右上角「结束并生成诊断」。'];
export const DEMO_NAME = '盛哥（木里木外）';
export const DEMO_ANSWERS = [
  '我叫盛哥，做木里木外的经销商，在沈阳。',
  '12 年了，木工出身，一步步做到经销商。',
  '主要是沈阳的大平层和别墅，预算一般 200 万以上，很多是法式大宅。',
  '吃苦、自律，员工说我太较真，我说话也直，敢说观点。',
  '收口差 0.5 毫米我都让返工，工人说没人看得出来，我说客户看得出来。',
  '早上 6 点到工地，一周至少跑 3 次工地，晚上回展厅见客户。',
  '最擅长法式大宅的木作，最得意的一套 400 平的法式大宅，木作做了 800 万。',
  '客户说我懂法式，又爱下工地，交给我放心。',
  '木里木外是全国 TOP 级的顶奢木作品牌，100 多家经销商，北京有「原宅」展厅，跟国际设计师事务所合作。',
  '想吸引沈阳做大宅、对品质要求高的客户。',
  '工地每周能拍，案例也有不少，观点我也敢讲。',
  '价格不想在镜头里直接讲。',
];
export interface DiagColumn { n: string; d: string; eg: string; freq: number; src: string; type: VType; ask: string; unit: string }
export interface DiagResult { who: string; tags: { personal: string[]; pro: string[]; brand: string[] }; columns: DiagColumn[] }
export const SHENG: DiagResult = {
  who: '盛哥',
  tags: { personal: ['吃苦耐劳', '自律', '较真', '敢说观点'], pro: ['擅长法式大宅的木作老板', '爱下工地的木作老板'], brand: ['木里木外·全国TOP级顶奢木作品牌', '100+经销商', '北京「原宅」展厅', '合作国际设计师事务所'] },
  columns: [
    { n: '法式大宅品鉴', d: '拆解法式大宅的木作细节与造价逻辑，立“最懂法式大宅”的专业人设', eg: '这套400㎡法式大宅，木作800万花在哪', freq: 1, src: '擅长法式大宅', type: 'explain', ask: '手上能拍的法式大宅有几套？', unit: '套' },
    { n: '工地巡检', d: '每周3次工地实拍，验收标准、收口细节，立“爱下工地”的实干人设', eg: '收口0.5毫米，我验收必看的3个细节', freq: 2, src: '爱下工地', type: 'site', ask: '现在在施工的工地有几个？', unit: '个' },
    { n: '木里木外·品牌说', d: '讲品牌背后的设计师合作、原宅展厅、高定工艺，借顶奢品牌势能给信任', eg: '和国际设计师事务所合作的品牌，凭什么做高定', freq: 1, src: '品牌标签', type: 'talk', ask: '品牌这边能讲的点有几个？（展厅、工艺、合作案例）', unit: '个' },
    { n: '盛哥的工地日记', d: '早6点到工地、和工人较真的日常，用人格特性吸粉，客户最先来这条', eg: '早上6点，我又到工地了', freq: 2, src: '吃苦耐劳·较真', type: 'vlog', ask: '一周能拍几天日常？', unit: '天' },
  ],
};
const PERSONAL = ['吃苦耐劳', '吃苦', '自律', '较真', '敢说', '直爽', '细致', '耐心', '幽默', '靠谱', '执着', '讲究', '爱学习', '有审美', '亲和'];
const clauses = (s: string) => s.split(/[，,。；;、！!？?\n]/).map(x => x.trim()).filter(x => x.length >= 2 && x.length <= 16);
/** 回答 → 三类标签 + 四档栏目（没接大模型时按规则出；接了大模型由 AI 出，格式一样） */
export function diagResult(answers: string[], fallbackName = '我'): DiagResult {
  const all = answers.join('\n');
  if (/木里木外/.test(all)) return SHENG;
  const name = all.match(/我(?:叫|是)([一-龥A-Za-z]{1,4}?)(?:[，,。 ]|做|在|$)/)?.[1] ?? fallbackName;
  const personal = PERSONAL.filter(w => all.includes(w)).slice(0, 4);
  while (personal.length < 3) personal.push(['认真', '爱琢磨', '说到做到'][personal.length]);
  const proSrc = clauses(answers[6] ?? '')[0] ?? clauses(answers[1] ?? '')[0] ?? '做设计';
  const spec = proSrc.replace(/^(最)?擅长(做)?/, '').replace(/的?项目$/, '') || '住宅设计';
  const site = /工地/.test(all);
  const pro = [`擅长${spec}的${/经销|老板/.test(all) ? '老板' : '设计师'}`, site ? '爱下工地' : '讲得清设计判断'];
  const brand = [...clauses(answers[0] ?? '').filter(c => !/^我叫|^我是/.test(c)), ...clauses(answers[8] ?? '')].slice(0, 4);
  if (!brand.length) brand.push('本地口碑');
  const short = spec.slice(0, 6);
  return {
    who: name, tags: { personal, pro, brand },
    columns: [
      { n: `${short}拆解`, d: `拆解${spec}的细节和造价逻辑，立“最懂${short}”的专业人设`, eg: `这套房的钱，花在哪几处`, freq: 1, src: pro[0], type: 'explain', ask: `手上能拍的${short}案例有几套？`, unit: '套' },
      site ? { n: '工地巡检', d: '工地实拍，验收标准、收口细节，立实干人设', eg: '我验收必看的3个细节', freq: 2, src: '爱下工地', type: 'site', ask: '现在在施工的工地有几个？', unit: '个' }
        : { n: '设计判断', d: '一条讲清一个设计判断，先给结论再讲原因', eg: '为什么我不建议做全屋吊顶', freq: 2, src: pro[1], type: 'talk', ask: '你能讲的观点大概有几个？', unit: '个' },
      { n: `${brand[0].slice(0, 6)}·品牌说`, d: '讲品牌背后的工艺、展厅、合作方，借品牌势能给信任', eg: '这个品牌凭什么贵', freq: 1, src: '品牌标签', type: 'talk', ask: '品牌这边能讲的点有几个？', unit: '个' },
      { n: `${name}的日常`, d: `${personal[0]}、${personal[1]}的日常，用人格特性吸粉`, eg: '我的一天是这样过的', freq: 2, src: personal.slice(0, 2).join('·'), type: 'vlog', ask: '一周能拍几天日常？', unit: '天' },
    ],
  };
}
/** 每档栏目的选题模板（{n} = 第几套 / 第几个） */
const TOPIC_TPL: Record<string, string[]> = {
  法式大宅品鉴: ['这套400㎡法式大宅，木作800万花在哪', '法式大宅第{n}套：护墙板的3个细节看懂档次', '法式线条做错了有多难看', '第{n}套法式大宅：为什么客户坚持全实木', '法式大宅的门，我只用这一种做法'],
  工地巡检: ['收口0.5毫米，我验收必看的3个细节', '工地第{n}站：柜体进场先看这两处', '护墙板安装，差1毫米我也返工', '工地第{n}站：油漆前我一定要摸一遍', '木作进场前，地面我先测这3个数'],
  '木里木外·品牌说': ['和国际设计师事务所合作的品牌，凭什么做高定', '北京「原宅」展厅，我带你走一圈', '100多家经销商，为什么我最较真', '一块木皮从选料到上墙要多久'],
  盛哥的工地日记: ['早上6点，我又到工地了', '和工人较真的一天', '今天被客户夸了一句', '一周跑3次工地，我图什么', '收工以后我在干嘛'],
};
const GENERIC_TPL = (c: DiagColumn) => [c.eg, `${c.n}第{n}期：一个细节讲透`, `${c.n}：客户最常问的问题`, `${c.n}第{n}期：做对和做错的区别`, `${c.n}：我踩过的一个坑`];
/** 第二轮：按每档能拍几套 / 几个，排出约 15 条选题（一周 3 条，排 5 周） */
export function makeTopics(cols: DiagColumn[], counts: number[], total = 15): { title: string; column: string; type: VType; why: string }[] {
  const w = cols.map((c, i) => c.freq * Math.max(1, Math.min(counts[i] || 1, 5)));
  const sum = w.reduce((a, b) => a + b, 0);
  const per = w.map(x => Math.max(1, Math.round(x / sum * total)));
  while (per.reduce((a, b) => a + b, 0) > total) per[per.indexOf(Math.max(...per))]--;
  while (per.reduce((a, b) => a + b, 0) < total) per[w.indexOf(Math.max(...w))]++;
  const lists = cols.map((c, i) => {
    const tpl = TOPIC_TPL[c.n] ?? GENERIC_TPL(c);
    return Array.from({ length: per[i] }, (_, k) => ({ title: tpl[k % tpl.length].replace('{n}', String(1 + (k % Math.max(1, counts[i] || 1)))) + (k >= tpl.length ? `（${Math.floor(k / tpl.length) + 1}）` : ''), column: c.n, type: c.type, why: `来源标签：${c.src}` }));
  });
  // 栏目轮着排，不连着发同一档
  const out: { title: string; column: string; type: VType; why: string }[] = [];
  for (let k = 0; out.length < total && k < total; k++) for (const l of lists) if (l[k] && out.length < total) out.push(l[k]);
  return out;
}
/** 选题排进计划：一周 3 条（周二、周四、周六 19:00），从明天起 */
export function schedule(topics: { title: string; column: string; type: VType; why: string }[], today: string, account: string): PlanItem[] {
  const slots: string[] = [];
  for (let d = 1; slots.length < topics.length && d < 120; d++) { const day = addDays(today, d); if ([2, 4, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay())) slots.push(`${day}T19:00`); }
  return topics.map((t, i) => ({ id: `d${Date.now().toString(36)}${i}`, title: t.title, type: vtype(t.type).n, account, column: t.column, when: slots[i], status: '待确认', from: 'diag', why: t.why }));
}

/* ---------- 存在服务端的整份状态 ---------- */
export interface DiagMsg { who: 'ai' | 'me'; text: string; stage?: number; n?: number }
export interface DiagState { unlocked: boolean; msgs: DiagMsg[]; asked: number; result: DiagResult | null; counts: number[] | null; topics: { title: string; column: string; type: VType; why: string }[] | null; saved: boolean; round: 1 | 2 }
export interface StudioState { diag: DiagState; plan: PlanItem[]; works: PlanItem[]; draft: MakeDraft | null; avatar: string }
export const emptyDiag = (): DiagState => ({ unlocked: false, msgs: [], asked: 0, result: null, counts: null, topics: null, saved: false, round: 1 });
export function defaultStudio(today: string): StudioState {
  return { diag: emptyDiag(), plan: samplePlan(today), works: sampleWorks(today), draft: null, avatar: 'me-clone' };
}
