// node:sqlite 的 DatabaseSync，用 sql.js（纯 JS 版 SQLite）实现；每次写完稍后把整个库存进 IndexedDB。
import { idbPut } from './vfs.ts';
type SqlJs = { Database: new (data?: Uint8Array) => any };
let SQL: SqlJs | null = null, initial: Uint8Array | null = null;
export function setSqlJs(s: SqlJs, saved: Uint8Array | null) { SQL = s; initial = saved; }
const val = (v: unknown) => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v;
export class DatabaseSync {
  private db: any; private t: ReturnType<typeof setTimeout> | null = null;
  constructor(_file: string) { if (!SQL) throw new Error('sql.js 还没加载'); this.db = new SQL.Database(initial ?? undefined); initial = null; }
  private dirty() { if (this.t) clearTimeout(this.t); this.t = setTimeout(() => { try { idbPut('db', this.db.export()); } catch { /* 忽略 */ } }, 400); }
  exec(sql: string) { this.db.exec(sql); if (!/^\s*(PRAGMA|SELECT)/i.test(sql)) this.dirty(); }
  prepare(sql: string) {
    const db = this.db, self = this;
    const bind = (st: any, ps: unknown[]) => { if (ps.length) st.bind(ps.map(val)); };
    return {
      run(...ps: unknown[]) { const st = db.prepare(sql); try { bind(st, ps); st.step(); } finally { st.free(); } const changes = db.getRowsModified(); const last = db.exec('SELECT last_insert_rowid() AS id')[0]?.values?.[0]?.[0] ?? 0; self.dirty(); return { changes, lastInsertRowid: last }; },
      get(...ps: unknown[]) { const st = db.prepare(sql); try { bind(st, ps); return st.step() ? st.getAsObject() : undefined; } finally { st.free(); } },
      all(...ps: unknown[]) { const st = db.prepare(sql); const out: unknown[] = []; try { bind(st, ps); while (st.step()) out.push(st.getAsObject()); } finally { st.free(); } return out; },
    };
  }
  close() { /* 不需要 */ }
  export() { return this.db.export(); }
}
