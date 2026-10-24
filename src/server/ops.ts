// 运营数据：埋点、反馈、邀请码、全站开关、漏斗统计、额度检查。
import type { DB } from './db.ts';
import { newId, now } from './db.ts';
import { randomBytes } from 'node:crypto';

type Row = Record<string, any>;
/** 前端允许上报的事件（其余在服务端关键动作里记） */
export const CLIENT_EVENTS = ['page_view', 'copy_to_gen', 'copy_to_wb', 'video_played', 'download'] as const;

/** 漏斗：每一步“至少做过一次”的账号数 */
export const FUNNEL: [string, string[]][] = [
  ['访问', ['page_view', 'session']],
  ['出选题', ['topics_generated', 'topic_created']],
  ['写文案', ['copy_generated']],
  ['存草稿', ['draft_saved']],
  ['提交生成', ['gen_started']],
  ['生成成功', ['gen_done']],
  ['转成片', ['final_started']],
  ['排进排期', ['slot_set', 'slot_approved']],
];

/** 当天 0 点（服务器时区，部署时设 TZ=Asia/Shanghai） */
export const dayStart = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString(); };

export function makeOps(db: DB) {
  const get = (k: string) => (db.prepare('SELECT v FROM settings WHERE k=?').get(k) as Row | undefined)?.v as string | undefined;
  return {
    track(owner: string, ws: string | null, name: string, props?: Record<string, unknown>) {
      db.prepare('INSERT INTO events (owner_id, ws, name, props, created_at) VALUES (?,?,?,?,?)').run(owner, ws, name, props ? JSON.stringify(props) : null, now());
    },
    feedback(owner: string, page: string, text: string, contact: string) {
      db.prepare('INSERT INTO feedback (id, owner_id, page, text, contact, created_at) VALUES (?,?,?,?,?,?)').run(newId('fb'), owner, page, text, contact, now());
    },
    listFeedback() {
      return db.prepare(`SELECT f.id, f.page, f.text, f.contact, f.status, f.created_at AS createdAt, u.email, u.name
        FROM feedback f LEFT JOIN users u ON u.owner_id = f.owner_id ORDER BY f.created_at DESC LIMIT 300`).all() as Row[];
    },
    setFeedback(id: string, status: string) { return db.prepare('UPDATE feedback SET status=? WHERE id=?').run(status, id).changes > 0; },

    getSetting: get,
    setSetting(k: string, v: string | null) {
      if (v === null) db.prepare('DELETE FROM settings WHERE k=?').run(k);
      else db.prepare('INSERT INTO settings (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v);
    },
    genPaused: () => get('gen_paused') === '1',
    setGenPaused(v: boolean) { db.prepare('INSERT INTO settings (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run('gen_paused', v ? '1' : '0'); },

    createInvites(n: number, maxUses: number, note: string): string[] {
      const out: string[] = [];
      for (let i = 0; i < n; i++) {
        const code = randomBytes(5).toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().padEnd(6, 'X').slice(0, 6);
        db.prepare('INSERT OR IGNORE INTO invites (code, note, max_uses, created_at) VALUES (?,?,?,?)').run(`FD${code}`, note, maxUses, now());
        out.push(`FD${code}`);
      }
      return out;
    },
    listInvites() { return db.prepare('SELECT code, note, max_uses AS maxUses, used, created_at AS createdAt FROM invites ORDER BY created_at DESC').all() as Row[]; },

    /** 今天这个账号提交了几次生成 */
    jobsToday(owner: string) {
      return (db.prepare(`SELECT COUNT(*) AS n FROM jobs j JOIN workspaces w ON w.id = j.ws WHERE w.owner_id=? AND j.created_at >= ? AND j.status != 'failed'`).get(owner, dayStart()) as Row).n as number;
    },
    /** 今天全站在生成上花了多少点（失败退点的不算） */
    spentToday() { return (db.prepare(`SELECT COALESCE(SUM(cost),0) AS s FROM jobs WHERE created_at >= ? AND status != 'failed'`).get(dayStart()) as Row).s as number; },

    users() {
      return db.prepare(`SELECT u.id, u.email, u.name, u.invite, u.created_at AS createdAt, o.balance,
          (SELECT COUNT(*) FROM jobs j JOIN workspaces w ON w.id=j.ws WHERE w.owner_id=u.owner_id) AS jobs,
          (SELECT COALESCE(SUM(j.cost),0) FROM jobs j JOIN workspaces w ON w.id=j.ws WHERE w.owner_id=u.owner_id AND j.status!='failed') AS spent,
          (SELECT MAX(created_at) FROM events e WHERE e.owner_id=u.owner_id) AS lastActive
        FROM users u JOIN owners o ON o.id=u.owner_id ORDER BY u.created_at DESC`).all() as Row[];
    },
    addPoints(userId: string, delta: number) {
      const u = db.prepare('SELECT owner_id FROM users WHERE id=?').get(userId) as Row | undefined;
      if (!u) return false;
      db.prepare('UPDATE owners SET balance = MAX(0, balance + ?) WHERE id=?').run(delta, u.owner_id);
      db.prepare('INSERT INTO ledger (id, ws, delta, reason, job_id, created_at) VALUES (?,?,?,?,?,?)').run(newId('led'), `owner:${u.owner_id}`, delta, '管理员调整', null, now());
      return true;
    },

    overview(days: number) {
      const since = dayStart(new Date(Date.now() - (days - 1) * 864e5));
      const funnel = FUNNEL.map(([label, names]) => ({
        label,
        owners: (db.prepare(`SELECT COUNT(DISTINCT owner_id) AS n FROM events WHERE created_at >= ? AND name IN (${names.map(() => '?').join(',')})`).get(since, ...names) as Row).n as number,
      }));
      const daily = db.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(DISTINCT owner_id) AS active,
          SUM(name='gen_started') AS gens, SUM(name='draft_saved') AS drafts FROM events WHERE created_at >= ? GROUP BY day ORDER BY day`).all(since) as Row[];
      const jobs = db.prepare(`SELECT status, COUNT(*) AS n, COALESCE(SUM(cost),0) AS cost FROM jobs WHERE created_at >= ? GROUP BY status`).all(since) as Row[];
      const totals = {
        users: (db.prepare('SELECT COUNT(*) AS n FROM users').get() as Row).n,
        newUsers: (db.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?').get(since) as Row).n,
        feedbackNew: (db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE status='new'").get() as Row).n,
        spentToday: this.spentToday(),
      };
      const events = db.prepare('SELECT name, COUNT(*) AS n FROM events WHERE created_at >= ? GROUP BY name ORDER BY n DESC').all(since) as Row[];
      return { since, funnel, daily, jobs, totals, events };
    },
  };
}
export type Ops = ReturnType<typeof makeOps>;
