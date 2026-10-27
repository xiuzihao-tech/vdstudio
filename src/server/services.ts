// 业务服务：新建工作区种子、排期补齐与调整、生成任务。路由只调用这里和 repo。
import { CADENCE, CATS, HOT_SEED, PERSONAS } from '../shared/catalog.ts';
import { draftResOf, GEN_STEPS, genCost, isDraft, modelOf, shotsOf } from '../shared/gen.ts';
import { addDays, columnOf, isPublishDay, iso, pickNext, slotState, whyOf, windowDates, weekdayOf, shortDate } from '../shared/schedule.ts';
import { WEEKDAYS } from '../shared/catalog.ts';
import { buildStoryboard, splitSentences, suggestType, typeOf } from '../shared/video.ts';
import { composeVideo, hasFfmpeg } from './compose.ts';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { Storage } from './storage/index.ts';
import type { CopyDraft, SlotProgress, Asset, GenSettings, Job, PlannedShot, Persona, PersonaId, Plan, Positioning, SlotView, Topic, VideoOutput, Workspace } from '../shared/types.ts';
import type { Repo } from './repo.ts';
import type { Providers } from './providers/types.ts';
import { tx, type DB } from './db.ts';

export const personaOf = (id: PersonaId): Persona => PERSONAS.find(p => p.id === id) ?? PERSONAS[0];
export const catIndex = (id: PersonaId) => PERSONAS.findIndex(p => p.id === id);
export const todayIso = () => process.env.TODAY ?? iso(new Date());

export function defaultPositioning(p: Persona): Positioning {
  const c = catIndex(p.id);
  return {
    name: p.acct.split(' · ')[0],
    line: `帮${p.aud[0]}把${['设计', '装修', '定制', '选材', '软装', '买房', '选房', '出行'][c]}的钱花对`,
    aud: p.aud.slice(0, 2), pillars: p.biz.slice(0, 3).map(b => b.n), tone: '亲切', tags: ['说真话', '懂细节', '不推销'],
  };
}

/** 新工作区：人设自带选题、热门选题、示例素材、两个发布账号 */
export function seedWorkspace(db: DB, repo: Repo, owner: string, persona: PersonaId): Workspace & { ownerId: string } {
  return tx(db, () => {
    const p = personaOf(persona), c = catIndex(persona);
    const ws = repo.insertWs(owner, persona, defaultPositioning(p));
    let s = 1000;
    [...HOT_SEED].reverse().forEach(h => repo.insertTopic(ws.id, { ...h, why: '', source: 'hot' }, s++));
    [...p.topics].reverse().forEach((t, i) => repo.insertTopic(ws.id, {
      cat: c, title: t[0], hook: t[1], why: t[2], dir: '项目案例', type: ([2, 0, 1] as const)[2 - i], heat: 2,
      k: (p.biz[2 - i] ?? p.biz[0]).k, ageMonths: 1, source: 'case',
    }, s++));
    const keys = [...new Set([...p.att, 'live', 'kit', 'bed', 'entry', 'stone', 'soft'])].slice(0, 10);
    [...keys].reverse().forEach((k, ri) => {
      const i = keys.length - 1 - ri, type = k === 'person' ? '人物' : i % 4 === 2 ? '视频' : '照片';
      repo.insertAsset(ws.id, { type, name: `${p.proj.split(' ')[0]} · ${type} ${String(i + 1).padStart(2, '0')}`, k, used: i < 3 ? 4 : i % 3, source: '项目上传' }, s++);
    });
    const mix = p.biz.slice(0, 4).map((b, j) => ({ n: b.n, v: [0.8, 0.6, 0.4, 0.25][j] }));
    const hour = persona === 'dev' ? 10 : persona === 'stay' ? 18 : 19.5;
    repo.insertPlan(ws.id, { account: p.acct, weekdays: CADENCE[persona], hour, needOk: true, budget: 900, running: true, mix, added: [], skipped: [], backlog: [] });
    repo.insertPlan(ws.id, { account: p.acct2, weekdays: [5], hour, needOk: true, budget: 300, running: true, mix, added: [], skipped: [], backlog: [] });
    void CATS;
    return ws;
  });
}

/* ================= 排期 ================= */
function usedTopicIds(repo: Repo, plan: Plan): Set<string> {
  return new Set([...repo.slots(plan.id).map(s => s.topicId), ...plan.backlog]);
}

/** 窗口内每个发布日都要有选题：过去和今天的视为已定，未来的由 AI 预选、等审核 */
export function ensureSchedule(repo: Repo, ws: Workspace, plan: Plan, today = todayIso()) {
  const have = new Map(repo.slots(plan.id).map(s => [s.date, s]));
  const topics = repo.topics(ws.id), used = usedTopicIds(repo, plan), c = catIndex(ws.persona);
  windowDates(today).forEach((date, idx) => {
    if (!isPublishDay(plan, date) || have.has(date)) return;
    let t = pickNext(topics, used, c);
    if (!t) t = repo.insertTopic(ws.id, { cat: c, title: `${personaOf(ws.persona).focus.split('，')[0]}的另一个角度`, hook: 'AI 补位选题', why: '', dir: '项目案例', type: 0, heat: 1, k: personaOf(ws.persona).att[0], ageMonths: 0, source: 'plan' });
    used.add(t.id);
    repo.upsertSlot({ planId: plan.id, date, topicId: t.id, pin: date <= today ? 'fixed' : 'cand', why: date <= today ? '已做好' : whyOf(t), column: columnOf(plan, idx) });
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
/** 每条内容的进度：文案、样片、成片、发布、回填。过去的日子没有发布记录时按「已发」算（老数据） */
export function withProgress(repo: Repo, ws: Workspace, plan: Plan, days: ReturnType<typeof scheduleView>, today = todayIso()) {
  const drafts = new Set(repo.drafts(ws.id).map(d => d.topicId));
  const jobs = repo.jobs(ws.id);
  const meta = repo.slotMeta(plan.id);
  return days.map(d => {
    if ('empty' in d) return d;
    const mine = jobs.filter(j => (j.input as GenSettings)?.topicId === d.topicId);
    const sample = mine.find(j => j.kind === 'video');
    const m = meta.get(d.date);
    return { ...d, progress: {
      copy: drafts.has(d.topicId) || d.date < today,
      sample: sample ? (sample.status === 'done' ? 'done' : sample.status === 'failed' ? 'failed' : 'running') : d.date < today ? 'done' : 'none',
      final: mine.some(j => j.kind === 'video_final' && j.status === 'done') || d.date < today,
      published: !!m?.publishedAt || d.date < today, reviewed: !!m?.metrics, jobId: (mine.find(j => j.kind === 'video_final') ?? sample)?.id ?? null, metrics: m?.metrics ?? null,
    } as SlotProgress };
  });
}

/**
 * AI 运营的定时动作（每 10 分钟跑一次，打开 AI 运营页时也跑）：
 * 托管到「自动写文案」：已固定、3 天内要发、还没文案的，按人设写一版；
 * 托管到「自动出样片」：2 天内要发、有文案、还没样片的，按推荐类型出样片（超出每月上限就停）。
 * 选题待审的不动——没拍板的内容不往下走。
 */
export async function opsTick(repo: Repo, providers: Providers, runner: JobRunner, ws: Workspace, today = todayIso()): Promise<string[]> {
  const did: string[] = [];
  const p = personaOf(ws.persona);
  for (const plan of repo.plans(ws.id)) {
    if (!plan.running || plan.auto === 'plan') continue;
    ensureSchedule(repo, ws, plan, today);
    for (const s of repo.slots(plan.id)) {
      if (s.date <= today || s.pin !== 'fixed' || !isPublishDay(plan, s.date)) continue;
      const days = Math.round((Date.parse(s.date) - Date.parse(today)) / 864e5);
      const t = repo.topic(ws.id, s.topicId); if (!t) continue;
      let draft = repo.draftByTopic(ws.id, t.id);
      if (!draft && days <= 3) {
        try {
          const g = await providers.copy.generate({ persona: p, positioning: ws.positioning }, t, { kind: '口播', len: 45, tone: ws.positioning.tone, version: 1 });
          draft = repo.upsertDraft(ws.id, { ...g, assetIds: [] });
          did.push(`写好了 ${s.date.slice(5)} 的文案：${t.title}`);
        } catch (e) { console.warn('AI 运营写文案失败：', (e as Error).message); }
      }
      if (plan.auto !== 'sample' || !draft || days > 2) continue;
      if (repo.jobs(ws.id).some(j => (j.input as GenSettings)?.topicId === t.id)) continue;
      const g = autoSettings(repo, ws, draft);
      const month = today.slice(0, 7);
      const mineTopics = new Set(repo.slots(plan.id).map(x => x.topicId));
      const spent = repo.jobs(ws.id).filter(j => j.createdAt.slice(0, 7) === month && mineTopics.has((j.input as GenSettings)?.topicId ?? '')).reduce((a, j) => a + j.cost, 0);
      if (spent + genCost(g) > plan.budget) { did.push(`这个月的预算快用完了，${s.date.slice(5)} 的样片先不出`); continue; }
      const r = runner.startVideo(repo.ws(ws.id)!, g, false, draft.title);
      did.push(r.ok ? `开始出 ${s.date.slice(5)} 的样片：${draft.title}` : `${s.date.slice(5)} 的样片没出：${r.error}`);
    }
  }
  return did;
}

/** AI 运营自动出样片用的设置：按文案推荐类型、按句拆分镜、用工作区素材；数字人可用才出镜 */
export function autoSettings(repo: Repo, ws: Workspace, draft: CopyDraft): GenSettings {
  const copy = [draft.hook, ...draft.body, draft.cta].filter(Boolean).join('\n');
  const type = suggestType(copy), spec = typeOf(type), m = modelOf(spec.model);
  const assets = repo.assets(ws.id).filter(a => a.type !== '人物' && a.type !== '音频').slice(0, 6);
  const avatar = ws.avatars.clone === 'ready' ? 'clone' : ws.avatars.photo === 'ready' ? 'photo' : 'none';
  const shots = buildStoryboard(splitSentences(copy), { type, model: m, assets: assets.map(a => ({ id: a.id, type: a.type })), avatar: avatar !== 'none' });
  return { copy, prompt: '', title: draft.title, topicId: draft.topicId, assetIds: assets.map(a => a.id), model: spec.model, len: shots.reduce((a, x) => a + x.dur, 0), ratio: '9:16', res: '720p', draft: true,
    voice: ws.voiceClone === 'ready' ? 'me' : 'p1', speed: 1, bgm: spec.bgm, subs: true, ambience: true, cover: false, style: 'AI 推荐', type, avatar, shots };
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
    const cost = genCost(g, final);
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
          // 每镜裁到它的时长（生成时向上取整多出来的部分去掉）
          await composeVideo({ urls: idx.map(i => local[i]), lines: idx.map(i => output.shots[i].line), durs: idx.map(i => output.shots[i].dur), ratio: g.ratio, res: output.res, outFile: out, font: this.opts.font, subtitles: g.subs });
          const key = `${wsId}/${jobId}.mp4`;
          if (st) { await st.put(key, readFileSync(out), 'video/mp4'); output.videoUrl = `/files/${key}`; }
        } catch (e) { output.composeError = String((e as Error).message ?? e).slice(0, 200); }
      }
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }

  startVoiceClone(ws: Workspace, sample: { bytes: number; mime: string }) {
    this.repo.setVoiceClone(ws.id, 'busy');
    this.providers.voice.clone(sample)
      .then(() => this.repo.setVoiceClone(ws.id, 'ready'))
      .catch(() => this.repo.setVoiceClone(ws.id, 'none'));
  }
}

export { addDays };
