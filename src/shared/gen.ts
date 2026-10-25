// 简易生成的规则：分镜拆分、费用估算、冲突检查。前端实时展示，后端提交时再算一遍（以后端为准）。
import { MODELS } from './catalog.ts';
import { secs } from './copy.ts';
import type { GenIssue, GenSettings, PlannedShot, SceneKey, VideoModel, VoiceCloneState } from './types.ts';

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
 * 把一条视频拆成若干镜：镜数 ≥ 文案行数，且每镜时长落在模型的单镜范围内（上限按 15 秒控制节奏）。
 * 台词按比例分配到各镜；素材按顺序轮流做首帧，没有素材时由 AI 生成画面。
 */
export function planShots(g: Pick<GenSettings, 'copy' | 'model' | 'len'>, assetKeys: SceneKey[], fallbackKeys: SceneKey[]): PlannedShot[] {
  const m = modelOf(g.model);
  const L = genLines(g.copy);
  const cap = Math.min(m.max, 15);
  let n = Math.max(L.length || 1, Math.ceil(g.len / cap));
  if (g.len / n < m.min) n = Math.max(1, Math.floor(g.len / m.min));
  const keys = assetKeys.length ? assetKeys : fallbackKeys.filter(k => k !== 'person');
  const per = Math.round(g.len / n);
  return Array.from({ length: n }, (_, i) => ({
    dur: per,
    line: L.length ? L[Math.min(L.length - 1, Math.floor((i * L.length) / n))] : '',
    k: keys[i % Math.max(1, keys.length)] ?? 'live',
    generated: !assetKeys.length,
  }));
}

export const COVER_COST = 4;
export function genCost(g: Pick<GenSettings, 'model' | 'len' | 'draft' | 'cover'>, final = false): number {
  const m = modelOf(g.model);
  const price = !final && g.draft && m.draft ? m.pd : m.pf;
  return Math.round(g.len * price) + (g.cover && !final ? COVER_COST : 0);
}

const LENS = [30, 45, 60, 90];
/** 冲突检查：返回问题和可一键修复的选项。blocking=true 时不能提交。 */
export function genIssues(g: GenSettings, voiceClone: VoiceCloneState): GenIssue[] {
  const m = modelOf(g.model);
  const out: GenIssue[] = [];
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
  if (!g.assetIds.length) out.push({ code: 'no_assets', blocking: false, text: '没放素材，画面会全部由 AI 生成', fixes: [{ id: 'pick:assets', label: '从素材库导入' }] });
  return out;
}

/** 缩短文案：从倒数第二行开始删，保留开头钩子和结尾引导 */
export function trimCopyToLen(copy: string, len: number): string {
  const L = genLines(copy);
  while (secs(L.join('')) > len && L.length > 2) L.splice(L.length - 2, 1);
  return L.join('\n');
}
export const nearestLen = (s: number) => LENS.find(x => x >= s) ?? 90;

export const GEN_STEPS = ['拆分镜头', '生成画面', '配音与口型', '配乐、字幕与混音', '合成导出'];
