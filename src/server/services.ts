// 业务服务：新建工作区种子、排期补齐与调整、生成任务。路由只调用这里和 repo。
import { CADENCE, CATS, HOT_SEED, PERSONAS } from '../shared/catalog.ts';
import { draftResOf, GEN_STEPS, genCost, isDraft, modelOf, shotsOf } from '../shared/gen.ts';
import { addDays, columnOf, isPublishDay, iso, pickNext, slotState, whyOf, windowDates, weekdayOf, shortDate } from '../shared/schedule.ts';
import { WEEKDAYS } from '../shared/catalog.ts';
import { DIAG_QUESTIONS, KIND_NAME, cliches, pickMaterials, type DiagColumn, type DiagReport } from '../shared/kb.ts';
import { composeVideo, extractFrames, hasFfmpeg, probeMedia } from './compose.ts';
import { join } from 'node:path';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { Storage } from './storage/index.ts';
import type { CopyLen, SlotProgress, Asset, GenSettings, Job, PlannedShot, Persona, PersonaId, Plan, Positioning, SlotView, Topic, VideoOutput, Workspace } from '../shared/types.ts';
import type { Repo } from './repo.ts';
import type { Providers } from './providers/types.ts';
import { tx, type DB } from './db.ts';

export const personaOf = (id: PersonaId): Persona => PERSONAS.find(p => p.id === id) ?? PERSONAS[0];
export const catIndex = (id: PersonaId) => PERSONAS.findIndex(p => p.id === id);
export const todayIso = () => process.env.TODAY ?? iso(new Date());

export function defaultPositioning(p: Persona): Positioning {
  const c = catIndex(p.id);
  // 新账号只放行业通用的默认值；名字、标签留空，等新手引导和 AI 面诊填（不再用演示账号「林设计师」之类）
  return {
    name: '',
    line: `帮${p.aud[0]}把${['设计', '装修', '定制', '选材', '软装', '买房', '选房', '出行'][c]}的钱花对`,
    aud: p.aud.slice(0, 2), pillars: [], tone: '亲切', tags: [],
  };
}

/** 发布账号的名字：有账号名用「账号名 · 平台」，没有就「我的抖音」 */
export const accountLabel = (name: string, platform: string) => (name.trim() ? `${name.trim().slice(0, 30)} · ${platform}` : `我的${platform}`);
const platformOf = (account: string) => account.split(' · ').pop()!.replace(/^我的/, '');

/** 新工作区：热门选题（示意）和两个发布账号。不放演示素材、不放演示项目的选题，也不排过去的「已发」 */
export function seedWorkspace(db: DB, repo: Repo, owner: string, persona: PersonaId): Workspace & { ownerId: string } {
  return tx(db, () => {
    const p = personaOf(persona);
    const ws = repo.insertWs(owner, persona, defaultPositioning(p));
    let s = 1000;
    [...HOT_SEED].reverse().forEach(h => repo.insertTopic(ws.id, { ...h, why: '', source: 'hot' }, s++));
    const mix = p.biz.slice(0, 4).map((b, j) => ({ n: b.n, v: [0.8, 0.6, 0.4, 0.25][j] }));
    const hour = persona === 'dev' ? 10 : persona === 'stay' ? 18 : 19.5;
    repo.insertPlan(ws.id, { account: accountLabel('', '抖音'), weekdays: CADENCE[persona], hour, needOk: true, budget: 900, running: true, mix, added: [], skipped: [], backlog: [] });
    repo.insertPlan(ws.id, { account: accountLabel('', '小红书'), weekdays: [5], hour, needOk: true, budget: 300, running: true, mix, added: [], skipped: [], backlog: [] });
    void CATS;
    return ws;
  });
}

/** 示例素材（用户在素材库点「放几段示例」时才加）：标成「示例」，说明按画的场景写 */
export function addSampleAssets(repo: Repo, ws: Workspace): number {
  const p = personaOf(ws.persona);
  const keys = [...new Set([...p.att, 'live', 'kit', 'entry', 'stone'])].filter(k => k !== 'person').slice(0, 6);
  keys.forEach((k, i) => {
    const type = i % 3 === 2 ? '视频' : '照片';
    const a = repo.insertAsset(ws.id, { type, name: `示例 · ${SCENE[k] ?? '空间'}`, k, source: '示例' });
    repo.setAssetNote(ws.id, a.id, `${type === '视频' ? '一段示例视频' : '一张示例照片'}：${SCENE[k] ?? '空间'}`, 'sample');
  });
  return keys.length;
}

/** 人设档案改了：发布账号跟着改名；新选的平台补一个账号 */
export function syncPlans(repo: Repo, ws: Workspace, pos: Positioning) {
  const plans = repo.plans(ws.id), p = personaOf(ws.persona);
  for (const plan of plans) {
    const plat = platformOf(plan.account);
    if (plan.account === accountLabel('', plat) || plan.account.endsWith(` · ${plat}`)) repo.savePlan(ws.id, { ...plan, account: accountLabel(pos.name, plat) });
  }
  const have = new Set(repo.plans(ws.id).map(x => platformOf(x.account)));
  const base = repo.plans(ws.id)[0];
  for (const plat of pos.platforms ?? []) {
    if (have.has(plat)) continue;
    repo.insertPlan(ws.id, { account: accountLabel(pos.name, plat), weekdays: plat === '小红书' ? [5] : CADENCE[ws.persona], hour: base?.hour ?? 19.5, needOk: true, budget: 300, running: true, mix: base?.mix ?? p.biz.slice(0, 4).map((b, j) => ({ n: b.n, v: [0.8, 0.6, 0.4, 0.25][j] })), added: [], skipped: [], backlog: [] });
  }
}

/* ================= 排期 ================= */
function usedTopicIds(repo: Repo, plan: Plan): Set<string> {
  return new Set([...repo.slots(plan.id).map(s => s.topicId), ...plan.backlog]);
}

/**
 * 从今天起，窗口内每个发布日都要有选题：AI 按这一天轮到的栏目预选，等审核。
 * 过去的日子不补（以前会把过去几天标成「已发」，新账号第一天就有一堆没做过的内容）。
 */
export function ensureSchedule(repo: Repo, ws: Workspace, plan: Plan, today = todayIso()) {
  const have = new Map(repo.slots(plan.id).map(s => [s.date, s]));
  const topics = repo.topics(ws.id), used = usedTopicIds(repo, plan), c = catIndex(ws.persona);
  windowDates(today).forEach((date, idx) => {
    if (date < today || !isPublishDay(plan, date) || have.has(date)) return;
    const column = columnOf(plan, idx);
    // 先挑这个栏目的选题（面诊后按栏目生成的），没有再按老规则挑
    let t = topics.find(x => x.dir === column && x.source === 'plan' && !used.has(x.id)) ?? pickNext(topics, used, c);
    if (!t) t = repo.insertTopic(ws.id, { cat: c, title: column ? `${column}：下一条` : '这周的下一条', hook: 'AI 补位选题', why: '', dir: column || '项目案例', type: 0, heat: 1, k: personaOf(ws.persona).att[0], ageMonths: 0, source: 'plan' });
    used.add(t.id);
    repo.upsertSlot({ planId: plan.id, date, topicId: t.id, pin: 'cand', why: t.dir === column && column ? `栏目「${column}」` : whyOf(t), column });
  });
}

export function scheduleView(repo: Repo, ws: Workspace, plan: Plan, today = todayIso()): (SlotView | { date: string; empty: true; weekday: string; label: string })[] {
  ensureSchedule(repo, ws, plan, today);
  const slots = new Map(repo.slots(plan.id).map(s => [s.date, s]));
  const topics = new Map(repo.topics(ws.id).map(t => [t.id, t]));
  const enoughAssets = repo.assets(ws.id).filter(a => a.used < 4).length >= 3;
  return windowDates(today).map(date => {
    const weekday = WEEKDAYS[weekdayOf(date)], label = shortDate(date), s = slots.get(date);
    const t = s && topics.get(s.topicId);
    if (!isPublishDay(plan, date) || !s || !t) return { date, empty: true as const, weekday, label };
    return { ...s, topic: t, weekday, label, state: slotState(date, today, plan, s.pin, enoughAssets) };
  });
}

/* ================= AI 运营 ================= */
/** 每条内容的进度：文案、出片、发布、回填。只认真实记录（以前过去的日子一律按「已发」算，会显示没做过的内容） */
export function withProgress(repo: Repo, ws: Workspace, plan: Plan, days: ReturnType<typeof scheduleView>, _today = todayIso()) {
  const drafts = new Set(repo.drafts(ws.id).map(d => d.topicId));
  const jobs = repo.jobs(ws.id);
  const meta = repo.slotMeta(plan.id);
  return days.map(d => {
    if ('empty' in d) return d;
    const mine = jobs.filter(j => (j.input as GenSettings)?.topicId === d.topicId);
    const sample = mine.find(j => j.kind === 'video');
    const m = meta.get(d.date);
    return { ...d, progress: {
      copy: drafts.has(d.topicId),
      sample: sample ? (sample.status === 'done' ? 'done' : sample.status === 'failed' ? 'failed' : 'running') : 'none',
      final: mine.some(j => j.kind === 'video_final' && j.status === 'done') || (!!sample && sample.status === 'done' && !(sample.output as VideoOutput | null)?.draft),
      published: !!m?.publishedAt, reviewed: !!m?.metrics, jobId: (mine.find(j => j.kind === 'video_final') ?? sample)?.id ?? null, metrics: m?.metrics ?? null,
    } as SlotProgress };
  });
}

/**
 * AI 运营的定时动作（打开 AI 运营页时跑一次，之后接定时任务）：
 * 托管到「自动写文案」：已固定、3 天内要发、还没文案的，按人设和知识库写一版。
 * 10/27 会后取消了自动出样片：任何档位都不会自动花点数生成视频。选题待审的不动。
 */
export async function opsTick(repo: Repo, providers: Providers, _runner: JobRunner, ws: Workspace, today = todayIso()): Promise<string[]> {
  const did: string[] = [];
  for (const plan of repo.plans(ws.id)) {
    if (!plan.running || plan.auto !== 'copy') continue;
    ensureSchedule(repo, ws, plan, today);
    for (const s of repo.slots(plan.id)) {
      if (s.date <= today || s.pin !== 'fixed' || !isPublishDay(plan, s.date)) continue;
      const days = Math.round((Date.parse(s.date) - Date.parse(today)) / 864e5);
      const t = repo.topic(ws.id, s.topicId); if (!t || days > 3 || repo.draftByTopic(ws.id, t.id)) continue;
      try { await writeCopy(repo, providers, ws, t, { column: s.column }); did.push(`写好了 ${s.date.slice(5)} 的文案：${t.title}`); }
      catch (e) { console.warn('AI 运营写文案失败：', (e as Error).message); }
    }
  }
  return did;
}

/* ================= 知识库 → 文案 ================= */
/** 这条该写哪个栏目：没指定就按面诊报告的栏目轮流（第 n 条写第 n % 栏目数 个） */
export function nextColumn(repo: Repo, ws: Workspace): DiagColumn | null {
  const cols = repo.diagnosis(ws.id).report?.columns ?? [];
  return cols.length ? cols[repo.copyCount(ws.id) % cols.length] : null;
}
const reportTags = (r: DiagReport | null) => (r ? [...r.tags.pro, ...r.tags.personality, ...r.tags.brand].slice(0, 6) : undefined);

/**
 * 写一条文案：系统先从知识库挑素材（相关、最近没用过、履历有上限），把说话习惯当语气参考、不说的话当禁区，
 * 交给文案模型；面诊定下的栏目和标签每条都带上；写完自检 AI 腔，命中就让模型改一次；最后记下用了哪几条（下次轮换）。
 */
export async function writeCopy(repo: Repo, providers: Providers, ws: Workspace, t: Topic, o: { len?: CopyLen; column?: string; kb?: boolean; version?: number } = {}) {
  const items = o.kb === false ? [] : repo.kb(ws.id);
  const column = o.column ?? nextColumn(repo, ws)?.name;
  const picked = pickMaterials(items, `${t.title}${t.hook}${column ?? ''}`, { recentResume: repo.recentResume(ws.id) });
  const habits = items.filter(i => i.kind === 'habit').map(i => i.text).slice(0, 5);
  const avoid = items.filter(i => i.kind === 'avoid').map(i => i.text).slice(0, 8);
  const ctx = { persona: personaOf(ws.persona), positioning: ws.positioning };
  const report = repo.diagnosis(ws.id).report;
  let g = await providers.copy.generate(ctx, t, { kind: '口播', len: o.len ?? 45, tone: ws.positioning.tone, version: o.version ?? 1, materials: picked.map(i => ({ kind: KIND_NAME[i.kind], text: i.text })), habits, avoid, column, tags: reportTags(report) });
  const text = () => [g.hook, ...g.body, g.cta].join('');
  const hits = cliches(text());
  if (hits.length) {
    try { const fixed = await providers.copy.rewrite(ctx, { ...g, id: '', updatedAt: '', assetIds: [] }, 'alt', `去掉这些 AI 腔：${hits.join('、')}`); g = { ...g, body: fixed.draft.body }; } catch { /* 改不了就用原稿 */ }
  }
  const d = repo.upsertDraft(ws.id, { ...g, assetIds: [] });
  repo.markKbUsed(ws.id, picked.map(i => i.id), picked.map(i => i.kind));
  return { draft: d, used: picked, cliches: cliches(text()), column: column ?? null };
}

const KIND_TYPE: Record<DiagColumn['kind'], 0 | 1 | 2> = { 流量: 0, 人设: 1, 转化: 2 };
/** 面诊报告的栏目 → 每个栏目几个具体选题（排期按栏目从这里挑）。模型出错时这个栏目先不补，排期会用补位选题 */
export async function seedColumnTopics(repo: Repo, providers: Providers, ws: Workspace, columns: DiagColumn[]) {
  const ctx = { persona: personaOf(ws.persona), positioning: ws.positioning }, kb = repo.kb(ws.id), c = catIndex(ws.persona);
  const have = new Set(repo.topics(ws.id).filter(t => t.source === 'plan').map(t => `${t.dir}|${t.title}`));
  await Promise.all(columns.slice(0, 5).map(async col => {
    const mats = pickMaterials(kb, `${col.name}${col.why}`, { n: 3 }).map(i => i.text);
    const list = await providers.topics.forColumn(ctx, col, mats).catch(e => { console.warn(`栏目「${col.name}」的选题没生成：${(e as Error).message}`); return []; });
    for (const x of list) {
      if (have.has(`${col.name}|${x.title}`)) continue;
      repo.insertTopic(ws.id, { cat: c, title: x.title.slice(0, 60), hook: x.hook.slice(0, 120), why: `栏目「${col.name}」`, dir: col.name, type: KIND_TYPE[col.kind] ?? 0, heat: 2, k: personaOf(ws.persona).att[0], ageMonths: 0, source: 'plan' });
    }
  }));
}

/** 面诊报告（或改过的栏目、标签）写回人设档案：定位、标签、栏目从此每条文案都用 */
export function applyReport(repo: Repo, ws: Workspace, report: DiagReport, today = todayIso()) {
  const pos = repo.ws(ws.id)!.positioning;
  const tags = [...report.tags.personality.slice(0, 2), ...report.tags.pro.slice(0, 2), ...report.tags.brand.slice(0, 1)].map(x => x.slice(0, 12)).filter(Boolean).slice(0, 5);
  repo.setPositioning(ws.id, { ...pos, line: (report.position || pos.line).slice(0, 80), tags, pillars: report.columns.map(c => c.name.slice(0, 20)).slice(0, 8) });
  const weights = [0.8, 0.6, 0.45, 0.3, 0.2];
  for (const plan of repo.plans(ws.id)) {
    repo.savePlan(ws.id, { ...plan, mix: report.columns.slice(0, 5).map((c, i) => ({ n: c.name, v: weights[i] })) });
    repo.clearCandidates(plan.id, today);
  }
}

/** AI 面诊：回答存进知识库（每题一条），再按回答出报告；报告写回人设档案，栏目同步到排期，并按栏目生成选题 */
export async function runDiagnosis(repo: Repo, providers: Providers, ws: Workspace) {
  const d = repo.diagnosis(ws.id);
  const qa = DIAG_QUESTIONS.filter(q => d.answers[q.id]?.trim()).map(q => ({ section: q.section, q: q.q, a: d.answers[q.id] }));
  const report = { ...(await providers.copy.diagnose({ persona: personaOf(ws.persona), positioning: ws.positioning }, qa)), createdAt: new Date().toISOString() };
  repo.saveDiagnosis(ws.id, { ...d, report });
  applyReport(repo, ws, report);
  await seedColumnTopics(repo, providers, repo.ws(ws.id)!, report.columns);
  return report;
}
/** 面诊回答 → 知识库条目（同一题重答就覆盖） */
export function saveAnswer(repo: Repo, ws: Workspace, qid: string, text: string) {
  const q = DIAG_QUESTIONS.find(x => x.id === qid); if (!q) return;
  const d = repo.diagnosis(ws.id);
  repo.saveDiagnosis(ws.id, { ...d, answers: { ...d.answers, [qid]: text } });
  const old = repo.kb(ws.id).find(i => i.source === `面诊:${qid}`);
  if (old) repo.updateKb(ws.id, old.id, { text }); else if (text.trim()) repo.addKb(ws.id, { section: q.section, kind: q.kind, text, source: `面诊:${qid}` });
}

/* ================= 素材：时长、说明 ================= */
/** 示例素材画的是哪个场景（只给示例用；用户上传的素材不按场景猜） */
const SCENE: Record<string, string> = { entry: '玄关', live: '客厅', kit: '厨房', bed: '卧室', stone: '石材台面', site: '施工现场', soft: '软装', store: '门店展厅', hotel: '民宿房间', new: '完工后的空间', old: '改造前的老房', ext: '小区外景', sales: '售楼处', person: '人物出镜' };
/**
 * 素材的一句说明：看图模型看过的用模型的；示例素材按画的场景；其余只按文件名和时长写，不编画面内容
 * （以前上传时按顺序随便配一个场景，柜门封边特写会被说成「民宿房间」，还写进了文案）。
 */
export const describeAsset = (a: Pick<Asset, 'k' | 'type' | 'name'> & Partial<Pick<Asset, 'note' | 'source' | 'dur'>>) => {
  if (a.note) return a.note;
  const nm = a.name ? `（${a.name.replace(/\.[a-z0-9]+$/i, '')}）` : '';
  if (a.source === '示例') return `${a.type === '视频' ? '一段示例视频' : '一张示例照片'}：${SCENE[a.k] ?? '空间'}`;
  return `${a.type === '视频' ? `一段${a.dur ? ` ${a.dur} 秒的` : ''}视频` : a.type === '音频' ? '一段音频' : '一张照片'}${nm}`;
};

/** 上传后读时长和宽高（有 ffprobe 时） */
export function probeAsset(repo: Repo, ws: string, a: Asset, file: string): Asset {
  if (!hasFfmpeg()) return a;
  const m = probeMedia(file);
  if (!m) return a;
  const meta = { dur: a.type === '视频' || a.type === '音频' ? m.dur : null, width: m.width, height: m.height };
  repo.setAssetMeta(ws, a.id, meta);
  return { ...a, ...meta };
}

/** 让看图模型看一遍素材：视频按 15% / 50% / 85% 截 3 张，照片看原图。没配看图模型、读不到文件时原样返回 */
export async function lookAtAsset(repo: Repo, providers: Providers, ws: string, a: Asset, buf: Buffer | null): Promise<Asset> {
  if (!providers.vision || !buf || !hasFfmpeg() || (a.type !== '视频' && a.type !== '照片')) return a;
  const dir = mkdtempSync(join(tmpdir(), 'findai-look-'));
  try {
    const src = join(dir, 'in'); writeFileSync(src, buf);
    const d = a.dur ?? probeMedia(src)?.dur ?? 0;
    const frames = await extractFrames(src, a.type === '视频' && d > 0 ? [d * 0.15, d * 0.5, d * 0.85] : [0]);
    if (!frames.length) return a;
    const v = await providers.vision.describe(frames, { name: a.name, type: a.type === '视频' ? '视频' : '照片', dur: d || null });
    repo.setAssetNote(ws, a.id, v.note, 'ai', v.best);
    return { ...a, note: v.note, noteSrc: 'ai', best: v.best };
  } catch (e) { console.warn(`看图模型没看成「${a.name}」：${(e as Error).message}`); return a; }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

/**
 * 实拍出片：按每段素材写一句画外音，素材顺序就是镜头顺序。
 * read：读素材文件（还没被看图模型看过的，这里补看一次，最多等 25 秒）。
 */
export async function footageCopy(repo: Repo, providers: Providers, ws: Workspace, assetIds: string[], idea: string, read?: (a: Asset) => Promise<Buffer | null>) {
  let assets = repo.assetsByIds(ws.id, assetIds);
  if (providers.vision && read) {
    assets = await Promise.all(assets.map(a => (a.noteSrc === 'ai' || !a.url ? a : Promise.race([
      read(a).then(b => lookAtAsset(repo, providers, ws.id, a, b)),
      new Promise<Asset>(ok => setTimeout(() => ok(a), 25_000)),
    ]).catch(() => a))));
  }
  const clips = assets.map(a => ({ type: a.type, note: describeAsset(a), noteSrc: a.noteSrc ?? (a.source === '示例' ? 'sample' : 'name'), dur: a.dur ?? null }));
  const items = repo.kb(ws.id);
  const picked = pickMaterials(items, idea + clips.map(c => c.note).join(''), { n: 2, recentResume: repo.recentResume(ws.id) });
  const r = await providers.copy.footage({ persona: personaOf(ws.persona), positioning: ws.positioning }, clips, idea, picked.map(i => i.text));
  repo.markKbUsed(ws.id, picked.map(i => i.id), picked.map(i => i.kind));
  return { title: r.title, lines: r.lines, assets: assets.map((a, i) => ({ id: a.id, note: clips[i].note, noteSrc: clips[i].noteSrc, dur: a.dur ?? null, best: a.best ?? null })), used: picked };
}

/** 把某个选题固定到某天。若它原本排在别的未来日期，那天由 AI 补一个预选。返回原来的日期（若有） */
export function setDay(repo: Repo, ws: Workspace, plan: Plan, date: string, topic: Topic, today = todayIso()): string | null {
  let movedFrom: string | null = null;
  plan.backlog = plan.backlog.filter(x => x !== topic.id);
  plan.skipped = plan.skipped.filter(x => x !== date);
  if (!isPublishDay(plan, date)) plan.added = [...new Set([...plan.added, date])];
  repo.savePlan(ws.id, plan);
  const idx = windowDates(today).indexOf(date);
  for (const s of repo.slots(plan.id)) {
    if (s.topicId === topic.id && s.date !== date && s.date > today) {
      movedFrom = s.date;
      const used = usedTopicIds(repo, plan); used.add(topic.id);
      const t2 = pickNext(repo.topics(ws.id), used, catIndex(ws.persona));
      if (t2) repo.upsertSlot({ ...s, topicId: t2.id, pin: 'cand', why: whyOf(t2) });
    }
  }
  repo.upsertSlot({ planId: plan.id, date, topicId: topic.id, pin: 'fixed', why: '你挑的', column: columnOf(plan, Math.max(0, idx)) });
  return movedFrom;
}

export function replaceWithNext(repo: Repo, ws: Workspace, plan: Plan, date: string): Topic | null {
  const s = repo.slots(plan.id).find(x => x.date === date);
  if (!s) return null;
  const t = pickNext(repo.topics(ws.id), usedTopicIds(repo, plan), catIndex(ws.persona));
  if (!t) return null;
  repo.upsertSlot({ ...s, topicId: t.id, pin: 'cand', why: whyOf(t) });
  return t;
}

/** 选题在各账号排期里的位置，供选题卡片显示“已排期 10/24 待审 / 备选池” */
export function scheduleIndex(repo: Repo, ws: Workspace, today = todayIso()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const plan of repo.plans(ws.id)) {
    ensureSchedule(repo, ws, plan, today);
    for (const s of repo.slots(plan.id)) {
      if (!isPublishDay(plan, s.date) || out[s.topicId]) continue;
      if (s.date >= windowDates(today)[0]) out[s.topicId] = `${shortDate(s.date)}${s.pin === 'cand' && s.date > today ? ' 待审' : ''}`;
    }
    plan.backlog.forEach(id => { out[id] ??= '备选池'; });
  }
  return out;
}

export function published(repo: Repo, ws: Workspace, today = todayIso()) {
  const topics = new Map(repo.topics(ws.id).map(t => [t.id, t]));
  return repo.plans(ws.id).flatMap(plan => repo.slots(plan.id)
    .filter(s => s.date < today && isPublishDay(plan, s.date) && topics.has(s.topicId))
    .map(s => ({ title: topics.get(s.topicId)!.title, account: plan.account, date: shortDate(s.date) })));
}

/* ================= 生成任务 ================= */
export interface RunnerOpts {
  compose?: 'auto' | 'off'; font?: string;
  /** 曲库目录：放「温暖钢琴.mp3」这样以音乐名命名的文件（要有版权）；没有这首就不加音乐，并在作品里说明 */
  musicDir?: string;
  /** 文件存储：转存每镜视频和合成好的整条（中转站的视频链接会过期） */
  storage?: Storage;
  onDone?: (ws: string, job: Job, ok: boolean) => void;
  fetch?: typeof fetch;
}

export class JobRunner {
  /** frameUrl：把素材变成视频服务能访问的公网地址（签名、限时）；没配公网地址时返回 null，只用文字生成 */
  constructor(private repo: Repo, private providers: Providers, private opts: RunnerOpts = {}, private frameUrl: (a: Asset) => Promise<string | null> | string | null = () => null) {}

  /** 校验、扣点、建任务，然后在后台跑；返回任务或错误 */
  startVideo(ws: Workspace, g: GenSettings, final: boolean, title: string): { ok: true; job: ReturnType<Repo['insertJob']> } | { ok: false; error: string } {
    const p = personaOf(ws.persona);
    const assets = this.repo.assetsByIds(ws.id, [...new Set([...g.assetIds, ...(g.shots ?? []).flatMap(s => [s.assetId, s.lastId].filter((x): x is string => !!x))])]);
    const shots = shotsOf(g, assets, p.att);
    // 没接配音服务（视频是真实服务时）：成片不带配音，也不收配音费
    const cost = genCost(g, final, { voice: !!this.providers.tts });
    const kind = final ? 'video_final' : 'video';
    const job = this.repo.insertJob(ws.id, { kind, steps: GEN_STEPS, cost, title, input: g });
    if (!this.repo.charge(ws.id, cost, `${final ? '成片' : isDraft(g) ? '样片' : '生成'}：${title}`, job.id)) {
      this.repo.updateJob(job.id, { status: 'failed', error: '余额不足' });
      return { ok: false, error: `余额不足：需要 ${cost} 点` };
    }
    this.repo.markAssetsUsed(ws.id, assets.map(a => a.id));
    this.repo.updateJob(job.id, { status: 'running' });
    this.repo.setJobExternal(job.id, { tasks: shots.map(() => null), shots, final });
    void this.execute(ws.id, job, g, final, shots, assets, []);
    return { ok: true, job: this.repo.job(ws.id, job.id)! };
  }

  /** 服务重启后接着跑：已提交的镜头只查不再提交 */
  resume(wsId: string, job: Job) {
    const ext = this.repo.jobExternal(job.id);
    if (!ext) return;
    const g = job.input as GenSettings;
    console.log(`接着查重启前的任务 ${job.id}（已提交 ${ext.tasks.filter(Boolean).length}/${ext.shots.length} 镜）`);
    void this.execute(wsId, job, g, ext.final, ext.shots, this.repo.assetsByIds(wsId, [...new Set([...g.assetIds, ...ext.shots.map(s => s.assetId).filter((x): x is string => !!x)])]), ext.tasks);
  }

  private async execute(wsId: string, job: Job, g: GenSettings, final: boolean, shots: PlannedShot[], assets: Asset[], known: (string | null)[]) {
    const output: VideoOutput = { type: g.type, draft: !final && isDraft(g), shots, title: job.title, res: !final && isDraft(g) ? draftResOf(g.model) : g.res, ratio: g.ratio, len: shots.reduce((a, s) => a + s.dur, 0) || g.len, model: g.model, voice: g.voice };
    const tasks = shots.map((_, i) => known[i] ?? null);
    const byId = new Map(assets.map(a => [a.id, a]));
    // 每镜用哪张素材：新链路按分镜里指定的；旧链路按顺序轮流
    const assetOf = (s: PlannedShot, i: number): Asset | null => (s.source ? (s.assetId ? byId.get(s.assetId) ?? null : null) : assets.length ? assets[i % assets.length] : null);
    try {
      const frames = await Promise.all(shots.map((s, i) => {
        const a = assetOf(s, i);
        return known[i] || s.reused || s.source === 'clip' || !a ? null : this.frameUrl(a);
      }));
      // 素材原片：不生成，直接用素材文件
      const clips = shots.map((s, i) => (s.source === 'clip' ? assetOf(s, i)?.url ?? null : null));
      const r = await this.providers.video.run({
        settings: g, shots, final, frames, known,
        onTask: (i, id) => { tasks[i] = id; this.repo.setJobExternal(job.id, { tasks, shots, final }); },
      }, step => this.repo.updateJob(job.id, { step }));
      const errors = r?.errors ?? [];
      // 有镜头失败：其余照常出片，失败那几镜的点数退回
      const failed = shots.map((_, i) => errors[i]).map((e, i) => (e ? i : -1)).filter(i => i >= 0);
      if (failed.length) {
        const per = (i: number) => { const m = modelOf(shots[i].model || g.model); return Math.round(shots[i].dur * (output.draft && m.draft ? m.pd : m.pf)); };
        const back = Math.min(job.cost, failed.reduce((a, i) => a + per(i), 0));
        failed.forEach(i => { shots[i].failed = errors[i]!; });
        output.partial = true;
        if (back > 0) this.repo.refund(wsId, back, `${failed.length} 镜没生成成功，退回这几镜的点数`, job.id);
      }
      const videos = r?.shotVideos ? r.shotVideos.map((u, i) => clips[i] ?? u) : clips.some(Boolean) ? clips : null;
      if (videos) await this.saveOutputs(wsId, job.id, g, output, videos);
      this.repo.updateJob(job.id, { status: 'done', step: GEN_STEPS.length, output });
      this.opts.onDone?.(wsId, job, true);
    } catch (err) {
      this.repo.updateJob(job.id, { status: 'failed', error: String((err as Error)?.message ?? err) });
      this.repo.refund(wsId, job.cost, '生成失败退点', job.id);
      this.opts.onDone?.(wsId, job, false);
    }
  }

  /**
   * 生成完成后：每镜视频下载下来转存到自己的存储（中转站链接 24 小时左右就失效），再合成整条。
   * 转存或合成失败都不让任务失败（钱已经花了）：转存失败就先用中转站链接，合成失败各镜还能单独播。
   */
  private async saveOutputs(wsId: string, jobId: string, g: GenSettings, output: VideoOutput, urls: (string | null)[]) {
    const st = this.opts.storage, f = this.opts.fetch ?? fetch;
    const tmp = mkdtempSync(join(tmpdir(), 'findai-out-'));
    const local: string[] = [];
    try {
      output.shots = await Promise.all(output.shots.map(async (s, i) => {
        const src = urls[i] ?? null;
        if (!src) return { ...s, videoUrl: null };
        // 本站已有的文件（沿用上一版的镜头、素材原片）：不再转存，读出来参与合成
        if (src.startsWith('/files/')) {
          const buf = st ? await st.get(src.slice(7).split('?')[0]).catch(() => null) : null;
          if (buf) { const p = join(tmp, `s${i}.mp4`); writeFileSync(p, buf); local[i] = p; }
          return { ...s, videoUrl: src };
        }
        if (!st) { local[i] = src; return { ...s, videoUrl: src }; }
        try {
          const res = await f(src, { signal: AbortSignal.timeout(180_000) });
          if (!res.ok) throw new Error(`下载失败（${res.status}）`);
          const buf = Buffer.from(await res.arrayBuffer());
          const key = `${wsId}/${jobId}/shot${i + 1}.mp4`;
          await st.put(key, buf, 'video/mp4');
          const p = join(tmp, `s${i}.mp4`); writeFileSync(p, buf); local[i] = p;
          return { ...s, videoUrl: `/files/${key}`, sourceUrl: src };
        } catch (e) {
          console.warn(`转存第 ${i + 1} 镜失败，先用中转站链接：${(e as Error).message}`);
          local[i] = src;
          return { ...s, videoUrl: src };
        }
      }));
      const idx = output.shots.map((_, i) => i).filter(i => local[i]);
      if (idx.length && this.opts.compose !== 'off' && hasFfmpeg()) {
        try {
          const out = join(tmp, 'final.mp4');
          const voice = await this.voiceTrack(wsId, jobId, g, output, idx, tmp);
          const music = g.bgm && g.bgm !== '不要' ? findMusic(this.opts.musicDir, g.bgm) : null;
          const notes = [...voice.notes, ...(g.bgm && g.bgm !== '不要' && !music ? [`曲库里还没有「${g.bgm}」，这条没加音乐`] : [])];
          // 每镜裁到它的时长（生成时向上取整多出来的部分去掉）；素材原片从选定的秒数开始；配音比画面长时画面定格到说完
          const r = await composeVideo({
            urls: idx.map(i => local[i]), lines: idx.map(i => output.shots[i].line), durs: idx.map(i => output.shots[i].dur), starts: idx.map(i => output.shots[i].start ?? 0),
            ratio: g.ratio, res: output.res, outFile: out, font: this.opts.font, subtitles: g.subs,
            voices: voice.files, music, musicVol: g.bgmVol ?? 0.2, keepOrig: idx.map(i => g.ambience && output.shots[i].source === 'clip'), origVol: 0.25,
          });
          output.len = Math.round(r.secs);
          if (notes.length) output.audioNote = notes.join('；');
          const key = `${wsId}/${jobId}.mp4`;
          if (st) { await st.put(key, readFileSync(out), 'video/mp4'); output.videoUrl = `/files/${key}`; }
        } catch (e) { output.composeError = String((e as Error).message ?? e).slice(0, 200); }
      }
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }

  /** 每镜配音：写到临时目录参与合成；真实配音另存一份到存储 */
  private async voiceTrack(wsId: string, jobId: string, g: GenSettings, output: VideoOutput, idx: number[], tmp: string): Promise<{ files: (string | null)[]; notes: string[] }> {
    const tts = this.providers.tts;
    if (g.voice === 'none') return { files: idx.map(() => null), notes: [] };
    if (!tts) return { files: idx.map(() => null), notes: ['配音服务还没接，这条成片没有配音（字幕照常）'] };
    const notes: string[] = [];
    let voice: string = g.voice;
    // 声音复刻接上之前，「本人声音」先用平台音色
    if (voice === 'me' && tts.kind !== 'mock') { voice = 'p1'; notes.push('复刻的声音还没接进配音服务，这条先用沉稳男声'); }
    const files = await Promise.all(idx.map(async i => {
      const line = output.shots[i].line.trim();
      if (!line) return null;
      try {
        const r = await tts.synth(line, { voice, speed: g.speed, emotion: g.emotion });
        const file = join(tmp, `v${i}.${r.ext}`); writeFileSync(file, r.audio);
        if (this.opts.storage && tts.kind !== 'mock') {
          const key = `${wsId}/${jobId}/voice${i + 1}.${r.ext}`;
          await this.opts.storage.put(key, r.audio, r.ext === 'mp3' ? 'audio/mpeg' : 'audio/wav');
          output.shots[i].voiceUrl = `/files/${key}`;
        }
        return file;
      } catch (e) { notes.push(`第 ${i + 1} 镜配音没生成：${(e as Error).message}`); return null; }
    }));
    if (tts.kind === 'mock') notes.push('开发版没接配音服务，配音是静音占位');
    return { files, notes };
  }

  startVoiceClone(ws: Workspace, sample: { bytes: number; mime: string }) {
    this.repo.setVoiceClone(ws.id, 'busy');
    this.providers.voice.clone(sample)
      .then(() => this.repo.setVoiceClone(ws.id, 'ready'))
      .catch(() => this.repo.setVoiceClone(ws.id, 'none'));
  }
}

/** 曲库里按名字找音乐文件 */
export function findMusic(dir: string | undefined, name: string): string | null {
  if (!dir) return null;
  for (const ext of ['mp3', 'm4a', 'aac', 'wav']) { const f = join(dir, `${name}.${ext}`); if (existsSync(f)) return f; }
  return null;
}

export { addDays };
