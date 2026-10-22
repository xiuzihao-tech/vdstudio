// 业务服务：新建工作区种子、排期补齐与调整、生成任务。路由只调用这里和 repo。
import { CADENCE, CATS, HOT_SEED, PERSONAS } from '../shared/catalog.ts';
import { GEN_STEPS, genCost, isDraft, planShots } from '../shared/gen.ts';
import { addDays, columnOf, isPublishDay, iso, pickNext, slotState, whyOf, windowDates, weekdayOf, shortDate } from '../shared/schedule.ts';
import { WEEKDAYS } from '../shared/catalog.ts';
import { composeVideo, hasFfmpeg } from './compose.ts';
import { join } from 'node:path';
import type { Asset, GenSettings, Job, Persona, PersonaId, Plan, Positioning, SlotView, Topic, VideoOutput, Workspace } from '../shared/types.ts';
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
export interface RunnerOpts { compose?: 'auto' | 'off'; font?: string; filesDir?: string; onDone?: (ws: string, job: Job, ok: boolean) => void }

export class JobRunner {
  /** frameUrl：把素材变成视频服务能访问的公网地址（签名、限时）；没配公网地址时返回 null，只用文字生成 */
  constructor(private repo: Repo, private providers: Providers, private opts: RunnerOpts = {}, private frameUrl: (a: Asset) => string | null = () => null) {}

  /** 校验、扣点、建任务，然后在后台跑；返回任务或错误 */
  startVideo(ws: Workspace, g: GenSettings, final: boolean, title: string): { ok: true; job: ReturnType<Repo['insertJob']> } | { ok: false; error: string } {
    const p = personaOf(ws.persona);
    const assets = this.repo.assetsByIds(ws.id, g.assetIds);
    const shots = planShots(g, assets.map(a => a.k), p.att);
    const cost = genCost(g, final);
    const kind = final ? 'video_final' : 'video';
    const job = this.repo.insertJob(ws.id, { kind, steps: GEN_STEPS, cost, title, input: g });
    if (!this.repo.charge(ws.id, cost, `${final ? '成片' : isDraft(g) ? '样片' : '生成'}：${title}`, job.id)) {
      this.repo.updateJob(job.id, { status: 'failed', error: '余额不足' });
      return { ok: false, error: `余额不足：需要 ${cost} 点` };
    }
    this.repo.markAssetsUsed(ws.id, g.assetIds);
    this.repo.updateJob(job.id, { status: 'running' });
    const output: VideoOutput = { draft: !final && isDraft(g), shots, title, res: !final && isDraft(g) ? '480p' : g.res, ratio: g.ratio, len: g.len, model: g.model, voice: g.voice };
    const frames = shots.map((_, i) => assets.length ? this.frameUrl(assets[i % assets.length]) : null);
    this.providers.video.run({ settings: g, shots, final, frames }, step => this.repo.updateJob(job.id, { step }))
      .then(async r => {
        if (r?.shotVideos) {
          output.shots = output.shots.map((s, i) => ({ ...s, videoUrl: r.shotVideos![i] ?? null }));
          // 合成整条并存到自己的存储（方舟视频链接 24 小时过期）。合成失败不影响任务成功，各镜还能单独播
          const urls = r.shotVideos.filter((u): u is string => !!u);
          if (urls.length && this.opts.compose !== 'off' && this.opts.filesDir && hasFfmpeg()) {
            const rel = `${ws.id}/${job.id}.mp4`;
            try {
              await composeVideo({ urls, lines: output.shots.filter(s => s.videoUrl).map(s => s.line), ratio: g.ratio, res: output.res, outFile: join(this.opts.filesDir, rel), font: this.opts.font, subtitles: g.subs });
              output.videoUrl = `/files/${rel}`;
            } catch (e) { output.composeError = String((e as Error).message ?? e).slice(0, 200); }
          }
        }
        this.repo.updateJob(job.id, { status: 'done', step: GEN_STEPS.length, output });
        this.opts.onDone?.(ws.id, job, true);
      })
      .catch(err => { this.repo.updateJob(job.id, { status: 'failed', error: String(err?.message ?? err) }); this.repo.refund(ws.id, cost, '生成失败退点', job.id); this.opts.onDone?.(ws.id, job, false); });
    return { ok: true, job: this.repo.job(ws.id, job.id)! };
  }

  startVoiceClone(ws: Workspace, sample: { bytes: number; mime: string }) {
    this.repo.setVoiceClone(ws.id, 'busy');
    this.providers.voice.clone(sample)
      .then(() => this.repo.setVoiceClone(ws.id, 'ready'))
      .catch(() => this.repo.setVoiceClone(ws.id, 'none'));
  }
}

export { addDays };
