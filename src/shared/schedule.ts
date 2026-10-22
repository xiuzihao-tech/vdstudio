// 排期规则：发布窗口、哪天要发、AI 预选题怎么挑、每格状态。
import type { Plan, SlotPin, SlotState, Topic } from './types.ts';
import { TOPIC_SOURCE_NAME } from './catalog.ts';

export const WINDOW_DAYS = 14;
/** 样片在发布前 48 小时开始做 */
export const LEAD_DAYS = 2;

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
/** 0=周一 … 6=周日 */
export const weekdayOf = (s: string) => (parseIso(s).getDay() + 6) % 7;
export const shortDate = (s: string) => { const d = parseIso(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
export const addDays = (s: string, n: number) => { const d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); };

/** 从本周一开始的两周 */
export function windowDates(today: string): string[] {
  const start = addDays(today, -weekdayOf(today));
  return Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(start, i));
}

export const isPublishDay = (p: Pick<Plan, 'weekdays' | 'added' | 'skipped'>, date: string) =>
  (p.weekdays.includes(weekdayOf(date)) || p.added.includes(date)) && !p.skipped.includes(date);

/** 按栏目配比把发布日轮流分给各栏目 */
export function columnOf(p: Pick<Plan, 'mix'>, index: number): string {
  const seq = p.mix.flatMap(m => Array(Math.max(1, Math.round(m.v * 4))).fill(m.n));
  return seq.length ? seq[index % seq.length] : '';
}

/** AI 预选题的挑选顺序：收藏 → 自己策划的 → 本品类按热度 → 其他 */
export function pickNext(topics: Topic[], used: Set<string>, cat: number): Topic | null {
  const pref = [
    ...topics.filter(t => t.fav),
    ...topics.filter(t => t.source !== 'hot'),
    ...topics.filter(t => t.cat === cat).sort((a, b) => b.heat - a.heat),
    ...topics,
  ];
  return pref.find(t => !used.has(t.id)) ?? null;
}

export function whyOf(t: Topic): string {
  if (t.fav) return '你收藏过';
  if (t.source !== 'hot') return `${TOPIC_SOURCE_NAME[t.source] ?? 'AI'}的选题`;
  if (t.heat === 3) return '经典爆款方向，适合你的品类';
  return `近期没讲过「${t.dir}」`;
}

export function slotState(date: string, today: string, p: Pick<Plan, 'running' | 'needOk'>, pin: SlotPin, enoughAssets: boolean): SlotState {
  if (date < today) return 'done';
  if (!p.running && date > today) return 'paused';
  if (date === today) return p.needOk ? 'review' : 'gen';
  if (pin === 'cand') return 'cand';
  const lead = date <= addDays(today, LEAD_DAYS);
  if (lead && !enoughAssets) return 'gap';
  return lead ? 'gen' : 'plan';
}

export const SLOT_LABEL: Record<SlotState, string> = { done: '已发', review: '待你确认', gen: '生成中', plan: '已排好', gap: '缺素材', paused: '已暂停', cand: '选题待审' };
export const hourLabel = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`;
