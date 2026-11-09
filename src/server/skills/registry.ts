// 技能中心：仓库里的技能包（bundle.gen.ts）是默认值；后台改过的存成版本（skill_versions 表），
// settings 里 skill:<id> 记着现在用哪一版（没有 = 用仓库默认）。改了马上生效，所有版本都留着，可以回滚。
import { SKILL_FILES } from './bundle.gen.ts';
import { validateSkill } from './validate.ts';
import { newId, now, tx, type DB } from '../db.ts';
import type { SkillData, SkillFile, SkillStats, SkillVersion } from '../../shared/skills.ts';

type Row = Record<string, any>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export function makeSkills(db: DB, files: SkillFile[] = SKILL_FILES) {
  const byId = new Map(files.map(f => [f.id, f]));
  const cache = new Map<string, { v: number; data: SkillData }>();
  const listeners: ((id: string) => void)[] = [];
  const pointer = (id: string) => Number((db.prepare('SELECT v FROM settings WHERE k=?').get(`skill:${id}`) as Row | undefined)?.v ?? 0) || 0;
  const setPointer = (id: string, v: number) => {
    if (v) db.prepare('INSERT INTO settings (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(`skill:${id}`, String(v));
    else db.prepare('DELETE FROM settings WHERE k=?').run(`skill:${id}`);
  };
  const fileOf = (id: string) => { const f = byId.get(id); if (!f) throw new Error(`没有这个技能：${id}`); return f; };
  const defaults = (f: SkillFile): SkillData => ({ enabled: true, prompts: { ...f.prompts }, config: clone(f.config) });
  /** 存的版本和仓库默认合并：仓库后来加的新字段 / 新提示词段也能用上 */
  const merge = (f: SkillFile, saved: Partial<SkillData>): SkillData => ({
    enabled: saved.enabled ?? true,
    prompts: { ...f.prompts, ...Object.fromEntries(Object.entries(saved.prompts ?? {}).filter(([k]) => k in f.prompts)) },
    config: { ...clone(f.config), ...(saved.config ?? {}) },
  });
  const rowData = (id: string, v: number) => {
    const r = db.prepare('SELECT data FROM skill_versions WHERE skill=? AND version=?').get(id, v) as Row | undefined;
    return r ? JSON.parse(r.data) as SkillData : null;
  };
  const notify = (id: string) => { cache.delete(id); for (const l of listeners) { try { l(id); } catch (e) { console.warn(`技能 ${id} 生效时出错：`, (e as Error).message); } } };

  const api = {
    files: () => files,
    has: (id: string) => byId.has(id),
    file: fileOf,
    defaults: (id: string) => defaults(fileOf(id)),
    /** 现在生效的数据（带缓存，后台改了立刻失效） */
    data(id: string): SkillData {
      const f = fileOf(id), v = pointer(id), c = cache.get(id);
      if (c && c.v === v) return c.data;
      const saved = v ? rowData(id, v) : null;
      const data = saved ? merge(f, saved) : defaults(f);
      cache.set(id, { v: saved ? v : 0, data });
      return data;
    },
    activeVersion: (id: string) => { const v = pointer(id); return v && rowData(id, v) ? v : 0; },
    config<T = Record<string, unknown>>(id: string): T { return api.data(id).config as T; },
    prompt(id: string, key: string): string { return api.data(id).prompts[key] ?? ''; },
    enabled(id: string): boolean { return api.data(id).enabled; },

    /** 保存成新版本并马上启用 */
    save(id: string, d: SkillData, note: string, author: string): number {
      const f = fileOf(id);
      const data = validateSkill(f, { enabled: d.enabled, prompts: { ...d.prompts }, config: clone(d.config) });
      const v = tx(db, () => {
        const next = ((db.prepare('SELECT MAX(version) AS m FROM skill_versions WHERE skill=?').get(id) as Row).m ?? 0) + 1;
        db.prepare('INSERT INTO skill_versions (id, skill, version, data, note, author, created_at) VALUES (?,?,?,?,?,?,?)').run(newId('skv'), id, next, JSON.stringify(data), note.slice(0, 200), author.slice(0, 80), now());
        setPointer(id, next);
        return next;
      });
      notify(id);
      return v;
    },
    /** 切到某个版本；0 = 恢复仓库默认 */
    activate(id: string, v: number) {
      fileOf(id);
      if (v && !rowData(id, v)) throw new Error(`没有第 ${v} 版`);
      setPointer(id, v);
      notify(id);
    },
    versions(id: string): SkillVersion[] {
      return (db.prepare('SELECT version, note, author, created_at AS createdAt FROM skill_versions WHERE skill=? ORDER BY version DESC LIMIT 100').all(id) as Row[])
        .map(r => ({ version: r.version, note: r.note, author: r.author, createdAt: r.createdAt }));
    },
    version(id: string, v: number): SkillData | null { const d = rowData(id, v); return d ? merge(fileOf(id), d) : null; },
    onChange(fn: (id: string) => void) { listeners.push(fn); },

    /** 记一次调用（path：llm / rule / test / upstream） */
    logCall(id: string, path: string, ok: boolean, ms: number, error?: string | null) {
      try { db.prepare('INSERT INTO skill_calls (skill, path, ok, ms, error, created_at) VALUES (?,?,?,?,?,?)').run(id, path, ok ? 1 : 0, Math.round(ms), error ? error.slice(0, 300) : null, now()); } catch { /* 记日志失败不影响功能 */ }
    },
    stats(id: string, days = 7): SkillStats {
      const since = new Date(Date.now() - days * 864e5).toISOString();
      const r = db.prepare(`SELECT COUNT(*) AS calls, SUM(ok=0) AS fails, SUM(path='llm') AS llm, AVG(ms) AS avgMs, MAX(created_at) AS lastAt FROM skill_calls WHERE skill=? AND created_at >= ?`).get(id, since) as Row;
      const e = db.prepare(`SELECT error FROM skill_calls WHERE skill=? AND ok=0 ORDER BY id DESC LIMIT 1`).get(id) as Row | undefined;
      return { calls: r.calls ?? 0, fails: r.fails ?? 0, llm: r.llm ?? 0, avgMs: Math.round(r.avgMs ?? 0), lastError: e?.error ?? null, lastAt: r.lastAt ?? null };
    },
    recentCalls(id: string, limit = 30) {
      return db.prepare('SELECT path, ok, ms, error, created_at AS createdAt FROM skill_calls WHERE skill=? ORDER BY id DESC LIMIT ?').all(id, limit) as { path: string; ok: number; ms: number; error: string | null; createdAt: string }[];
    },
    /** 调用记录只留 60 天 */
    prune() { db.prepare('DELETE FROM skill_calls WHERE created_at < ?').run(new Date(Date.now() - 60 * 864e5).toISOString()); },
  };
  return api;
}
export type Skills = ReturnType<typeof makeSkills>;
