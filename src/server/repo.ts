// 数据访问层：只做读写和行映射，不放业务规则。
import type { DB } from './db.ts';
import { newId, now } from './db.ts';
import type { Asset, CopyDraft, Job, Plan, Positioning, Slot, Topic, Workspace, PersonaId, TopicSource, VoiceCloneState } from '../shared/types.ts';

type Row = Record<string, any>;
const j = (s: string | null) => (s == null ? null : JSON.parse(s));

const toWs = (r: Row): Workspace => ({ id: r.id, persona: r.persona, positioning: j(r.positioning), balance: r.balance, voiceClone: r.voice_clone, theme: r.theme });
const toTopic = (r: Row): Topic => ({ id: r.id, cat: r.cat, title: r.title, hook: r.hook, why: r.why, dir: r.dir, type: r.type, heat: r.heat, k: r.k, ageMonths: r.age_months, source: r.source, fav: !!r.fav, createdAt: r.created_at });
const toAsset = (r: Row): Asset => ({ id: r.id, type: r.type, name: r.name, k: r.k, url: r.file ? `/files/${r.file}` : null, mime: r.mime, size: r.size, used: r.used, source: r.source, createdAt: r.created_at });
const toJob = (r: Row): Job => ({ id: r.id, kind: r.kind, status: r.status, step: r.step, steps: j(r.steps), cost: r.cost, title: r.title, input: j(r.input), output: j(r.output), error: r.error, createdAt: r.created_at, updatedAt: r.updated_at });
const toPlan = (r: Row): Plan => ({ id: r.id, account: r.account, weekdays: j(r.weekdays), hour: r.hour, needOk: !!r.need_ok, budget: r.budget, running: !!r.running, mix: j(r.mix), added: j(r.added), skipped: j(r.skipped), backlog: j(r.backlog) });
const toSlot = (r: Row): Slot => ({ planId: r.plan_id, date: r.date, topicId: r.topic_id, pin: r.pin, why: r.why, column: r.col });

export function makeRepo(db: DB) {
  let seq = Date.now();
  const nextSeq = () => ++seq;
  return {
    /* ---------- 身份与工作区 ---------- */
    ownerExists: (id: string) => !!db.prepare('SELECT 1 FROM owners WHERE id=?').get(id),
    createOwner(): string { const id = newId('own'); db.prepare('INSERT INTO owners (id, created_at) VALUES (?,?)').run(id, now()); return id; },
    currentWsId: (owner: string) => (db.prepare('SELECT current_ws FROM owners WHERE id=?').get(owner) as Row | undefined)?.current_ws as string | null,
    setCurrentWs: (owner: string, ws: string) => { db.prepare('UPDATE owners SET current_ws=? WHERE id=?').run(ws, owner); },
    wsByPersona(owner: string, persona: PersonaId): Workspace | null { const r = db.prepare('SELECT * FROM workspaces WHERE owner_id=? AND persona=?').get(owner, persona) as Row | undefined; return r ? toWs(r) : null; },
    ws(id: string): Workspace | null { const r = db.prepare('SELECT * FROM workspaces WHERE id=?').get(id) as Row | undefined; return r ? toWs(r) : null; },
    insertWs(owner: string, persona: PersonaId, positioning: Positioning): Workspace {
      const id = newId('ws');
      db.prepare('INSERT INTO workspaces (id, owner_id, persona, positioning, created_at) VALUES (?,?,?,?,?)').run(id, owner, persona, JSON.stringify(positioning), now());
      return this.ws(id)!;
    },
    setPositioning: (ws: string, p: Positioning) => { db.prepare('UPDATE workspaces SET positioning=? WHERE id=?').run(JSON.stringify(p), ws); },
    setVoiceClone: (ws: string, s: VoiceCloneState) => { db.prepare('UPDATE workspaces SET voice_clone=? WHERE id=?').run(s, ws); },
    setTheme: (ws: string, t: string) => { db.prepare('UPDATE workspaces SET theme=? WHERE id=?').run(t, ws); },

    /* ---------- 点数 ---------- */
    /** 扣点；余额不足返回 false。delta 为正数表示扣除 */
    charge(ws: string, amount: number, reason: string, jobId: string | null): boolean {
      const r = db.prepare('UPDATE workspaces SET balance = balance - ? WHERE id=? AND balance >= ?').run(amount, ws, amount);
      if (!r.changes) return false;
      db.prepare('INSERT INTO ledger (id, ws, delta, reason, job_id, created_at) VALUES (?,?,?,?,?,?)').run(newId('led'), ws, -amount, reason, jobId, now());
      return true;
    },
    refund(ws: string, amount: number, reason: string, jobId: string) {
      db.prepare('UPDATE workspaces SET balance = balance + ? WHERE id=?').run(amount, ws);
      db.prepare('INSERT INTO ledger (id, ws, delta, reason, job_id, created_at) VALUES (?,?,?,?,?,?)').run(newId('led'), ws, amount, reason, jobId, now());
    },

    /* ---------- 选题 ---------- */
    topics(ws: string): Topic[] { return (db.prepare('SELECT * FROM topics WHERE ws=? ORDER BY seq DESC').all(ws) as Row[]).map(toTopic); },
    topic(ws: string, id: string): Topic | null { const r = db.prepare('SELECT * FROM topics WHERE ws=? AND id=?').get(ws, id) as Row | undefined; return r ? toTopic(r) : null; },
    insertTopic(ws: string, t: Omit<Topic, 'id' | 'createdAt' | 'fav'> & { fav?: boolean }, seqOverride?: number): Topic {
      const id = newId('tp');
      db.prepare(`INSERT INTO topics (id, ws, cat, title, hook, why, dir, type, heat, k, age_months, source, fav, created_at, seq) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, ws, t.cat, t.title, t.hook, t.why, t.dir, t.type, t.heat, t.k, t.ageMonths, t.source as TopicSource, t.fav ? 1 : 0, now(), seqOverride ?? nextSeq());
      return this.topic(ws, id)!;
    },
    setFav: (ws: string, id: string, fav: boolean) => db.prepare('UPDATE topics SET fav=? WHERE ws=? AND id=?').run(fav ? 1 : 0, ws, id).changes > 0,

    /* ---------- 文案草稿（一选题一稿） ---------- */
    drafts(ws: string): CopyDraft[] { return (db.prepare('SELECT data FROM drafts WHERE ws=? ORDER BY updated_at DESC').all(ws) as Row[]).map(r => j(r.data)); },
    draftByTopic(ws: string, topicId: string): CopyDraft | null { const r = db.prepare('SELECT data FROM drafts WHERE ws=? AND topic_id=?').get(ws, topicId) as Row | undefined; return r ? j(r.data) : null; },
    upsertDraft(ws: string, d: Omit<CopyDraft, 'id' | 'updatedAt'>): CopyDraft {
      const old = this.draftByTopic(ws, d.topicId);
      const full: CopyDraft = { ...d, id: old?.id ?? newId('cp'), updatedAt: now() };
      db.prepare(`INSERT INTO drafts (id, ws, topic_id, data, updated_at) VALUES (?,?,?,?,?)
        ON CONFLICT(ws, topic_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`).run(full.id, ws, d.topicId, JSON.stringify(full), full.updatedAt);
      return full;
    },

    /* ---------- 素材 ---------- */
    assets(ws: string): Asset[] { return (db.prepare('SELECT * FROM assets WHERE ws=? ORDER BY seq DESC').all(ws) as Row[]).map(toAsset); },
    assetsByIds(ws: string, ids: string[]): Asset[] { const all = this.assets(ws); return ids.map(id => all.find(a => a.id === id)).filter((a): a is Asset => !!a); },
    insertAsset(ws: string, a: { type: string; name: string; k: string; file?: string | null; mime?: string | null; size?: number; used?: number; source: string }, seqOverride?: number): Asset {
      const id = newId('as');
      db.prepare('INSERT INTO assets (id, ws, type, name, k, file, mime, size, used, source, created_at, seq) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, ws, a.type, a.name, a.k, a.file ?? null, a.mime ?? null, a.size ?? 0, a.used ?? 0, a.source, now(), seqOverride ?? nextSeq());
      return toAsset(db.prepare('SELECT * FROM assets WHERE id=?').get(id) as Row);
    },
    markAssetsUsed(ws: string, ids: string[]) { const st = db.prepare('UPDATE assets SET used = used + 1 WHERE ws=? AND id=?'); ids.forEach(id => st.run(ws, id)); },
    deleteAsset: (ws: string, id: string) => db.prepare('DELETE FROM assets WHERE ws=? AND id=?').run(ws, id).changes > 0,

    /* ---------- 任务 ---------- */
    insertJob(ws: string, j2: Pick<Job, 'kind' | 'steps' | 'cost' | 'title' | 'input'>): Job {
      const id = newId('job'), t = now();
      db.prepare('INSERT INTO jobs (id, ws, kind, status, step, steps, cost, title, input, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, ws, j2.kind, 'queued', 0, JSON.stringify(j2.steps), j2.cost, j2.title, JSON.stringify(j2.input), t, t);
      return this.job(ws, id)!;
    },
    job(ws: string, id: string): Job | null { const r = db.prepare('SELECT * FROM jobs WHERE ws=? AND id=?').get(ws, id) as Row | undefined; return r ? toJob(r) : null; },
    jobs(ws: string, limit = 30): Job[] { return (db.prepare('SELECT * FROM jobs WHERE ws=? ORDER BY created_at DESC LIMIT ?').all(ws, limit) as Row[]).map(toJob); },
    updateJob(id: string, p: Partial<Pick<Job, 'status' | 'step' | 'output' | 'error'>>) {
      const cur = db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as Row;
      db.prepare('UPDATE jobs SET status=?, step=?, output=?, error=?, updated_at=? WHERE id=?')
        .run(p.status ?? cur.status, p.step ?? cur.step, p.output !== undefined ? JSON.stringify(p.output) : cur.output, p.error !== undefined ? p.error : cur.error, now(), id);
    },
    /** 进程重启后，未完成的任务标记失败并退点（Mock 任务在内存里跑，不可恢复） */
    failStaleJobs(): Job[] {
      const rows = (db.prepare("SELECT * FROM jobs WHERE status IN ('queued','running')").all() as Row[]);
      rows.forEach(r => this.updateJob(r.id, { status: 'failed', error: '服务重启，任务中断，点数已退回' }));
      return rows.map(r => ({ ...toJob(r), ws: r.ws } as Job & { ws: string }));
    },

    /* ---------- 排期 ---------- */
    plans(ws: string): Plan[] { return (db.prepare('SELECT * FROM plans WHERE ws=? ORDER BY seq').all(ws) as Row[]).map(toPlan); },
    plan(ws: string, id: string): Plan | null { const r = db.prepare('SELECT * FROM plans WHERE ws=? AND id=?').get(ws, id) as Row | undefined; return r ? toPlan(r) : null; },
    insertPlan(ws: string, p: Omit<Plan, 'id'>): Plan {
      const id = newId('pl');
      db.prepare('INSERT INTO plans (id, ws, account, weekdays, hour, need_ok, budget, running, mix, added, skipped, backlog, seq) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, ws, p.account, JSON.stringify(p.weekdays), p.hour, p.needOk ? 1 : 0, p.budget, p.running ? 1 : 0, JSON.stringify(p.mix), JSON.stringify(p.added), JSON.stringify(p.skipped), JSON.stringify(p.backlog), nextSeq());
      return this.plan(ws, id)!;
    },
    savePlan(ws: string, p: Plan) {
      db.prepare('UPDATE plans SET account=?, weekdays=?, hour=?, need_ok=?, budget=?, running=?, mix=?, added=?, skipped=?, backlog=? WHERE ws=? AND id=?')
        .run(p.account, JSON.stringify(p.weekdays), p.hour, p.needOk ? 1 : 0, p.budget, p.running ? 1 : 0, JSON.stringify(p.mix), JSON.stringify(p.added), JSON.stringify(p.skipped), JSON.stringify(p.backlog), ws, p.id);
    },
    slots(planId: string): Slot[] { return (db.prepare('SELECT * FROM slots WHERE plan_id=? ORDER BY date').all(planId) as Row[]).map(toSlot); },
    upsertSlot(s: Slot) {
      db.prepare(`INSERT INTO slots (plan_id, date, topic_id, pin, why, col) VALUES (?,?,?,?,?,?)
        ON CONFLICT(plan_id, date) DO UPDATE SET topic_id=excluded.topic_id, pin=excluded.pin, why=excluded.why, col=excluded.col`).run(s.planId, s.date, s.topicId, s.pin, s.why, s.column);
    },

    /* ---------- 封面 ---------- */
    covers(ws: string) { return db.prepare('SELECT id, title, style, created_at AS createdAt FROM covers WHERE ws=? ORDER BY created_at DESC').all(ws) as { id: string; title: string; style: string; createdAt: string }[]; },
    insertCover(ws: string, title: string, style: string) { db.prepare('INSERT INTO covers (id, ws, title, style, created_at) VALUES (?,?,?,?,?)').run(newId('cv'), ws, title, style, now()); },
  };
}
export type Repo = ReturnType<typeof makeRepo>;
