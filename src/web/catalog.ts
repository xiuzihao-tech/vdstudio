// 前台目录：服务端「技能中心」下发的参数，后台改了刷新就生效。
// 成片类型、价格、样片、数字人、声音由 applyCatalog 直接换掉 shared/studio 里的表；诊断和发布包装的参数放在 CAT 里。
import { PACK_DEFAULT, applyCatalog } from '../shared/studio.ts';
import type { ServerCatalog } from './api.ts';

export const CAT: { diag: ServerCatalog['diag'] | null; pack: ServerCatalog['pack'] } = {
  diag: null,
  pack: { tagMin: PACK_DEFAULT.tagMin, tagMax: PACK_DEFAULT.tagMax, titleMax: PACK_DEFAULT.titleMax, banned: [...PACK_DEFAULT.banned] },
};

export function applyServerCatalog(c: ServerCatalog | null | undefined) {
  if (!c) return;
  applyCatalog(c);
  if (c.diag) CAT.diag = c.diag;
  if (c.pack) CAT.pack = c.pack;
}

/** 标题、文案里出现的广告法敏感词（按后台「发布包装」里的禁词表） */
export const bannedWords = (text: string) => CAT.pack.banned.filter(w => w && text.includes(w));
