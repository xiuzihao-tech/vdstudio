// 文案规则：时长估算、违禁词、改写。生成本身走 CopyProvider（server/providers），这里只放确定性规则，前后端共用。
import { BANNED, LIVE_OPENERS } from './catalog.ts';
import type { CopyDraft, CopyLen } from './types.ts';

/** 口播语速按每秒 4.5 个字估算（去掉空白） */
export const CHARS_PER_SEC = 4.5;
export const LENS: CopyLen[] = [30, 45, 60, 90];

export const secs = (s: string) => Math.ceil(String(s || '').replace(/\s/g, '').length / CHARS_PER_SEC);
export const charCount = (s: string) => String(s || '').replace(/\s/g, '').length;

export const copyLines = (c: Pick<CopyDraft, 'hook' | 'body' | 'cta'>) => [c.hook, ...c.body, c.cta].map(s => s.trim()).filter(Boolean);
export const copyText = (c: Pick<CopyDraft, 'hook' | 'body' | 'cta'>) => copyLines(c).join('\n');

/** 不算违规的上下文：“第一段/第一次”是序数，“唯一的缺点”之类不是绝对化宣传 */
const NOT_AD: Record<string, RegExp> = {
  '第一': /第一(?=[段步次个天条处句眼时期遍层道件章节集位])/g,
  '唯一': /唯一(?=的(缺点|问题|遗憾))/g,
};
export function findBanned(text: string): [string, string][] {
  return BANNED.filter(([w]) => (NOT_AD[w] ? text.replace(NOT_AD[w], '') : text).includes(w));
}
export function replaceWord(c: CopyDraft, word: string): CopyDraft {
  const rep = (BANNED.find(b => b[0] === word) || [word, ''])[1];
  const f = (s: string) => s.split(word).join(rep);
  return { ...c, title: f(c.title), hook: f(c.hook), cta: f(c.cta), body: c.body.map(f), titles: c.titles.map(f), hooks: c.hooks.map(f) };
}
export function replaceAllBanned(c: CopyDraft): CopyDraft {
  return findBanned([c.title, ...copyLines(c)].join('')).reduce((acc, [w]) => replaceWord(acc, w), c);
}

export interface CopyCheck { chars: number; secs: number; fits: boolean; over: number; suggestLen: CopyLen; banned: [string, string][]; live: number }
export function checkCopy(c: CopyDraft): CopyCheck {
  const all = copyLines(c).join('');
  const s = secs(all);
  return {
    chars: charCount(all), secs: s, fits: s <= c.len + 3, over: Math.max(0, s - c.len),
    suggestLen: LENS.find(x => x >= s) ?? 90,
    banned: findBanned([c.title, ...copyLines(c)].join('')), live: c.live,
  };
}

/** 去掉超出时长的正文段落（至少保留 2 段） */
export function trimToLen(c: CopyDraft): CopyDraft {
  const body = [...c.body];
  while (secs(copyText({ ...c, body })) > c.len + 3 && body.length > 2) body.pop();
  return { ...c, body };
}

export type Rewrite = 'live' | 'short' | 'long' | 'alt';
/** 确定性改写（Mock）。正式版由 CopyProvider.rewrite 调大模型，这里作为离线兜底 */
export function rewriteLocal(c: CopyDraft, how: Rewrite, hook: string): { draft: CopyDraft; changed: number } {
  let changed = 0;
  let body = [...c.body];
  if (how === 'live') {
    body = body.map((x, i) => {
      if (i % 2 === 0 && !LIVE_OPENERS.some(l => x.startsWith(l))) { changed++; return LIVE_OPENERS[(i / 2) % LIVE_OPENERS.length] + x; }
      return x;
    });
    return { draft: { ...c, body, live: Math.min(94, c.live + (changed ? 14 : 0)) }, changed };
  }
  if (how === 'short') body = body.map(x => { if (x.length > 26) { const y = x.replace(/[，,][^，,。]*。$/, '。'); if (y !== x) changed++; return y; } return x; });
  if (how === 'long') { body.splice(Math.max(0, body.length - 1), 0, `我当时也犹豫过，后来想明白了：${hook}。`); changed = 1; }
  if (how === 'alt') body = body.map(x => { const y = x.replace('我的做法是', '我最后选的是').replace('很多人', '不少人').replace('记住一句话', '就记一件事'); if (y !== x) changed++; return y; });
  return { draft: { ...c, body, shots: how === 'long' ? [...c.shots, '人物观点'] : c.shots }, changed };
}
