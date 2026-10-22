// 账号：注册、登录、会话、匿名数据并入。密码用 scrypt（Node 内置），会话令牌 32 字节随机数，只存在 HttpOnly Cookie。
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { DB } from './db.ts';
import { newId, now, tx } from './db.ts';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const SESSION_DAYS = 30;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, s, k] = stored.split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const want = Buffer.from(k, 'base64');
  const got = await scrypt(pw, Buffer.from(s, 'base64'), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

export interface User { id: string; email: string; name: string; ownerId: string }
type Row = Record<string, any>;
const toUser = (r: Row): User => ({ id: r.id, email: r.email, name: r.name, ownerId: r.owner_id });

/** 简单的登录失败限流：同一邮箱 15 分钟内最多失败 5 次（单进程内存，上线后换 Redis） */
const fails = new Map<string, number[]>();
export function tooManyFails(email: string) {
  const t = Date.now(), L = (fails.get(email) ?? []).filter(x => t - x < 15 * 60e3);
  fails.set(email, L);
  return L.length >= 5;
}
const noteFail = (email: string) => fails.set(email, [...(fails.get(email) ?? []), Date.now()]);

export function makeAuth(db: DB) {
  const userByEmail = (email: string) => { const r = db.prepare('SELECT * FROM users WHERE email=?').get(email) as Row | undefined; return r ? { user: toUser(r), hash: r.pass_hash as string } : null; };
  const ownerHasData = (owner: string) => !!db.prepare('SELECT 1 FROM workspaces WHERE owner_id=? LIMIT 1').get(owner);

  /** 把匿名 owner 的工作区并进账号：账号里没有的身份整个搬过去，已有的身份保留账号里的 */
  function mergeAnon(anonOwner: string | undefined, userOwner: string): number {
    if (!anonOwner || anonOwner === userOwner) return 0;
    if (db.prepare('SELECT 1 FROM users WHERE owner_id=?').get(anonOwner)) return 0; // 不能吞别人的账号
    const have = new Set((db.prepare('SELECT persona FROM workspaces WHERE owner_id=?').all(userOwner) as Row[]).map(r => r.persona));
    const anon = db.prepare('SELECT id, persona FROM workspaces WHERE owner_id=?').all(anonOwner) as Row[];
    let n = 0;
    for (const w of anon) if (!have.has(w.persona)) { db.prepare('UPDATE workspaces SET owner_id=? WHERE id=?').run(userOwner, w.id); n++; }
    const cur = (db.prepare('SELECT current_ws FROM owners WHERE id=?').get(anonOwner) as Row | undefined)?.current_ws;
    if (n && cur && (db.prepare('SELECT owner_id FROM workspaces WHERE id=?').get(cur) as Row | undefined)?.owner_id === userOwner)
      db.prepare('UPDATE owners SET current_ws=? WHERE id=?').run(cur, userOwner);
    return n;
  }

  function newSession(userId: string): { token: string; maxAge: number } {
    const token = randomBytes(32).toString('base64url');
    const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)').run(token, userId, now(), exp);
    return { token, maxAge: SESSION_DAYS * 86400 };
  }

  return {
    userBySession(token: string | undefined): User | null {
      if (!token) return null;
      const r = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at > ?').get(token, now()) as Row | undefined;
      return r ? toUser(r) : null;
    },
    /** 注册：如果当前是匿名用户且有数据，直接把这个匿名 owner 升级成账号的 owner，数据原样保留 */
    async register(email: string, password: string, name: string, anonOwner: string | undefined) {
      if (userByEmail(email)) return { ok: false as const, error: '这个邮箱已经注册过了，直接登录' };
      const hash = await hashPassword(password);
      return tx(db, () => {
        let owner = anonOwner && ownerHasData(anonOwner) && !db.prepare('SELECT 1 FROM users WHERE owner_id=?').get(anonOwner) ? anonOwner : null;
        if (!owner) { owner = newId('own'); db.prepare('INSERT INTO owners (id, created_at) VALUES (?,?)').run(owner, now()); }
        const id = newId('usr');
        db.prepare('INSERT INTO users (id, email, name, pass_hash, owner_id, created_at) VALUES (?,?,?,?,?,?)').run(id, email, name, hash, owner, now());
        return { ok: true as const, user: { id, email, name, ownerId: owner }, session: newSession(id), kept: owner === anonOwner };
      });
    },
    async login(email: string, password: string, anonOwner: string | undefined) {
      if (tooManyFails(email)) return { ok: false as const, error: '尝试次数太多，15 分钟后再试' };
      const hit = userByEmail(email);
      if (!hit || !(await verifyPassword(password, hit.hash))) { noteFail(email); return { ok: false as const, error: '邮箱或密码不对' }; }
      fails.delete(email);
      const merged = tx(db, () => mergeAnon(anonOwner, hit.user.ownerId));
      return { ok: true as const, user: hit.user, session: newSession(hit.user.id), merged };
    },
    logout(token: string | undefined) { if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token); },
    purgeExpired() { db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now()); },
  };
}
export type Auth = ReturnType<typeof makeAuth>;
