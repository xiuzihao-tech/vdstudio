// 保存期限和容量（10/27 纪要第 9 条）：只存用户上传的照片、视频和生成的视频；
// 期限和容量在后台设（0 = 不限），到期前 7 天在「我的作品」提醒下载，到期后自动删文件。
import type { DB } from './db.ts';
import type { Storage } from './storage/index.ts';

type Row = Record<string, any>;
const DAY = 86400e3;
export const REMIND_DAYS = 7;

export interface StoragePolicy { retentionDays: number; capacityMb: number }
export interface ExpiringItem { kind: 'asset' | 'video'; id: string; name: string; url: string | null; expiresAt: string; daysLeft: number }

export function makeRetention(db: DB, storage: Storage) {
  const ownerWs = (owner: string) => (db.prepare('SELECT id FROM workspaces WHERE owner_id=?').all(owner) as Row[]).map(r => r.id as string);
  const jobVideos = (wsIds: string[]) => wsIds.length ? (db.prepare(`SELECT id, title, output, created_at FROM jobs WHERE status='done' AND ws IN (${wsIds.map(() => '?').join(',')})`).all(...wsIds) as Row[])
    .map(r => ({ id: r.id as string, title: r.title as string, createdAt: r.created_at as string, out: r.output ? JSON.parse(r.output) : null }))
    .filter(j => typeof j.out?.videoUrl === 'string' && j.out.videoUrl.startsWith('/files/')) : [];

  return {
    /** 这个账号（所有工作区）上传的文件一共占多少字节 */
    usedBytes(owner: string): number {
      const r = db.prepare(`SELECT COALESCE(SUM(a.size),0) AS n FROM assets a JOIN workspaces w ON a.ws=w.id WHERE w.owner_id=? AND a.file IS NOT NULL`).get(owner) as Row;
      return Number(r.n) || 0;
    },
    /** 再传 extra 字节会不会超容量 */
    wouldExceed(owner: string, extra: number, p: StoragePolicy) { return p.capacityMb > 0 && this.usedBytes(owner) + extra > p.capacityMb * 1024 * 1024; },
    /** 7 天内到期的上传素材和成片 */
    expiring(owner: string, p: StoragePolicy, now = Date.now()): ExpiringItem[] {
      if (!p.retentionDays) return [];
      const ws = ownerWs(owner); if (!ws.length) return [];
      const ttl = p.retentionDays * DAY, out: ExpiringItem[] = [];
      const item = (kind: ExpiringItem['kind'], id: string, name: string, url: string | null, created: string) => {
        const exp = Date.parse(created) + ttl, left = Math.ceil((exp - now) / DAY);
        if (left <= REMIND_DAYS) out.push({ kind, id, name, url, expiresAt: new Date(exp).toISOString(), daysLeft: Math.max(0, left) });
      };
      for (const a of db.prepare(`SELECT id, name, file, created_at FROM assets WHERE file IS NOT NULL AND ws IN (${ws.map(() => '?').join(',')})`).all(...ws) as Row[]) item('asset', a.id, a.name, `/files/${a.file}`, a.created_at);
      for (const j of jobVideos(ws)) item('video', j.id, j.title, j.out.videoUrl, j.createdAt);
      return out.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
    },
    /** 删掉过期的上传文件和成片文件（成片记录留着，标「已过期」） */
    async purge(p: StoragePolicy, now = Date.now()): Promise<number> {
      if (!p.retentionDays) return 0;
      const cut = new Date(now - p.retentionDays * DAY).toISOString();
      let n = 0;
      for (const a of db.prepare('SELECT id, ws, file FROM assets WHERE file IS NOT NULL AND created_at < ?').all(cut) as Row[]) {
        await storage.delete(a.file).catch(() => undefined);
        db.prepare('DELETE FROM assets WHERE id=?').run(a.id); n++;
      }
      for (const r of db.prepare(`SELECT id, output FROM jobs WHERE status='done' AND created_at < ? AND output IS NOT NULL`).all(cut) as Row[]) {
        const out = JSON.parse(r.output);
        if (typeof out?.videoUrl !== 'string' || !out.videoUrl.startsWith('/files/')) continue;
        await storage.delete(out.videoUrl.slice(7)).catch(() => undefined);
        db.prepare('UPDATE jobs SET output=? WHERE id=?').run(JSON.stringify({ ...out, videoUrl: undefined, expired: true }), r.id); n++;
      }
      return n;
    },
  };
}
