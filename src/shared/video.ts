// 视频类型预设与分镜：按「句」把文案、配音、画面绑在一起。
// 规则前后端共用：前端第 3 步实时显示，后端提交时按同一份代码校验和计价（以后端为准）。
import { FAMILIES } from './catalog.ts';
import type { ShotFamily, VideoModel } from './types.ts';

/* ---------- 视频类型（第 1 步） ---------- */
export type VideoType = 'real' | 'talk' | 'tour' | 'house' | 'product' | 'site' | 'story' | 'vlog';
/** 数字人出镜方式：all = 全程出镜（插入画面盖在上面）；some = 只在模板里的出镜镜头；none = 不出镜 */
export interface VideoTypeSpec { id: VideoType; n: string; d: string; how: string; voice: '口播' | '画外音'; avatar: 'all' | 'some' | 'none'; fam: ShotFamily; model: string; bgm: string }
export const VIDEO_TYPES: VideoTypeSpec[] = [
  { id: 'real', n: '实拍出片', d: '工地、案例、门店的实拍素材', how: 'AI 看懂你拍的每段素材，写文案、配音、串成片，不生成画面', voice: '画外音', avatar: 'none', fam: 'site', model: 'wan', bgm: '城市律动' },
  { id: 'talk', n: '真人口播', d: '观点、避坑、知识', how: '数字人全程出镜，中间插 2–4 个画面', voice: '口播', avatar: 'all', fam: 'talk', model: 's20f', bgm: '轻电子' },
  { id: 'tour', n: '空间漫游', d: '完工案例、样板间、民宿', how: '素材做首帧，长镜头走一遍', voice: '画外音', avatar: 'some', fam: 'tour', model: 's25', bgm: '温暖钢琴' },
  { id: 'house', n: '改造前后', d: '老房翻新、软装焕新', how: '同机位前后对比', voice: '画外音', avatar: 'some', fam: 'house', model: 's20', bgm: '城市律动' },
  { id: 'product', n: '产品种草', d: '建材、定制家居', how: '特写 + 使用场景', voice: '画外音', avatar: 'some', fam: 'product', model: 's20', bgm: '轻电子' },
  { id: 'site', n: '工地记录', d: '节点验收、施工工艺', how: '素材原片为主，AI 补镜', voice: '画外音', avatar: 'some', fam: 'site', model: 'wan', bgm: '城市律动' },
  { id: 'story', n: '案例故事', d: '业主回访、设计判断', how: '素材首帧 + AI 过渡镜', voice: '画外音', avatar: 'some', fam: 'story', model: 's20', bgm: '弦乐氛围' },
  { id: 'vlog', n: 'Vlog', d: '日常、游学、探店', how: '多张参考图 + 场景模板', voice: '画外音', avatar: 'none', fam: 'story', model: 's25', bgm: '温暖钢琴' },
];
export const typeOf = (id: string | undefined): VideoTypeSpec => VIDEO_TYPES.find(t => t.id === id) ?? VIDEO_TYPES[0];

/** 小类：每个小类带一张拍摄清单（去现场拍什么），模板清单以苗苗整理的为准，后台可改 */
export interface SubType { id: string; n: string; shots: string[] }
export const SUBTYPES: Record<VideoType, SubType[]> = {
  real: [
    { id: 'site-check', n: '节点验收', shots: ['工地入口，交代在哪个阶段', '3–5 个验收点的特写', '本人对着镜头说一句结论'] },
    { id: 'case-walk', n: '完工走一遍', shots: ['从门口进入的一镜', '每个空间一个全景', '最想让人看到的 2 个细节'] },
    { id: 'store', n: '门店 / 展厅', shots: ['门头和环境', '主推产品的特写', '店里的人在做什么'] },
  ],
  talk: [{ id: 'view', n: '观点', shots: ['正脸半身，说一个判断'] }, { id: 'pit', n: '避坑', shots: ['正脸半身', '一个做错的画面'] }, { id: 'know', n: '知识科普', shots: ['正脸半身', '讲到的材料或工艺特写'] }],
  tour: [{ id: 'case', n: '完工案例', shots: ['入户一镜', '主空间全景', '细节特写'] }, { id: 'show', n: '样板间', shots: ['入户', '动线一镜到底'] }, { id: 'stay', n: '民宿房型', shots: ['推门', '窗景', '床和浴室'] }],
  house: [{ id: 'old', n: '老房翻新', shots: ['改造前同机位照片', '改造后同机位'] }, { id: 'soft', n: '软装焕新', shots: ['改前全景', '改后全景'] }],
  product: [{ id: 'compare', n: '对比测评', shots: ['两样东西并排', '测试过程', '结果特写'] }, { id: 'new', n: '新品上市', shots: ['产品全貌', '3 个卖点特写'] }],
  site: [{ id: 'water', n: '水电验收', shots: ['线管走向', '打压表读数', '项目经理讲解'] }, { id: 'proof', n: '防水闭水', shots: ['涂刷高度', '闭水 48 小时'] }, { id: 'wood', n: '木作节点', shots: ['板材断面', '收口细节'] }],
  story: [{ id: 'revisit', n: '业主回访', shots: ['业主在家里的日常', '业主说一句话'] }, { id: 'decision', n: '设计判断', shots: ['问题现场', '改后效果'] }],
  vlog: [{ id: 'day', n: '一天的工作', shots: ['早上出门', '工地或门店', '收工'] }, { id: 'trip', n: '游学探店', shots: ['到达', '看到的 3 个细节', '一句收获'] }],
};

/** 按文案内容猜一个类型（只是推荐，用户可改） */
export function suggestType(copy: string): VideoType {
  const s = copy.slice(0, 400);
  if (/前后|改造|翻新|焕新|改完/.test(s)) return 'house';
  if (/验收|工地|施工|水电|防水/.test(s)) return 'site';
  if (/岩板|板材|产品|新品|卖点|对比测评/.test(s)) return 'product';
  if (/走一遍|样板间|漫游|带你看|入住|房型/.test(s)) return 'tour';
  if (/业主|回访|住进去|故事/.test(s)) return 'story';
  if (/vlog|日常|游学|探店/i.test(s)) return 'vlog';
  return 'talk';
}

/* ---------- 镜头 ---------- */
export const SIZES = ['远景', '全景', '中景', '近景', '特写', '大特写'] as const;
export const MOVES = ['固定', '推近', '拉远', '横摇', '跟拍', '环绕', '升降', '手持'] as const;
export const TRANSITIONS = ['硬切', '叠化'] as const;
/** ai = AI 生成；frame = 素材做首帧；clip = 直接用素材原片；avatar = 数字人出镜 */
export type ShotSource = 'ai' | 'frame' | 'clip' | 'avatar';
export const SOURCE_NAME: Record<ShotSource, string> = { ai: 'AI 生成', frame: '素材做首帧', clip: '素材原片', avatar: '数字人出镜' };

export interface ShotSpec {
  id: string;
  /** 这一镜说的话（可以是一句或合并的几句） */
  line: string;
  /** 秒；lock=true 时跟随配音时长 */
  dur: number; lock: boolean;
  source: ShotSource; assetId: string | null; lastId: string | null; refIds: string[];
  /** 画面描述（不含景别运镜，提交时再拼） */
  prompt: string; size: string; move: string;
  /** 单镜换模型；空 = 跟全片 */
  model: string;
  trans: string;
  /** 素材原片从第几秒开始用（秒） */
  start?: number;
}

const FR: Record<string, string> = { wide: '远景', full: '全景', mid: '中景', mcu: '近景', cu: '特写', ecu: '大特写' };
const MV: Record<string, string> = { fix: '固定', push: '推近', pull: '拉远', pan: '横摇', track: '跟拍', orbit: '环绕' };

/** 口播语速：每秒约 4.5 字（1.0 倍速）；真实配音回来后以实际时长为准 */
export const CPS = 4.5;
export const chars = (s: string) => String(s || '').replace(/[\s，。、！？!?,.;；:：「」“”"'（）()…—-]/g, '').length;
export const voiceSecs = (s: string, speed = 1) => Math.round((chars(s) / CPS / Math.max(0.5, speed)) * 10) / 10;

/** 文案拆成句：先按行，行内再按句号问号叹号断开；太短的碎句并到前一句 */
export function splitSentences(copy: string): string[] {
  const out: string[] = [];
  for (const line of String(copy || '').split(/\n+/).map(s => s.trim()).filter(Boolean)) {
    const parts = line.match(/[^。！？!?]+[。！？!?]*/g) ?? [line];
    for (const p of parts.map(x => x.trim()).filter(Boolean)) {
      if (out.length && chars(p) < 5 && !/\n/.test(p)) out[out.length - 1] += p; else out.push(p);
    }
  }
  return out;
}

/** 超长的句子按逗号拆成两半（时长超过模型单镜上限时用） */
function halve(s: string): [string, string] {
  const cut = [...s.matchAll(/[，,；;]/g)].map(m => m.index! + 1);
  const mid = chars(s) / 2;
  let best = Math.floor(s.length / 2);
  let gap = Infinity;
  for (const c of cut) { const g = Math.abs(chars(s.slice(0, c)) - mid); if (g < gap) { gap = g; best = c; } }
  return [s.slice(0, best).trim(), s.slice(best).trim()];
}

/** 某句配音时长 → 这一镜生成多少秒：配音 + 0.3 秒，取整到模型支持的范围 */
export function fitDur(voice: number, m: Pick<VideoModel, 'min' | 'max'>): number {
  return Math.min(m.max, Math.max(m.min, Math.ceil(voice + 0.3)));
}

export interface BoardAsset { id: string; type: string; /** 视频时长（秒），知道的话实拍镜头按它截 */ dur?: number | null; best?: [number, number] | null }
export interface BoardOpts {
  type: VideoType; model: VideoModel; assets: BoardAsset[];
  /** 数字人是否可用（有形象，且用户选了出镜） */
  avatar: boolean; speed?: number;
  /** 已有的真实配音时长（按句），没有就按字数估 */
  voice?: number[];
}

/**
 * 拆好的句子 → 分镜。每句一镜；太短（不到模型最短时长）的和下一句合并，太长（超过最长时长）的拆两镜。
 * 一句话都不会丢：所有句子都会落到某一镜里。
 */
export function buildStoryboard(sentences: string[], o: BoardOpts): ShotSpec[] {
  const speed = o.speed ?? 1;
  // 实拍出片不生成画面：镜头长短跟着配音走，不受视频模型「最短 4–5 秒」的限制（以前一句 2 秒的话也占满 5 秒）
  const m = typeOf(o.type).id === 'real' ? { ...o.model, min: 2 } : o.model;
  const cap = Math.min(m.max, 15);
  const secsOf = (s: string, i: number) => o.voice?.[i] ?? voiceSecs(s, speed);
  // 1) 拆超长句
  const units: { text: string; secs: number }[] = [];
  sentences.forEach((s, i) => {
    const v = secsOf(s, i);
    if (v + 0.3 > cap && chars(s) > 8) { const [a, b] = halve(s); units.push({ text: a, secs: voiceSecs(a, speed) }, { text: b, secs: voiceSecs(b, speed) }); }
    else units.push({ text: s, secs: v });
  });
  // 2) 合并太短的句子（合并后不超过上限）
  const groups: { text: string; secs: number }[] = [];
  for (const u of units) {
    const last = groups[groups.length - 1];
    if (last && last.secs + 0.3 < m.min && last.secs + u.secs + 0.6 <= cap) { last.text += u.text; last.secs += u.secs + 0.3; }
    else groups.push({ ...u });
  }
  const lastG = groups[groups.length - 1];
  if (groups.length > 1 && lastG.secs + 0.3 < m.min) {
    const prev = groups[groups.length - 2];
    if (prev.secs + lastG.secs + 0.6 <= cap) { prev.text += lastG.text; prev.secs += lastG.secs + 0.3; groups.pop(); }
  }
  // 3) 套镜头模板：景别、运镜、来源
  const fam = FAMILIES[typeOf(o.type).fam];
  const spec = typeOf(o.type);
  const media = o.assets.filter(a => a.type !== '人物' && a.type !== '音频');
  let mi = 0;
  const n = groups.length;
  const real = spec.id === 'real';
  // 全程出镜：中间挑 2–4 镜做插入画面（有素材用素材，没有 AI 生成）
  const inserts = new Set<number>();
  if (spec.avatar === 'all' && o.avatar && n >= 3) {
    // 开头和结尾留给数字人，中间均匀挑
    const slots = n - 2, k = Math.min(4, Math.max(1, Math.floor(n / 2)), slots);
    for (let j = 0; j < k; j++) inserts.add(k === 1 ? Math.floor(n / 2) : 1 + Math.round(((slots - 1) * j) / (k - 1)));
  }
  return groups.map((g, i) => {
    const t = fam[Math.min(i, fam.length - 1)] ?? fam[0];
    let source: ShotSource;
    if (real) source = media.length ? 'clip' : 'ai';
    else if (spec.avatar === 'all' && o.avatar) source = inserts.has(i) ? (media.length ? 'frame' : 'ai') : 'avatar';
    else if (t.md === 'ref' && o.avatar && spec.avatar !== 'none') source = 'avatar';
    else if (t.md === 'text' || !media.length) source = 'ai';
    else source = 'frame';
    const asset = source === 'frame' || source === 'clip' ? media[mi++ % Math.max(1, media.length)] ?? null : null;
    // 实拍：视频直接用原片，照片做首帧；工地记录里的视频素材也直接用原片
    if (asset && (real || spec.id === 'site')) source = asset.type === '视频' ? 'clip' : 'frame';
    // 素材原片：从看图模型推荐的那一段开始，最长不超过素材剩下的长度
    const start = source === 'clip' && asset?.best ? Math.max(0, Math.floor(asset.best[0])) : 0;
    const dur = source === 'clip'
      ? Math.max(1, Math.min(Math.floor(Math.min(cap, asset?.dur ? asset.dur - start : cap)), Math.max(2, Math.ceil(g.secs + 0.3))))
      : fitDur(g.secs, { min: source === 'frame' || source === 'ai' ? o.model.min : m.min, max: cap });
    return {
      id: `s${i + 1}`, line: g.text, dur, lock: true, ...(start ? { start } : {}),
      source, assetId: asset?.id ?? null, lastId: null, refIds: [],
      prompt: source === 'clip' ? '用这段实拍原片' : source === 'avatar' ? '本人正对镜头讲解，自然手势，背景简洁' : t.md === 'ref' ? '和这句台词相关的空间或细节画面，不出现人脸' : t.d, size: FR[t.fr] ?? '中景', move: MV[t.mv] ?? '固定', model: '', trans: '硬切',
    };
  });
}

/** 按句重新算一遍锁定的镜头时长（换语速、换配音后调用） */
export function relock(shots: ShotSpec[], m: Pick<VideoModel, 'min' | 'max'>, speed = 1): ShotSpec[] {
  return shots.map(s => (s.lock ? { ...s, dur: fitDur(voiceSecs(s.line, speed), { min: m.min, max: Math.min(m.max, 15) }) } : s));
}

/** 发给视频模型的完整提示词 */
export function shotPrompt(s: Pick<ShotSpec, 'prompt' | 'size' | 'move' | 'line' | 'source'>, g: { style?: string; prompt?: string }): string {
  return [
    s.prompt, `${s.size}，${s.move === '固定' ? '固定机位' : `镜头${s.move}`}`,
    s.line && `画面配合这句口播：${s.line}`,
    g.style && g.style !== 'AI 推荐' && `风格：${g.style}`, g.prompt,
    '真实自然光，画面干净，无文字无水印',
  ].filter(Boolean).join('。');
}

/* ---------- 计价 ---------- */
/** 数字人：点/秒（示意；可灵对口型约 0.22 元/秒，按 ×10 换算后取整） */
export const AVATAR_PPS = 3;
/** 配音：点/百字 */
export const VOICE_P100 = 1;

export interface CostLine { k: 'voice' | 'shots' | 'avatar'; label: string; pts: number }
/**
 * 费用明细。全程出镜时数字人按整条配音时长计；画面只算 AI 生成 / 首帧的镜头，素材原片和复用的镜头不收费。
 * reuse[i]=true 表示这一镜沿用上一版，不重新生成。
 */
export function costLines(shots: ShotSpec[], o: { model: (id: string) => VideoModel; base: string; draft: boolean; type: VideoType; voice: boolean; reuse?: boolean[]; voiceOnly?: boolean }): CostLine[] {
  const out: CostLine[] = [];
  const text = shots.map(s => s.line).join('');
  if (o.voice && chars(text)) out.push({ k: 'voice', label: `配音 · ${chars(text)} 字`, pts: Math.max(1, Math.ceil(chars(text) / 100) * VOICE_P100) });
  if (o.voiceOnly) return out;
  let secs = 0, pts = 0;
  shots.forEach((s, i) => {
    if (o.reuse?.[i] || s.source === 'clip' || s.source === 'avatar') return;
    const m = o.model(s.model || o.base);
    secs += s.dur; pts += s.dur * (o.draft && m.draft ? m.pd : m.pf);
  });
  if (secs) out.push({ k: 'shots', label: `画面 · ${shots.filter((s, i) => !o.reuse?.[i] && (s.source === 'ai' || s.source === 'frame')).length} 镜 ${secs} 秒`, pts: Math.round(pts) });
  const av = shots.filter((s, i) => s.source === 'avatar' && !o.reuse?.[i]);
  if (av.length) {
    const avSecs = typeOf(o.type).avatar === 'all' ? shots.reduce((a, s) => a + s.dur, 0) : av.reduce((a, s) => a + s.dur, 0);
    out.push({ k: 'avatar', label: `数字人 · ${avSecs} 秒`, pts: Math.round(avSecs * AVATAR_PPS) });
  }
  return out;
}
export const costTotal = (l: CostLine[]) => l.reduce((a, x) => a + x.pts, 0);
