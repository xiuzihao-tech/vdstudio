// 视频风格：一条视频「像谁拍的」。风格决定三件事——文案怎么写、画面怎么拍、节奏和包装（音乐、字幕）。
// 选了风格，AI 写文案、看素材写画外音、生成画面、合成字幕都会按它来。
// 「参考」写的是大家熟悉的账号或片种，只学写法和节奏，不用对方的素材、名字和包装。
import type { VideoType } from './video.ts';

export type SubStyle = 'doc' | 'key' | 'plain';
export interface VideoStyle {
  id: string;
  /** 风格名（存进生成设置的 style 字段） */
  n: string;
  /** 参考谁：一看就懂的账号或片种 */
  like: string;
  /** 一句话：这个风格好在哪 */
  d: string;
  /** 最适合的视频类型（排在前面推荐） */
  best: VideoType[];
  /** 文案怎么写（交给写文案的 AI） */
  copy: string;
  /** 画面怎么拍（交给生成画面的 AI） */
  visual: string;
  /** 每镜大约几秒（节奏） */
  pace: number;
  bgm: string;
  /** 字幕样式：doc 小号白字（纪录片）；key 大字、关键词黄底（口播）；plain 默认 */
  subs: SubStyle;
  /** 还没和大哲 IP 研究院对过样片，先按公开的印象写 */
  draft?: boolean;
  /** 招牌风格：在选择里永远排最前面 */
  hot?: boolean;
  /** 后台停用后不出现在风格选择里 */
  enabled?: boolean;
}

export const VIDEO_STYLES: VideoStyle[] = [
  {
    id: 'yitiao', n: '“一条”式人物纪实', like: '一条', d: '人讲自己的家和作品，慢慢讲，细节多，看完记住这个人',
    best: ['story', 'tour', 'real', 'vlog'],
    copy: '第一人称，像采访里自然说出来的话；从一个具体的人、一个具体的细节开场，不喊口号、不用感叹号、不堆形容词；中间讲一个选择背后的原因；结尾落在住进去以后的生活感受上，引导说得轻一点。',
    visual: '自然光，镜头慢推慢移；人在空间里做事的中景和手部特写穿插，留一些安静的空镜；色调干净偏暖，不要特效和花字。',
    pace: 5, bgm: '温暖钢琴', subs: 'doc', hot: true,
  },
  {
    id: 'dazhe', n: '大哲式观点口播', like: '大哲 IP 研究院', d: '本人出镜，第一句就给判断，三点讲透，结尾告诉观众做什么',
    best: ['talk', 'site', 'real', 'product'],
    copy: '第一句直接给结论或一个反常识的判断；中间分三点，每点一句话加一个自己项目里的例子；短句、口语，像当面跟业主讲；不绕弯、不说空话；结尾明确告诉观众下一步做什么。',
    visual: '本人正面半身出镜，背景是自己的作品、工地或工作室；讲到哪一点就插那一点的实拍画面；机位稳定，画面亮。',
    pace: 3, bgm: '轻电子', subs: 'key', draft: true, hot: true,
  },
  {
    id: 'cinema', n: '空间电影感', like: '家居品牌片', d: '画面和氛围先打动人，旁白少，适合完工案例',
    best: ['tour', 'story', 'real'],
    copy: '旁白少而短，每句不超过 12 个字，说感受不说参数；开头用一句画面感强的话，结尾一句点题。',
    visual: '电影感构图：对称、低机位、慢推；光影层次明显，晨光或黄昏；镜头之间用光线和动作衔接。',
    pace: 5, bgm: '弦乐氛围', subs: 'doc',
  },
  {
    id: 'vlog', n: '主理人 Vlog', like: '设计师日常 Vlog', d: '跟着本人过一天，轻松真实，建立信任',
    best: ['vlog', 'site', 'real', 'talk'],
    copy: '像跟朋友聊天：今天去了哪、做了什么决定、为什么；可以有一点自嘲；结尾随口提一句可以私信聊。',
    visual: '第一视角或手持跟拍，画面有生活感，可以有轻微晃动；人和现场同时出现。',
    pace: 3, bgm: '城市律动', subs: 'plain',
  },
  {
    id: 'site', n: '工地透明', like: '工地实拍类账号', d: '用现场说话，验收点、工艺、标准一条讲清',
    best: ['site', 'real', 'talk'],
    copy: '先说这是什么阶段、看哪几处；每处一句标准一句做法；用数字和工具说话（打压、水平仪）；不夸自己，结尾邀请来工地看。',
    visual: '现场实拍为主，特写验收点和工具读数；保留现场声音；画面真实不修饰。',
    pace: 3, bgm: '城市律动', subs: 'key',
  },
  {
    id: 'compare', n: '改造前后快切', like: '改造对比类爆款', d: '同机位前后一切，三秒抓住眼球',
    best: ['house', 'real', 'tour'],
    copy: '开头一句「改之前 / 改之后」的反差；每处改动一句话说花了什么心思；节奏快，结尾给预算或工期。',
    visual: '同一机位前后对比，卡点切换；先放改造后的效果，再切回原样。',
    pace: 2, bgm: '轻电子', subs: 'key',
  },
  {
    id: 'product', n: '产品价值解读', like: '测评类账号', d: '一个卖点讲透，和别家的区别看得见',
    best: ['product', 'real'],
    copy: '只讲一个卖点；先说用户的痛点，再用一个对比或实验证明；参数翻译成生活里的好处；结尾邀请到店或要样品。',
    visual: '微距特写和对比实验；同条件并排对比；手部操作展示细节。',
    pace: 3, bgm: '轻电子', subs: 'key',
  },
  {
    id: 'sales', n: '案场高级感', like: '地产宣传片', d: '楼盘和样板间的质感，适合案场和开发商',
    best: ['tour', 'story'],
    copy: '克制、有分寸；少形容词多事实（面宽、距离、景观）；结尾邀请到访。',
    visual: '稳定器长镜头，广角、干净的线条和材质特写；光线明亮通透。',
    pace: 4, bgm: '弦乐氛围', subs: 'doc',
  },
  {
    id: 'stay', n: '民宿慢生活', like: '旅行生活类账号', d: '让人想马上来住',
    best: ['tour', 'vlog', 'story'],
    copy: '写一段住进来的时间线：到达、窗外、晚上、第二天早上；用感受代替介绍；结尾一句可以直接预订。',
    visual: '窗景、晨光、日常动作；节奏慢，留白多。',
    pace: 5, bgm: '温暖钢琴', subs: 'doc',
  },
  {
    id: 'renew', n: '房源焕新', like: '房产经纪改造预览', d: '老房子改完能怎么住',
    best: ['house', 'tour'],
    copy: '先说房子现在的问题，再说改完的样子和花多少钱；用户视角，像带看时的讲解。',
    visual: '先老房现状后改造效果，同机位过渡；明亮、可信。',
    pace: 3, bgm: '城市律动', subs: 'plain',
  },
];

export const AUTO_STYLE = 'AI 推荐';
/** 能选的风格（后台没停用的） */
export const liveStyles = () => VIDEO_STYLES.filter(s => s.enabled !== false);
/** 一键生成视频每类成片默认用哪个风格（技能「视频风格」里改） */
export const STYLE_DEFAULT: Record<string, string> = { tour: 'cinema', explain: 'dazhe', talk: 'dazhe', before: 'compare', case: 'yitiao', product: 'product', site: 'site', vlog: 'vlog' };
/** 按名字或 id 找风格；旧数据里存的是名字 */
export const styleOf = (s: string | null | undefined): VideoStyle | null => !s || s === AUTO_STYLE ? null : VIDEO_STYLES.find(x => x.n === s || x.id === s) ?? null;
/** 某个视频类型下按推荐顺序排的风格 */
export const stylesFor = (type: VideoType | undefined) => {
  const t = type ?? 'real';
  return [...liveStyles()].sort((a, b) => (a.best.includes(t) ? a.best.indexOf(t) : 99) - (b.best.includes(t) ? b.best.indexOf(t) : 99));
};
/** 选「AI 推荐」时实际用哪个风格 */
export const autoStyle = (type: VideoType | undefined) => stylesFor(type)[0];
/** 这条视频实际用的风格：选了就用选的，「AI 推荐」按类型挑 */
export const effectiveStyle = (g: { style?: string | null; type?: VideoType }) => styleOf(g.style) ?? autoStyle(g.type);
/** 生成画面时加进提示词的那句 */
export const styleVisual = (g: { style?: string | null; type?: VideoType }) => { const x = effectiveStyle(g); return `风格「${x.n}」：${x.visual}`; };
