// 积分发放和邀请赠送：注册赠送、分享链接邀请（双方得点）、好友充值返点、首充奖励、每日分享奖励。
// 规则全在技能中心的「积分规则」「邀请赠送」里，后台改了马上生效。每一笔奖励有唯一的 key（rewards 表），重复触发不会多发；
// 发现刷号可以整条邀请「收回奖励」（扣回，扣到 0 为止）。
import { randomBytes } from 'node:crypto';
import { newId, now, tx, type DB } from './db.ts';
import type { Skills } from './skills/registry.ts';
import type { LedgerKind } from '../shared/points.ts';

type Row = Record<string, any>;
export interface ReferralCfg {
  enabled: boolean;
  invite: { inviterPoints: number; inviteePoints: number; rewardOn: 'register' | 'first_gen' | 'first_pay'; dailyCap: number; monthlyCap: number; ipDailyLimit: number };
  rebate: { rate: number; scope: 'first' | 'all'; days: number; capPerInvitee: number };
  firstRecharge: { fixed: number; rate: number };
  shareDaily: number; shareTitle: string; shareText: string; rules: string[];
}
export interface PointsCfg { pointName: string; secondsPerPoint: number; sampleRate: number; sampleMin: number; minCost: number; initialPoints: number | null; signupBonus: number; lowBalance: number; diagPrice: number; orderTtlMin: number; packages: { id: string; n: string; price: number; points: number; bonus: number; tag?: string }[] }
export type RefStatus = 'pending' | 'rewarded' | 'capped' | 'blocked' | 'revoked';
export const REF_STATUS_NAME: Record<RefStatus, string> = { pending: '等好友出片 / 充值', rewarded: '已奖励', capped: '超过上限没奖励', blocked: '同一网络重复注册', revoked: '奖励已收回' };

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
const maskEmail = (e: string | null) => !e ? '—' : e.replace(/^(.{1,2}).*(@.*)$/, (_, a, b) => `${a}***${b}`);

export function makeGrowth(db: DB, skills: Skills) {
  const ref = () => skills.config<ReferralCfg>('referral');
  const pts = () => skills.config<PointsCfg>('points');
  const wsOf = (owner: string) => (db.prepare('SELECT current_ws FROM owners WHERE id=?').get(owner) as Row | undefined)?.current_ws as string | undefined
    ?? (db.prepare('SELECT id FROM workspaces WHERE owner_id=? LIMIT 1').get(owner) as Row | undefined)?.id as string | undefined;

  /** 加 / 减点（减不会减成负数）；返回实际变动 */
  function grant(owner: string, delta: number, kind: LedgerKind, reason: string): number {
    if (!delta) return 0;
    return tx(db, () => {
      const r = db.prepare('SELECT balance FROM owners WHERE id=?').get(owner) as Row | undefined;
      if (!r) return 0;
      const real = delta < 0 ? -Math.min(r.balance as number, -delta) : delta;
      if (!real) return 0;
      db.prepare('UPDATE owners SET balance = balance + ? WHERE id=?').run(real, owner);
      db.prepare('INSERT INTO ledger (id, ws, delta, reason, job_id, created_at, owner_id, kind) VALUES (?,?,?,?,?,?,?,?)').run(newId('led'), wsOf(owner) ?? `owner:${owner}`, real, reason, null, now(), owner, kind);
      return real;
    });
  }
  /** 一次性奖励：同一个 key 只发一次 */
  function reward(key: string, owner: string, points: number, kind: LedgerKind, reason: string, refs: { referralId?: string; orderId?: string } = {}): number {
    if (points <= 0) return 0;
    return tx(db, () => {
      const ins = db.prepare('INSERT OR IGNORE INTO rewards (key, owner_id, kind, points, referral_id, order_id, created_at) VALUES (?,?,?,?,?,?,?)').run(key, owner, kind, points, refs.referralId ?? null, refs.orderId ?? null, now());
      return ins.changes ? grant(owner, points, kind, reason) : 0;
    });
  }

  function newCode(): string {
    for (let i = 0; i < 20; i++) {
      const b = randomBytes(6), c = [...b].map(x => CODE_CHARS[x % CODE_CHARS.length]).join('');
      if (!db.prepare('SELECT 1 FROM users WHERE ref_code=?').get(c)) return c;
    }
    return randomBytes(5).toString('hex').toUpperCase();
  }
  /** 账号的邀请码（没有就现在生成） */
  function codeOf(userId: string): string {
    const r = db.prepare('SELECT ref_code FROM users WHERE id=?').get(userId) as Row | undefined;
    if (!r) throw new Error('没有这个用户');
    if (r.ref_code) return r.ref_code;
    const c = newCode();
    db.prepare('UPDATE users SET ref_code=? WHERE id=?').run(c, userId);
    return c;
  }
  const inviterByCode = (code: string) => db.prepare('SELECT id, owner_id, email, ref_code FROM users WHERE ref_code=?').get(code.trim().toUpperCase()) as Row | undefined;
  const referralOf = (inviteeOwner: string) => db.prepare('SELECT * FROM referrals WHERE invitee_owner=?').get(inviteeOwner) as Row | undefined;

  /** 发注册奖励（受每天 / 每月上限限制） */
  function activate(id: string): RefStatus {
    const c = ref(), r = db.prepare('SELECT * FROM referrals WHERE id=?').get(id) as Row | undefined;
    if (!r || r.status !== 'pending') return (r?.status ?? 'pending') as RefStatus;
    return tx(db, () => {
      const dayStart = `${dayKey()}T00:00:00.000Z`, monthStart = new Date(Date.now() - 30 * 864e5).toISOString();
      const nDay = (db.prepare(`SELECT COUNT(*) AS n FROM referrals WHERE inviter_owner=? AND status='rewarded' AND activated_at >= ?`).get(r.inviter_owner, dayStart) as Row).n as number;
      const nMonth = (db.prepare(`SELECT COUNT(*) AS n FROM referrals WHERE inviter_owner=? AND status='rewarded' AND activated_at >= ?`).get(r.inviter_owner, monthStart) as Row).n as number;
      if ((c.invite.dailyCap && nDay >= c.invite.dailyCap) || (c.invite.monthlyCap && nMonth >= c.invite.monthlyCap)) {
        db.prepare(`UPDATE referrals SET status='capped', activated_at=?, note=? WHERE id=?`).run(now(), nDay >= c.invite.dailyCap ? '超过每天上限' : '超过每月上限', id);
        // 被邀请的人照样拿自己那份
        reward(`invite:${id}:invitee`, r.invitee_owner, c.invite.inviteePoints, 'gift_invited', '受邀注册奖励', { referralId: id });
        return 'capped';
      }
      db.prepare(`UPDATE referrals SET status='rewarded', activated_at=? WHERE id=?`).run(now(), id);
      reward(`invite:${id}:inviter`, r.inviter_owner, c.invite.inviterPoints, 'gift_invite', '邀请好友注册', { referralId: id });
      reward(`invite:${id}:invitee`, r.invitee_owner, c.invite.inviteePoints, 'gift_invited', '受邀注册奖励', { referralId: id });
      return 'rewarded';
    });
  }

  return {
    grant, reward, codeOf,
    /** 新访客（没注册）的试用点数 */
    initialPoints: (fallback: number) => pts().initialPoints ?? fallback,
    /** 分享链接被点开 */
    click(code: string) {
      const u = inviterByCode(code); if (!u) return false;
      db.prepare('INSERT INTO ref_clicks (code, day, n) VALUES (?,?,1) ON CONFLICT(code, day) DO UPDATE SET n = n + 1').run(u.ref_code ?? code.trim().toUpperCase(), dayKey());
      return true;
    },
    /** 注册成功后：注册赠送 + 记邀请关系 +（按规则）发邀请奖励 */
    onRegister(u: { userId: string; ownerId: string; ip: string | null; code?: string | null }): { signup: number; referral: RefStatus | null; inviter?: string } {
      const signup = reward(`signup:${u.userId}`, u.ownerId, pts().signupBonus, 'gift_signup', '注册赠送');
      const c = ref(), code = (u.code ?? '').trim().toUpperCase();
      if (!code || !c.enabled) return { signup, referral: null };
      const inv = inviterByCode(code);
      if (!inv || inv.owner_id === u.ownerId || referralOf(u.ownerId)) return { signup, referral: null };
      const id = newId('ref');
      const sameIp = u.ip ? (db.prepare(`SELECT COUNT(*) AS n FROM referrals WHERE code=? AND ip=? AND created_at >= ?`).get(code, u.ip, new Date(Date.now() - 864e5).toISOString()) as Row).n as number : 0;
      const blocked = c.invite.ipDailyLimit > 0 && sameIp >= c.invite.ipDailyLimit;
      db.prepare('INSERT INTO referrals (id, inviter_owner, invitee_owner, invitee_user, code, ip, status, created_at, note) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, inv.owner_id, u.ownerId, u.userId, code, u.ip, blocked ? 'blocked' : 'pending', now(), blocked ? `同一网络 24 小时内第 ${sameIp + 1} 个` : '');
      const status = blocked ? 'blocked' : c.invite.rewardOn === 'register' ? activate(id) : 'pending';
      return { signup, referral: status, inviter: inv.email };
    },
    /** 第一次出片成功：等出片才发奖励的邀请现在发 */
    onFirstGen(owner: string) {
      const r = referralOf(owner);
      if (r?.status === 'pending' && ref().invite.rewardOn === 'first_gen') activate(r.id);
    },
    /** 订单付款到账后：首充奖励、邀请返点（等充值才发的邀请奖励也在这里发） */
    onPaid(order: { id: string; ownerId: string; product: string; points: number }) {
      if (order.product !== 'points' || order.points <= 0) return { first: 0, rebate: 0 };
      const c = ref();
      const paidBefore = (db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE owner_id=? AND product='points' AND status='paid' AND id != ?`).get(order.ownerId, order.id) as Row).n as number;
      let first = 0, rebate = 0;
      if (!paidBefore) first = reward(`first:${order.ownerId}`, order.ownerId, c.firstRecharge.fixed + Math.floor(order.points * c.firstRecharge.rate), 'gift_first', '首次充值奖励', { orderId: order.id });
      const r = referralOf(order.ownerId);
      if (!r || !c.enabled || r.status === 'blocked' || r.status === 'revoked') return { first, rebate };
      if (r.status === 'pending' && c.invite.rewardOn === 'first_pay') activate(r.id);
      const inDays = !c.rebate.days || Date.now() - Date.parse(r.created_at) <= c.rebate.days * 864e5;
      if (c.rebate.rate > 0 && inDays && (c.rebate.scope === 'all' || !paidBefore)) {
        const got = (db.prepare(`SELECT COALESCE(SUM(points),0) AS s FROM rewards WHERE referral_id=? AND kind='gift_rebate' AND revoked=0`).get(r.id) as Row).s as number;
        const amt = Math.min(Math.floor(order.points * c.rebate.rate), c.rebate.capPerInvitee ? Math.max(0, c.rebate.capPerInvitee - got) : Infinity);
        rebate = reward(`rebate:${order.id}`, r.inviter_owner, amt, 'gift_rebate', '好友充值返点', { referralId: r.id, orderId: order.id });
      }
      return { first, rebate };
    },
    /** 订单退款：这笔订单带出来的奖励（首充、返点）一起收回 */
    onRefund(orderId: string) {
      return tx(db, () => {
        const rows = db.prepare('SELECT * FROM rewards WHERE order_id=? AND revoked=0').all(orderId) as Row[];
        for (const w of rows) { db.prepare('UPDATE rewards SET revoked=1 WHERE key=?').run(w.key); grant(w.owner_id, -w.points, 'revoke', '订单退款，收回奖励'); }
        return rows.length;
      });
    },
    /** 每天第一次分享 */
    onShare(owner: string) { return reward(`share:${owner}:${dayKey()}`, owner, ref().shareDaily, 'gift_share', '分享奖励'); },
    /** 后台：收回一条邀请的全部奖励 */
    revoke(id: string, note: string) {
      return tx(db, () => {
        const r = db.prepare('SELECT * FROM referrals WHERE id=?').get(id) as Row | undefined;
        if (!r) throw new Error('没有这条邀请');
        let back = 0;
        for (const w of db.prepare('SELECT * FROM rewards WHERE referral_id=? AND revoked=0').all(id) as Row[]) {
          db.prepare('UPDATE rewards SET revoked=1 WHERE key=?').run(w.key);
          back += -grant(w.owner_id, -w.points, 'revoke', '收回邀请奖励');
        }
        db.prepare(`UPDATE referrals SET status='revoked', revoked_at=?, note=? WHERE id=?`).run(now(), note.slice(0, 120), id);
        return back;
      });
    },

    /** 前台「邀请有礼」：我的链接、数据、记录 */
    mine(userId: string, ownerId: string) {
      const code = codeOf(userId), c = ref();
      const rows = db.prepare(`SELECT r.*, u.email, u.name, (SELECT COALESCE(SUM(amount),0) FROM orders o WHERE o.owner_id=r.invitee_owner AND o.status='paid') AS paid
        FROM referrals r LEFT JOIN users u ON u.id=r.invitee_user WHERE r.inviter_owner=? ORDER BY r.created_at DESC LIMIT 100`).all(ownerId) as Row[];
      const earned = (db.prepare(`SELECT COALESCE(SUM(points),0) AS s FROM rewards WHERE owner_id=? AND kind IN ('gift_invite','gift_rebate') AND revoked=0`).get(ownerId) as Row).s as number;
      const pointsOf = (refId: string) => (db.prepare(`SELECT COALESCE(SUM(points),0) AS s FROM rewards WHERE referral_id=? AND owner_id=? AND revoked=0`).get(refId, ownerId) as Row).s as number;
      const clicks = (db.prepare('SELECT COALESCE(SUM(n),0) AS n FROM ref_clicks WHERE code=?').get(code) as Row).n as number;
      return {
        code, clicks, earned, enabled: c.enabled,
        invited: rows.length, rewarded: rows.filter(r => r.status === 'rewarded').length, recharged: rows.filter(r => r.paid > 0).length,
        cfg: { inviter: c.invite.inviterPoints, invitee: c.invite.inviteePoints, rate: c.rebate.rate, days: c.rebate.days, rewardOn: c.invite.rewardOn, shareTitle: c.shareTitle, shareText: c.shareText, shareDaily: c.shareDaily, rules: rulesText(c) },
        records: rows.map(r => ({ who: r.name || maskEmail(r.email), email: maskEmail(r.email), createdAt: r.created_at as string, status: r.status as RefStatus, statusName: REF_STATUS_NAME[r.status as RefStatus], paid: r.paid > 0, points: pointsOf(r.id) })),
      };
    },
    /** 注册页：这个邀请码是谁的、注册能多得几点 */
    preview(code: string) {
      const u = inviterByCode(code), c = ref();
      if (!u || !c.enabled) return null;
      return { name: (db.prepare('SELECT name FROM users WHERE id=?').get(u.id) as Row).name as string, bonus: c.invite.inviteePoints + pts().signupBonus };
    },

    /* ---------- 后台 ---------- */
    adminList(q: { status?: string; search?: string; limit?: number }) {
      const where: string[] = [], args: (string | number)[] = [];
      if (q.status) { where.push('r.status=?'); args.push(q.status); }
      if (q.search) { where.push('(ui.email LIKE ? OR ue.email LIKE ? OR r.code LIKE ?)'); args.push(`%${q.search}%`, `%${q.search}%`, `%${q.search.toUpperCase()}%`); }
      const rows = db.prepare(`SELECT r.*, ui.email AS inviterEmail, ui.name AS inviterName, ue.email AS inviteeEmail, ue.name AS inviteeName,
          (SELECT COALESCE(SUM(amount),0) FROM orders o WHERE o.owner_id=r.invitee_owner AND o.status='paid') AS paid,
          (SELECT COALESCE(SUM(points),0) FROM rewards w WHERE w.referral_id=r.id AND w.owner_id=r.inviter_owner AND w.revoked=0) AS inviterPoints,
          (SELECT COALESCE(SUM(points),0) FROM rewards w WHERE w.referral_id=r.id AND w.owner_id=r.invitee_owner AND w.revoked=0) AS inviteePoints
        FROM referrals r LEFT JOIN users ui ON ui.owner_id=r.inviter_owner LEFT JOIN users ue ON ue.id=r.invitee_user
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.created_at DESC LIMIT ?`).all(...args, Math.min(500, q.limit ?? 200)) as Row[];
      return rows.map(r => ({ id: r.id as string, code: r.code as string, inviter: r.inviterEmail as string | null, inviterName: r.inviterName as string | null, invitee: r.inviteeEmail as string | null, inviteeName: r.inviteeName as string | null,
        ip: r.ip as string | null, status: r.status as RefStatus, statusName: REF_STATUS_NAME[r.status as RefStatus], note: r.note as string, createdAt: r.created_at as string, activatedAt: r.activated_at as string | null,
        paid: r.paid as number, inviterPoints: r.inviterPoints as number, inviteePoints: r.inviteePoints as number }));
    },
    adminStats(sinceIso: string) {
      const one = (sql: string, ...a: (string | number)[]) => (db.prepare(sql).get(...a) as Row);
      const clicks = one('SELECT COALESCE(SUM(n),0) AS n FROM ref_clicks WHERE day >= ?', sinceIso.slice(0, 10)).n as number;
      const regs = one('SELECT COUNT(*) AS n FROM referrals WHERE created_at >= ?', sinceIso).n as number;
      const rewarded = one(`SELECT COUNT(*) AS n FROM referrals WHERE status='rewarded' AND created_at >= ?`, sinceIso).n as number;
      const payers = one(`SELECT COUNT(DISTINCT r.id) AS n, COALESCE(SUM(o.amount),0) AS amount FROM referrals r JOIN orders o ON o.owner_id=r.invitee_owner AND o.status='paid' WHERE r.created_at >= ?`, sinceIso);
      const points = db.prepare(`SELECT kind, COALESCE(SUM(points),0) AS s FROM rewards WHERE revoked=0 AND created_at >= ? GROUP BY kind`).all(sinceIso) as Row[];
      const top = db.prepare(`SELECT u.email, u.name, COUNT(*) AS n, SUM(r.status='rewarded') AS ok,
          (SELECT COALESCE(SUM(points),0) FROM rewards w WHERE w.owner_id=r.inviter_owner AND w.kind IN ('gift_invite','gift_rebate') AND w.revoked=0) AS earned
        FROM referrals r LEFT JOIN users u ON u.owner_id=r.inviter_owner WHERE r.created_at >= ? GROUP BY r.inviter_owner ORDER BY n DESC LIMIT 10`).all(sinceIso) as Row[];
      return { clicks, registrations: regs, rewarded, payers: payers.n as number, payAmount: payers.amount as number, points: Object.fromEntries(points.map(p => [p.kind, p.s])), top };
    },
  };
}
/** 给用户看的规则说明（把 {inviter} 之类换成数） */
export function rulesText(c: ReferralCfg): string[] {
  const v: Record<string, string> = { inviter: String(c.invite.inviterPoints), invitee: String(c.invite.inviteePoints), rate: `${Math.round(c.rebate.rate * 100)}%`, days: String(c.rebate.days), dailyCap: String(c.invite.dailyCap), monthlyCap: String(c.invite.monthlyCap) };
  return c.rules.map(r => r.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m)).filter(r => !(c.rebate.rate <= 0 && /充值/.test(r) && /返|再得/.test(r)));
}
export type Growth = ReturnType<typeof makeGrowth>;
