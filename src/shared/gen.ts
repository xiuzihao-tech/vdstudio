// 简易生成的规则：分镜拆分、费用估算、冲突检查。前端实时展示，后端提交时再算一遍（以后端为准）。
import { MODELS } from './catalog.ts';
import { secs } from './copy.ts';
import { costLines, costTotal, typeOf } from './video.ts';
import type { GenIssue, GenSettings, PlannedShot, SceneKey, VideoModel, VoiceCloneState, Workspace } from './types.ts';

/**
 * 当前生效的视频档位目录。默认是通用目录；接了具体中转站后（服务端启动时、前端拿到会话后）
 * 换成该站的实际能力，这样前后端的校验、价格、时长范围都一致。
 */
let catalog: VideoModel[] = MODELS;
export const videoModels = () => catalog;
export function setVideoModels(list: VideoModel[]) { catalog = list.length ? list : MODELS; }
export const modelOf = (id: string): VideoModel => catalog.find(m => m.id === id) ?? catalog[0];
/** 样片模式出片的清晰度 */
export const draftResOf = (id: string) => modelOf(id).draftRes ?? '480p';
/** 清晰度不支持时退到该档位最高的一档 */
export const clampRes = <R extends string>(id: string, res: R): R => { const m = modelOf(id); return (m.res.includes(res) ? res : m.res[m.res.length - 1]) as R; };
export const genLines = (copy: string) => copy.split(/\n+/).map(s => s.trim()).filter(Boolean);
export const isDraft = (g: Pick<GenSettings, 'draft' | 'model'>) => g.draft && modelOf(g.model).draft;

/**
 * 旧链路（没有第 3 步分镜时）：把一条视频拆成若干镜，每镜时长落在模型的单镜范围内（上限按 15 秒控制节奏）。
 * 镜数比文案行数少时，把相邻几行合到同一镜里——一行都不丢（以前会直接跳过中间的行，连结尾引导一起丢掉）。
 */
export function planShots(g: Pick<GenSettings, 'copy' | 'model' | 'len'>, assetKeys: SceneKey[], fallbackKeys: SceneKey[]): PlannedShot[] {
  const m = modelOf(g.model);
  const L = genLines(g.copy);
  const cap = Math.min(m.max, 15);
  let n = Math.max(L.length || 1, Math.ceil(g.len / cap));
  if (g.len / n < m.min) n = Math.max(1, Math.floor(g.len / m.min));
  const keys = assetKeys.length ? assetKeys : fallbackKeys.filter(k => k !== 'person');
  // 时长分到每镜，总和等于目标时长
  const base = Math.floor(g.len / n), extra = g.len - base * n;
  return Array.from({ length: n }, (_, i) => {
    const from = Math.floor((i * L.length) / n), to = Math.floor(((i + 1) * L.length) / n);
    const line = L.length ? (L.slice(from, Math.max(to, from + 1)).join('') || L[Math.min(L.length - 1, from)]) : '';
    return { dur: base + (i < extra ? 1 : 0), line, k: keys[i % Math.max(1, keys.length)] ?? 'live', generated: !assetKeys.length };
  });
}

/** 这次要生成的镜头：有第 3 步分镜就用它，否则按旧规则拆 */
export function shotsOf(g: GenSettings, assets: { id: string; k: SceneKey }[], fallbackKeys: SceneKey[]): PlannedShot[] {
  if (!g.shots?.length) return planShots(g, assets.map(a => a.k), fallbackKeys);
  const kOf = (id: string | null) => assets.find(a => a.id === id)?.k;
  return g.shots.map((s, i) => ({
    dur: s.dur, line: s.line, k: kOf(s.assetId) ?? fallbackKeys[i % Math.max(1, fallbackKeys.length)] ?? 'live',
    generated: s.source === 'ai' || s.source === 'avatar', source: s.source, assetId: s.assetId, prompt: s.prompt, size: s.size, move: s.move, model: s.model || undefined, trans: s.trans,
    ...(s.source === 'clip' && s.start ? { start: s.start } : {}),
    ...(g.reuse?.[i] ? { videoUrl: g.reuse[i], reused: true } : {}),
  }));
}

/** 封面：接上图像模型之前不收费也不出（以前勾了会白扣 4 点） */
export const COVER_COST = 0;
/** o.voice=false：没接配音服务，成片不带配音，不收配音费 */
export function genCost(g: Pick<GenSettings, 'model' | 'len' | 'draft' | 'cover'> & Partial<Pick<GenSettings, 'shots' | 'type' | 'voice' | 'reuse' | 'remix'>>, final = false, o: { voice?: boolean } = {}): number {
  if (g.shots?.length) {
    return costTotal(costLines(g.shots, { model: modelOf, base: g.model, draft: !final && g.draft, type: typeOf(g.type).id, voice: (o.voice ?? true) && g.voice !== 'none' && g.remix !== 'music', reuse: g.reuse?.map(Boolean) }));
  }
  const m = modelOf(g.model);
  const price = !final && g.draft && m.draft ? m.pd : m.pf;
  return Math.round(g.len * price) + (g.cover && !final ? COVER_COST : 0);
}

const LENS = [30, 45, 60, 90];
/** 冲突检查：返回问题和可一键修复的选项。blocking=true 时不能提交。 */
/** env.firstFrame=false：素材图没法当首帧发给视频服务（比如本机运行、视频服务只认公网链接） */
export function genIssues(g: GenSettings, voiceClone: VoiceCloneState, env: { firstFrame?: boolean; avatars?: Workspace['avatars'] } = {}): GenIssue[] {
  const m = modelOf(g.model);
  const out: GenIssue[] = [];
  if (m.ratios && !m.ratios.includes(g.ratio))
    out.push({ code: 'ratio_unsupported', blocking: true, text: `${m.n}不支持 ${g.ratio}，只能选 ${m.ratios.join(' / ')}`, fixes: m.ratios.slice(0, 2).map(r => ({ id: `ratio:${r}`, label: `改为 ${r}` })) });
  if (env.firstFrame === false && g.assetIds.length)
    out.push({ code: 'frame_unusable', blocking: false, text: '素材图暂时用不了首帧：视频服务只认公网图片链接，本机运行时发不过去，这次会按文案和提示词生成画面。配好对象存储或部署上线后就能用', fixes: [] });
  if (m.off) out.push({ code: 'model_off', blocking: true, text: `${m.n}还没接入`, fixes: [{ id: 'model:s25', label: '换 Seedance 2.5' }] });
  if (!m.res.includes(g.res)) {
    const mx = m.res[m.res.length - 1];
    out.push({ code: 'res_unsupported', blocking: true, text: `${m.n}最高 ${mx}，现在选的是 ${g.res}`,
      fixes: [{ id: `res:${mx}`, label: `改为 ${mx}` }, ...(g.res === '4K' ? [{ id: 'model:s20', label: '换 Seedance 2.0（支持 4K）' }] : [])] });
  }
  const s = secs(g.copy);
  if (!g.copy.trim()) {
    out.push({ code: 'no_copy', blocking: true, text: '还没有文案', fixes: [{ id: 'goto:copy', label: '去写文案' }, { id: 'ai:copy', label: 'AI 先写一版' }] });
  } else if (s > g.len + 3) {
    const to = Math.min(120, Math.ceil(s / 5) * 5);
    out.push({ code: 'copy_too_long', blocking: false, text: `文案约 ${s} 秒，比视频长 ${s - g.len} 秒，读不完会被截断`,
      fixes: [{ id: `len:${to}`, label: `时长改为 ${to} 秒` }, { id: 'trim:copy', label: 'AI 缩短文案' }] });
  }
  if (g.voice === 'me' && voiceClone !== 'ready') {
    out.push(voiceClone === 'busy'
      ? { code: 'voice_busy', blocking: true, text: '你的声音还在克隆，好了就能用', fixes: [{ id: 'voice:p1', label: '先用平台音色' }] }
      : { code: 'voice_missing', blocking: true, text: '还没克隆你的声音', fixes: [{ id: 'clone', label: '克隆我的声音' }, { id: 'voice:p1', label: '先用平台音色' }] });
  }
  if (g.shots?.some(x => x.source === 'avatar')) {
    const mode = g.avatar === 'photo' ? 'photo' : 'clone', st = env.avatars?.[mode] ?? 'none', name = mode === 'photo' ? '照片形象' : '真人分身';
    if (st === 'busy') out.push({ code: 'avatar_busy', blocking: true, text: `你的${name}还在审核，好了就能出镜`, fixes: [{ id: 'avatar:none', label: '这次不出镜' }] });
    else if (st !== 'ready') out.push({ code: 'avatar_missing', blocking: true, text: `还没有${name}，出镜的镜头没法生成`, fixes: [{ id: 'goto:me', label: '去建形象' }, { id: 'avatar:none', label: '这次不出镜' }] });
  }
  if (!g.assetIds.length) out.push(g.type === 'real'
    ? { code: 'no_assets', blocking: true, text: '实拍出片要先放几段你拍的视频或照片', fixes: [{ id: 'pick:assets', label: '放素材' }] }
    : { code: 'no_assets', blocking: false, text: '没放素材，画面会全部由 AI 生成', fixes: [{ id: 'pick:assets', label: '从素材库导入' }] });
  return out;
}

/** 缩短文案：从倒数第二行开始删，保留开头钩子和结尾引导 */
export function trimCopyToLen(copy: string, len: number): string {
  const L = genLines(copy);
  while (secs(L.join('')) > len && L.length > 2) L.splice(L.length - 2, 1);
  return L.join('\n');
}
export const nearestLen = (s: number) => LENS.find(x => x >= s) ?? 90;

export const GEN_STEPS = ['配音', '生成画面', '数字人口型', '配乐、字幕与混音', '合成导出'];
