// 一键生成视频 / 大哲诊断账号的 AI 技能：提示词和规则都从技能中心取（后台能改）。
// 接了大模型（且技能里 useLlm=true、技能没停用）→ 按提示词让模型出，代码校验格式；
// 没接、出错、格式不对 → 按技能 config 里的规则兜底。每次调用都记一条（后台看调用次数、失败率）。
import { z } from 'zod';
import type { Skills } from './skills/registry.ts';
import type { LlmHandle } from './providers/index.ts';
import { renderTemplate, type SkillData } from '../shared/skills.ts';
import {
  ADVISE_DEFAULT, PACK_DEFAULT, REPORT_DEFAULT, STORY_DEFAULT, TOPICS_DEFAULT,
  advise, bannedIn, buildShots, defaultTags, diagResult, layoutShots, liveTypes, makeTopics, pack, splitLines, vtype,
  type AdviseCfg, type DiagColumn, type DiagMsg, type DiagResult, type Mat, type PackCfg, type ReportCfg, type Shot, type StoryCfg, type TopicsCfg, type VType,
} from '../shared/studio.ts';

export interface RunOut<T> {
  out: T; path: 'llm' | 'rule'; ms: number;
  /** 大模型出错后退回规则时的原因 */
  error?: string;
  prompt?: { system: string; user: string; missing: string[] };
  raw?: string; model?: string;
}
type Topic = { title: string; column: string; type: VType; why: string };
export interface DiagAgentCfg { useLlm: boolean; minAnswers: number; maxQuestions: number; stages: string[]; welcome: string; questions: { stage: number; q: string }[]; more: string[]; acks: string[]; demoName: string; demoAnswers: string[] }

const TYPE_IDS = ['tour', 'explain', 'talk', 'before', 'case', 'product', 'site', 'vlog'] as const;
const typeList = () => liveTypes().map(t => `${t.id}：${t.n} —— ${t.d} —— 需要：${t.need}`).join('\n');
const typeIds = () => liveTypes().map(t => t.id).join(' / ');

export function makeStudioAi(skills: Skills, llm: () => LlmHandle | null) {
  /**
   * 跑一个 AI 技能。o.data：用还没保存的草稿跑（后台试运行）；o.force：强制走大模型 / 规则（试运行对比用）
   */
  async function run<T>(id: string, key: string, vars: Record<string, unknown>, schema: z.ZodType<T>, rule: (cfg: Record<string, unknown>) => T,
    o: { data?: SkillData; force?: 'llm' | 'rule'; temperature?: number; quality?: 'fast' | 'fine'; check?: (x: T) => string | null; log?: boolean; extraUser?: string } = {}): Promise<RunOut<T>> {
    const data = o.data ?? skills.data(id), cfg = data.config, t0 = Date.now();
    const sys = renderTemplate(data.prompts.system ?? '', vars), user0 = renderTemplate(data.prompts[key] ?? '', vars);
    const user = { ...user0, text: o.extraUser ? `${user0.text}\n${o.extraUser}` : user0.text };
    const prompt = { system: sys.text, user: user.text, missing: [...new Set([...sys.missing, ...user.missing])] };
    const h = llm();
    const wantLlm = o.force === 'llm' || (o.force !== 'rule' && data.enabled && cfg.useLlm !== false && !!h);
    const log = (path: string, ok: boolean, err?: string) => { if (o.log !== false) skills.logCall(id, path, ok, Date.now() - t0, err); };
    if (wantLlm) {
      if (!h) { const out = rule(cfg); log('rule', true); return { out, path: 'rule', ms: Date.now() - t0, error: '没接文案大模型（上游接口 → 文案大模型）', prompt }; }
      try {
        const r = await h.complete(sys.text, user.text, schema, o.temperature ?? 0.7, o.quality ?? 'fast');
        const bad = o.check?.(r.value);
        if (bad) throw new Error(`模型返回的内容不合格：${bad}`);
        log('llm', true);
        return { out: r.value, path: 'llm', ms: Date.now() - t0, prompt, raw: r.raw, model: r.model };
      } catch (e) {
        const msg = (e as Error).message;
        log('llm', false, msg);
        const out = rule(cfg);
        return { out, path: 'rule', ms: Date.now() - t0, error: msg, prompt };
      }
    }
    const out = rule(cfg);
    log('rule', true);
    return { out, path: 'rule', ms: Date.now() - t0, prompt };
  }

  /* ---------- 出片 · AI 建议 ---------- */
  async function adviseRun(d: { mats: Pick<Mat, 'kind' | 'name'>[]; copy: string; pick: VType | 'auto' }, o: Parameters<typeof run>[5] = {}) {
    const mats = d.mats as Mat[];
    const photos = mats.filter(m => m.kind === 'photo').length, videos = mats.filter(m => m.kind === 'video').length;
    const ruleOf = (cfg: Record<string, unknown>) => advise({ mats, copy: d.copy, pick: d.pick }, { ...ADVISE_DEFAULT, ...cfg } as AdviseCfg);
    if (d.pick !== 'auto') return run('video-advise', 'advise', {}, z.object({ type: z.string(), why: z.string() }), ruleOf, { ...o, force: 'rule' });
    const ids = liveTypes().map(t => t.id) as string[];
    const r = await run('video-advise', 'advise',
      { types: typeList(), photos, videos, names: mats.map(m => m.name).join('、') || '（没有）', copy: d.copy.trim() || '（没有）' },
      z.object({ type: z.string(), why: z.string().max(300) }),
      cfg => { const a = ruleOf(cfg); return { type: a.type, why: a.why }; },
      { ...o, check: x => ids.includes(x.type) ? null : `类型「${x.type}」不在可选列表里` });
    const cfg = { ...ADVISE_DEFAULT, ...(o.data ?? skills.data('video-advise')).config } as AdviseCfg;
    const full = advise({ mats, copy: d.copy, pick: r.out.type as VType }, cfg);
    return { ...r, out: { ...full, why: r.out.why || full.why } };
  }

  /* ---------- 出片 · 分镜 ---------- */
  async function storyboardRun(d: { copy: string; type: VType; face: 'avatar' | 'none'; mats: Mat[]; target?: number }, o: Parameters<typeof run>[5] = {}) {
    const data = o.data ?? skills.data('storyboard'), cfg = { ...STORY_DEFAULT, ...data.config } as StoryCfg;
    const t = vtype(d.type), target = d.target ?? t.secs;
    const scenes = (cfg.scenes[d.type] ?? []).map(s => s[0]).join('、');
    const r = await run('storyboard', 'storyboard', {
      typeName: t.n, typeDesc: t.d, target, charsPerSec: cfg.charsPerSec, minShots: cfg.minShots, maxShots: cfg.maxShots,
      face: d.face === 'avatar' ? '数字人出镜（开头或结尾由数字人说）' : '不露脸（画面全是空间，配音或只放音乐）',
      copy: d.copy.trim() || '（没有文案，按这类片的常见讲法写旁白）', mats: d.mats.length ? d.mats.map((m, i) => `${i + 1}. ${m.kind === 'video' ? '视频' : '照片'}「${m.name}」`).join('；') : '（没有，全部由 AI 生成画面）',
      scenes, faceRule: d.face === 'avatar' ? '最后一个镜头是收尾：数字人出镜说结尾那句。' : '',
    }, z.object({ shots: z.array(z.object({ title: z.string().max(40), line: z.string().min(1).max(200), tip: z.string().max(120).default('') })).min(1).max(20) }),
    c => ({ shots: buildShots(d, target, { ...STORY_DEFAULT, ...c } as StoryCfg).map(s => ({ title: s.title, line: s.line, tip: s.tip })) }),
    { ...o, check: x => {
      if (x.shots.length > cfg.maxShots) return `镜头太多（${x.shots.length} 个）`;
      // 有文案时一句都不能丢：模型的台词拼起来要覆盖原文的大部分
      const src = splitLines(d.copy).join(''), got = x.shots.map(s => s.line).join('');
      return src && got.replace(/\s/g, '').length < src.replace(/\s/g, '').length * 0.7 ? '台词比原文少太多，像是丢了句子' : null;
    } });
    const shots: Shot[] = layoutShots(d, r.out.shots, target, cfg);
    return { ...r, out: { shots } };
  }

  /* ---------- 出片 · 发布包装 ---------- */
  async function packRun(d: { type: VType; lines: string[]; city?: string }, o: Parameters<typeof run>[5] = {}) {
    const data = o.data ?? skills.data('publish-pack'), cfg = { ...PACK_DEFAULT, ...data.config } as PackCfg;
    const city = d.city || cfg.city, t = vtype(d.type);
    const shots = d.lines.map(line => ({ line })) as Shot[];
    const ruleOut = () => pack({ copy: d.lines.join(''), type: d.type, shots }, city, cfg);
    const r = await run('publish-pack', 'pack', {
      typeName: t.n, city, lines: d.lines.map((l, i) => `${i + 1}. ${l}`).join('\n'), titleMax: cfg.titleMax, cta: cfg.cta, banned: cfg.banned.join('、'),
    }, z.object({ title: z.string().min(1).max(80), caption: z.string().min(1).max(800), tags: z.record(z.array(z.string().max(30))) }),
    () => { const p = ruleOut(); return { title: p.title, caption: p.caption, tags: Object.fromEntries(p.tags) }; },
    { ...o, check: x => cfg.banned.find(w => w && (x.title + x.caption).includes(w)) ? `用了敏感词「${cfg.banned.find(w => w && (x.title + x.caption).includes(w))}」` : null });
    const groups = cfg.groups.map(g => g.name);
    const tags: [string, string[]][] = groups.map(g => [g, (r.out.tags[g] ?? []).map(x => x.trim()).filter(Boolean).map(x => x.startsWith('#') ? x : `#${x}`).slice(0, 6)]);
    const fixed = tags.some(([, l]) => l.length) ? tags : ruleOut().tags;
    const title = r.out.title.slice(0, cfg.titleMax);
    return { ...r, out: { title, caption: r.out.caption, tags: fixed, pick: defaultTags(fixed, cfg), banned: bannedIn(title + r.out.caption, cfg), tagMin: cfg.tagMin, tagMax: cfg.tagMax, titleMax: cfg.titleMax } };
  }

  /* ---------- 大哲诊断 · 深聊 ---------- */
  function ruleNext(cfg: DiagAgentCfg, asked: number): DiagMsg & { done: boolean } {
    if (asked >= cfg.maxQuestions) return { who: 'ai', text: cfg.more[cfg.more.length - 1] ?? '差不多了，点右上角「结束并生成诊断」。', stage: 3, n: asked + 1, done: true };
    const qs = cfg.questions;
    if (asked < qs.length) return { who: 'ai', text: `${asked ? cfg.acks[asked % Math.max(1, cfg.acks.length)] ?? '' : ''}${qs[asked].q}`, stage: qs[asked].stage, n: asked + 1, done: false };
    const k = Math.min(asked - qs.length, cfg.more.length - 1);
    return { who: 'ai', text: `${cfg.acks[asked % Math.max(1, cfg.acks.length)] ?? ''}${cfg.more[k]}`, stage: 3, n: asked + 1, done: k === cfg.more.length - 1 };
  }
  async function diagNext(d: { msgs: DiagMsg[]; asked: number }, o: Parameters<typeof run>[5] = {}) {
    const data = o.data ?? skills.data('diag-agent'), cfg = data.config as unknown as DiagAgentCfg;
    const stage = [...d.msgs].reverse().find(m => m.who === 'ai' && m.stage !== undefined)?.stage ?? 0;
    // 第一题、或者已经到上限，直接按题库
    if (d.asked === 0 || d.asked >= cfg.maxQuestions) { const m = ruleNext(cfg, d.asked); return { out: m, path: 'rule' as const, ms: 0 }; }
    const r = await run('diag-agent', 'next', {
      stages: cfg.stages.join(' → '), questions: cfg.questions.map(x => `【${cfg.stages[x.stage]}】${x.q}`).join('\n'),
      transcript: d.msgs.slice(-30).map(m => `${m.who === 'ai' ? '顾问' : '他'}：${m.text}`).join('\n'), asked: d.asked, stage, stageName: cfg.stages[stage] ?? '',
    }, z.object({ stage: z.number().int().min(0).max(3), ack: z.string().max(80).default(''), question: z.string().min(2).max(240), done: z.boolean().default(false) }),
    c => { const m = ruleNext(c as unknown as DiagAgentCfg, d.asked); return { stage: m.stage ?? 0, ack: '', question: m.text, done: m.done }; },
    { ...o, temperature: 0.6 });
    const msg: DiagMsg & { done: boolean } = r.path === 'llm'
      ? { who: 'ai', text: `${r.out.ack}${r.out.question}`, stage: Math.max(stage, r.out.stage), n: d.asked + 1, done: !!r.out.done }
      : { who: 'ai', text: r.out.question, stage: r.out.stage, n: d.asked + 1, done: !!r.out.done };
    return { ...r, out: msg };
  }

  /* ---------- 大哲诊断 · 标签与栏目 ---------- */
  async function diagReport(d: { answers: string[]; name?: string }, o: Parameters<typeof run>[5] = {}) {
    const data = o.data ?? skills.data('diag-report'), cfg = { ...REPORT_DEFAULT, ...data.config } as ReportCfg & { columns: number };
    const ruleOf = (c: Record<string, unknown>) => diagResult(d.answers, d.name || '我', { ...REPORT_DEFAULT, ...c } as ReportCfg);
    // 演示关键词（默认「木里木外」）：直接给示例报告，大模型也不调
    if (cfg.sampleKeyword && d.answers.join('\n').includes(cfg.sampleKeyword)) return run('diag-report', 'report', {}, z.any(), ruleOf, { ...o, force: 'rule' }) as Promise<RunOut<DiagResult>>;
    const col = z.object({ n: z.string().min(1).max(20), d: z.string().max(200), eg: z.string().max(80), freq: z.number().int().min(1).max(7), src: z.string().max(60), type: z.enum(TYPE_IDS), ask: z.string().max(80), unit: z.string().max(6) });
    return run('diag-report', 'report', { answers: d.answers.map((a, i) => `${i + 1}. ${a}`).join('\n'), columns: cfg.columns ?? 4, types: typeIds() },
      z.object({ who: z.string().max(20).default('我'), tags: z.object({ personal: z.array(z.string().max(30)).min(1).max(6), pro: z.array(z.string().max(40)).min(1).max(4), brand: z.array(z.string().max(60)).max(6) }), columns: z.array(col).min(1).max(8) }),
      ruleOf, { ...o, temperature: 0.6, quality: 'fine', check: x => x.columns.length !== (cfg.columns ?? 4) ? `栏目要 ${cfg.columns ?? 4} 档，模型给了 ${x.columns.length} 档` : null }) as Promise<RunOut<DiagResult>>;
  }

  /* ---------- 大哲诊断 · 排选题 ---------- */
  async function diagTopics(d: { result: DiagResult; counts: number[] }, o: Parameters<typeof run>[5] = {}) {
    const data = o.data ?? skills.data('diag-topics'), cfg = { ...TOPICS_DEFAULT, ...data.config } as TopicsCfg;
    const cols: DiagColumn[] = d.result.columns, names = cols.map(c => c.n);
    const r = await run('diag-topics', 'topics', {
      who: d.result.who, tags: [...d.result.tags.personal, ...d.result.tags.pro, ...d.result.tags.brand].join('、'),
      columns: cols.map((c, i) => `${c.n} / ${c.d} / 「${c.eg}」/ 每周 ${c.freq} 条 / ${d.counts[i] ?? 1}${c.unit}`).join('\n'), total: cfg.total, types: typeIds(),
    }, z.object({ topics: z.array(z.object({ title: z.string().min(2).max(60), column: z.string(), type: z.enum(TYPE_IDS), why: z.string().max(120).default('') })).min(1).max(60) }),
    c => ({ topics: makeTopics(cols, d.counts, undefined, { ...TOPICS_DEFAULT, ...c } as TopicsCfg) }),
    { ...o, temperature: 0.8, check: x => {
      const bad = x.topics.find(t => !names.includes(t.column));
      return bad ? `栏目「${bad.column}」不是诊断里的` : x.topics.length < Math.ceil(cfg.total / 2) ? `只给了 ${x.topics.length} 条` : null;
    } });
    return { ...r, out: { topics: r.out.topics.slice(0, cfg.total) as Topic[] } };
  }

  /* ---------- 文案写手（后台试运行用：看素材写画外音） ---------- */
  async function copyTest(d: { clips: string[]; idea: string; vars: Record<string, string> }, o: Parameters<typeof run>[5] = {}) {
    const data = o.data ?? skills.data('copywriter'), P = (k: string) => data.prompts[k] ?? '';
    const clips = d.clips.length ? d.clips : ['客厅全景'];
    return run('copywriter', 'footage', { ...d.vars, count: clips.length },
      z.object({ title: z.string().max(40), lines: z.array(z.string().max(160)).min(1).max(20) }),
      () => ({ title: (d.idea || `${clips[0]}这样做`).slice(0, 24), lines: clips.map((c, i) => i === 0 ? `先别急着装，看看这个${c}。` : i === clips.length - 1 ? `想要同款，${d.vars.goal || '私信聊聊'}。` : `再看${c}，细节在这里。`) }),
      { ...o, data, temperature: 0.8, check: x => x.lines.length === clips.length ? null : `要 ${clips.length} 句，返回了 ${x.lines.length} 句`,
        extraUser: [P('write_style'), `素材（按顺序）：\n${clips.map((c, i) => `${i + 1}. ${c}`).join('\n')}`, d.idea && `用户的想法：${d.idea}`, '输出 JSON：{"title":"标题","lines":["第1句","第2句"]}'].filter(Boolean).join('\n') });
  }

  return { run, advise: adviseRun, storyboard: storyboardRun, pack: packRun, diagNext, diagReport, diagTopics, ruleNext, copyTest };
}
export type StudioAi = ReturnType<typeof makeStudioAi>;
