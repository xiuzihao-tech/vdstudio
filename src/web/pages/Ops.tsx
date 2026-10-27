// AI 运营 · 运营计划：按面诊报告的栏目排两周，学员通过选题、出片、发完点「已发布」、回填数据。10/27 会后取消了自动出样片。
// 不照搬飞书表格；复盘数据可以一键导出表格给助教。
import { useEffect, useState } from 'react';
import { api, type DayView, type PlanBundle } from '../api.ts';
import { useApp, useData } from '../store.tsx';
import { Ph, Seg, Skel, Src } from '../ui/kit.tsx';
import { AddAccount, BudgetNote, Mix, TimeLine, TopicPick } from './Plan.tsx';
import { hourLabel } from '../../shared/schedule.ts';
import { WEEKDAYS } from '../../shared/catalog.ts';
import { copyText } from '../../shared/copy.ts';
import type { DiagReport } from '../../shared/kb.ts';
import type { VideoType } from '../../shared/video.ts';
import type { AutoLevel, CopyDraft, Job, Plan, SlotMetrics, SlotView, VideoOutput } from '../../shared/types.ts';
import { fileUrl } from '../config.ts';

const isSlot = (d: DayView): d is SlotView => !('empty' in d);
const AUTO: [AutoLevel, string, string][] = [['plan', '只排计划', 'AI 按栏目排选题，文案和视频你来做'], ['copy', '自动写文案', '发布前 3 天按人设和知识库写好文案，视频你来出']];
const STAGES = ['选题', '文案', '出片', '已发', '复盘'] as const;

function stageDone(s: SlotView): boolean[] {
  const p = s.progress;
  return [s.pin === 'fixed', !!p?.copy, p?.sample === 'done' || !!p?.final, !!p?.published, !!p?.reviewed];
}
function stageNow(s: SlotView): string {
  const d = stageDone(s), i = d.findIndex(x => !x);
  if (s.state === 'paused') return '已暂停';
  if (s.progress?.sample === 'running') return '视频生成中';
  if (s.progress?.sample === 'failed') return '视频没出成功';
  return i < 0 ? '完成' : i === 0 ? '选题待审' : `待${STAGES[i] === '已发' ? '发布' : STAGES[i]}`;
}

export function OpsPlan({ report }: { report: DiagReport | null }) {
  const { session, toast, fail, nav, sheet, bump, setGenSeed } = useApp();
  const data = useData(async () => {
    const [p, t, d, j] = await Promise.all([api.plans(), api.allTopics(), api.drafts(), api.jobs()]);
    return { plans: p.plans, did: p.did ?? [], topics: t.topics, drafts: d.drafts, jobs: j.jobs };
  }, []);
  const [pi, setPi] = useState(0);
  const [did, setDid] = useState<string[]>([]);
  useEffect(() => { if (data.data?.did.length) setDid(data.data.did); }, [data.data?.did]);
  if (!data.data) return <div className="wrap" style={{ paddingTop: 30 }}><Skel h={300} /></div>;
  const { plans, topics, drafts, jobs } = data.data;
  const pb = plans[Math.min(pi, plans.length - 1)], p = pb.plan, today = session!.today;
  const apply = (r: { plans: PlanBundle[]; message?: string }) => { data.set({ ...data.data!, plans: r.plans }); if (r.message) toast(r.message); bump(); };
  const act = (date: string, a: 'approve' | 'next' | 'unpin' | 'skip' | 'add' | 'publish' | 'unpublish') => api.slot(p.id, date, a).then(apply).catch(fail);
  const patch = (x: Partial<Plan>) => api.patchPlan(p.id, x).then(apply).catch(fail);
  const slots = pb.slots.filter(isSlot);
  const draftOf = (id: string) => drafts.find(d => d.topicId === id);
  const jobOf = (s: SlotView) => jobs.find(j => j.id === s.progress?.jobId) ?? null;
  const toGen = (s: SlotView) => {
    const d = draftOf(s.topicId);
    // 栏目 → 视频类型（面诊报告里定的）
    const col = report?.columns.find(c => c.name === s.column);
    setGenSeed({ copy: d ? copyText(d) : `${s.topic.title}\n${s.topic.hook}`, title: d?.title ?? s.topic.title, topicId: s.topicId, ...(col ? { type: col.type as VideoType } : {}) });
    nav('gen');
  };
  const writeCopy = async (s: SlotView) => {
    try { const r = await api.writeCopy({ topicId: s.topicId, column: s.column }); toast(r.used.length ? `写好了，用了知识库里的 ${r.used.length} 条素材` : 'AI 写好了一版文案'); data.reload(); } catch (e) { fail(e); }
  };

  // 今天要做的：只列需要学员拍板或动手的
  const cand = slots.filter(s => s.date > today && s.pin === 'cand' && s.state !== 'paused');
  const review = slots.filter(s => s.date >= today && s.progress?.sample === 'done' && !s.progress.final);
  const pub = slots.filter(s => s.date === today && !s.progress?.published);
  const fill = slots.filter(s => s.date < today && s.progress?.published && !s.progress.reviewed && Date.parse(today) - Date.parse(s.date) <= 7 * 864e5);
  const noCopy = p.auto === 'plan' ? slots.filter(s => s.date > today && s.pin === 'fixed' && !s.progress?.copy && Date.parse(s.date) - Date.parse(today) <= 3 * 864e5) : [];
  const gap = slots.filter(s => s.state === 'gap');
  const todo = cand.length + review.length + pub.length + fill.length + noCopy.length + gap.length;

  const slotSheet = (s: SlotView) => {
    const d = stageDone(s), j = jobOf(s), o = j?.output as VideoOutput | null;
    sheet({
      title: s.topic.title,
      body: <>
        <div className="opsprog big">{STAGES.map((n, i) => <span key={n} className={d[i] ? 'ok' : ''}>{n}</span>)}</div>
        <div className="list" style={{ marginTop: 14 }}><div><span>发布</span><span className="v">{s.weekday} {s.label} {hourLabel(p.hour)}</span></div><div><span>现在</span><span className="v">{stageNow(s)}</span></div><div><span>为什么排它</span><span className="v">{s.why}</span></div><div><span>栏目</span><span className="v">{s.column}</span></div>
          {s.progress?.metrics && <div><span>数据</span><span className="v">播放 {s.progress.metrics.views} · 赞 {s.progress.metrics.likes} · 评论 {s.progress.metrics.comments} · 私信 {s.progress.metrics.leads}</span></div>}</div>
        {o?.videoUrl && <p className="s" style={{ marginTop: 12 }}><a className="lnk" href={fileUrl(o.videoUrl)} target="_blank" rel="noreferrer">看{o.draft ? '样片' : '成片'}</a></p>}
      </>,
      foot: s.date < today && s.progress?.published ? <button className="btn g" onClick={() => sheet(null)}>好</button> : <>
        {s.date > today && <button className="btn g" onClick={() => { sheet(null); void act(s.date, 'skip'); }}>这次跳过</button>}
        {s.pin === 'cand' && s.date > today ? <><button className="btn g" onClick={() => { sheet(null); sheet({ title: `给 ${s.label} 换选题`, body: <TopicPick plan={p} topics={topics} used={new Set(slots.map(x => x.topicId))} onPick={async t => { try { apply(await api.slot(p.id, s.date, 'set', t.id)); sheet(null); } catch (e) { fail(e); } }} onLib={() => { sheet(null); toast('选题在 dazheip 里找，带回来后会出现在这里'); }} /> }); }}>换选题</button><button className="btn y" onClick={() => { sheet(null); void act(s.date, 'approve'); }}>通过选题</button></>
          : <button className="btn y" onClick={() => toGen(s)}>{s.progress?.sample === 'done' ? '去改样片' : '去生成'}</button>}
      </>,
    });
  };

  const exportCsv = () => {
    const rows = [['账号', '日期', '星期', '选题', '栏目', '进度', '播放', '点赞', '评论', '私信']];
    plans.forEach(b => b.slots.filter(isSlot).forEach(s => rows.push([b.plan.account, s.date, s.weekday, s.topic.title, s.column, stageNow(s), ...(s.progress?.metrics ? [s.progress.metrics.views, s.progress.metrics.likes, s.progress.metrics.comments, s.progress.metrics.leads].map(String) : ['', '', '', ''])])));
    const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `AI运营_${today}.csv`; a.click();
    toast('表格已导出，可以直接贴进飞书');
  };

  // 复盘：按栏目算平均播放，给一句打法建议
  const reviewed = slots.filter(s => s.progress?.metrics);
  const byCol = new Map<string, number[]>();
  reviewed.forEach(s => byCol.set(s.column, [...(byCol.get(s.column) ?? []), s.progress!.metrics!.views]));
  const best = [...byCol.entries()].map(([c, v]) => [c, v.reduce((a, x) => a + x, 0) / v.length] as const).sort((a, b) => b[1] - a[1])[0];

  return <div id="v-opsplan">
    <div className="wrap" style={{ maxWidth: 1024 }}>
      <div className="personas" id="accts" role="group" aria-label="账号" style={{ marginTop: 28 }}>
        {plans.map((x, i) => <button key={x.plan.id} className="pill" aria-pressed={i === pi} onClick={() => setPi(i)}>{x.plan.account}</button>)}
        <button className="pill" onClick={() => sheet({ title: '加一个发布账号', body: <AddAccount onDone={r => { apply(r); setPi(r.plans.length - 1); sheet(null); toast('在「AI 打法」里设发布的日子和时间'); }} /> })}>＋ 账号</button>
      </div>
      <div className="opsauto card">
        <div style={{ flex: 1, minWidth: 260 }}><p className="t2">托管程度</p><p className="xs m3" style={{ marginTop: 4 }}>{AUTO.find(a => a[0] === p.auto)?.[2]}。不会自动发布，没拍板的内容不往下走。</p></div>
        <div id="opsAuto"><Seg value={p.auto} options={AUTO.map(a => a[0])} render={v => AUTO.find(a => a[0] === v)![1]} onChange={v => patch({ auto: v })} /></div>
        <label className="row s" style={{ gap: 10 }}><span>{p.running ? '运行中' : '已暂停'}</span><input type="checkbox" className="sw" checked={p.running} onChange={e => patch({ running: e.target.checked })} /></label>
      </div>
      {did.length > 0 && <div className="gwarn" style={{ marginTop: 12 }}><div style={{ background: 'color-mix(in srgb,var(--real) 10%,var(--pn))' }}><span style={{ flex: 1 }}>AI 刚做了：{did.join('；')}</span><button className="btn g sm" onClick={() => setDid([])}>知道了</button></div></div>}

      <div className="row" style={{ margin: '36px 0 12px', alignItems: 'flex-end' }}><h2 className="t1" style={{ flex: 1 }}>今天要做的</h2><span className="xs m3" id="todoN">{todo ? `${todo} 件` : '都做完了'}</span></div>
      <div className="todo" id="opsTodo">
        {cand.length > 0 && <div className="tdc"><div className="row"><Src k="warn">选题待审</Src><b className="s" style={{ flex: 1 }}>{cand.length} 个选题等你通过</b><button className="btn y sm" id="approveAll" onClick={() => api.approveAll(p.id).then(apply).catch(fail)}>全部通过</button></div>
          {cand.slice(0, 4).map(s => <div className="tdr" key={s.date}><span className="xs m3">{s.label} {s.weekday}</span><span className="s" style={{ flex: 1 }}>{s.topic.title}<span className="xs m3"> · {s.why}</span></span><button className="btn g sm" onClick={() => act(s.date, 'next')}>换一个</button><button className="btn g sm" onClick={() => act(s.date, 'approve')}>通过</button></div>)}</div>}
        {noCopy.map(s => <div className="tdc" key={`c${s.date}`}><div className="row"><Src k="warn">缺文案</Src><span className="s" style={{ flex: 1 }}>{s.label} 要发「{s.topic.title}」，还没写文案</span><button className="btn g sm" onClick={() => writeCopy(s)}>AI 写一版</button><button className="btn g sm" onClick={() => toGen(s)}>去生成</button></div></div>)}
        {review.map(s => <div className="tdc" key={`r${s.date}`}><div className="row"><Src k="gen">样片待确认</Src><span className="s" style={{ flex: 1 }}>{s.label}「{s.topic.title}」的样片好了</span><button className="btn g sm" onClick={() => toGen(s)}>改一改</button><button className="btn y sm" onClick={() => { const j = jobOf(s); if (j) nav({ view: 'gen', sub: 'job', id: j.id }); }}>看样片，出成片</button></div></div>)}
        {pub.map(s => <PublishCard key={`p${s.date}`} s={s} draft={draftOf(s.topicId)} job={jobOf(s)} onDone={() => act(s.date, 'publish')} />)}
        {fill.map(s => <MetricsCard key={`m${s.date}`} s={s} onSave={m => api.slotMetrics(p.id, s.date, m).then(apply).catch(fail)} />)}
        {gap.map(s => <div className="tdc" key={`g${s.date}`}><div className="row"><Src k="warn">素材不够</Src><span className="s" style={{ flex: 1 }}>{s.label}「{s.topic.title}」常用素材都用过 4 次了，补几张会更好</span><button className="btn g sm" onClick={() => nav({ view: 'lib', sub: 'assets' })}>补素材</button></div></div>)}
        {!todo && <p className="s m" style={{ padding: '14px 0' }}>没有要你处理的。AI 会按托管程度继续往下推。</p>}
      </div>

      <div className="row" style={{ margin: '40px 0 12px' }}><h2 className="t1" style={{ flex: 1 }}>接下来两周</h2></div>
      <div className="strip" id="strip">{pb.slots.map(d => isSlot(d)
        ? <button key={d.date} className={`slotc${d.date === today ? ' today' : ''}`} data-sd={d.date} onClick={() => slotSheet(d)}><Ph k={d.topic.k} /><div className="b"><p className="dt">{d.weekday} {d.label}{d.date === today ? ' · 今天' : ''}</p><p className="t2" style={{ marginTop: 4, fontSize: 14.5 }}>{d.topic.title}</p>
          <div className="opsprog" aria-label="进度">{stageDone(d).map((x, i) => <i key={i} className={x ? 'ok' : ''} title={STAGES[i]} />)}</div><p className="xs m3" style={{ marginTop: 6 }}>{stageNow(d)}</p></div></button>
        : <button key={d.date} className="slotc empty" data-ad={d.date} disabled={d.date <= today} onClick={() => act(d.date, 'add')}><span>{d.weekday} {d.label.split('/')[1]}<br />{d.date > today ? '＋ 加一条' : ''}</span></button>)}</div>

      <div className="rhythm">
        <div className="card">
          <p className="t2">AI 打法</p>
          <p className="s m" style={{ marginTop: 6 }}>{best ? `已发内容里「${best[0]}」平均播放最高（${Math.round(best[1]).toLocaleString()}），下一期会多排一条。` : '还没有回填的数据，先按下面的栏目配比排；发完填一下数据，AI 会照着调。'}</p>
          <div className="row" style={{ marginTop: 16 }}><p className="s" style={{ flex: 1 }}>发什么</p><span className="xs m3">推子越高，出现越多</span></div>
          <Mix key={p.id} plan={p} onChange={mix => patch({ mix })} />
        </div>
        <div className="card">
          <p className="t2">什么时候发</p>
          <div className="wkd" id="wkd">{WEEKDAYS.map((w, i) => <button key={w} aria-pressed={p.weekdays.includes(i)} aria-label={w} onClick={() => patch({ weekdays: p.weekdays.includes(i) ? p.weekdays.filter(x => x !== i) : [...p.weekdays, i].sort() })}>{w.slice(1)}</button>)}</div>
          <TimeLine hour={p.hour} onChange={h => patch({ hour: h })} />
          <div className="row" style={{ marginTop: 18, justifyContent: 'space-between' }}><span className="s">每月最多花</span><span className="row" style={{ gap: 6 }}><button className="btn g sm" aria-label="减少" onClick={() => patch({ budget: Math.max(100, p.budget - 100) })}>−</button><b className="ro" style={{ minWidth: 64, textAlign: 'center' }}>{p.budget} 点</b><button className="btn g sm" aria-label="增加" onClick={() => patch({ budget: p.budget + 100 })}>＋</button></span></div>
          <BudgetNote plan={p} />
        </div>
      </div>

      <div className="row" style={{ margin: '40px 0 12px', alignItems: 'flex-end' }}><div style={{ flex: 1 }}><h2 className="t1">复盘</h2><p className="s m" style={{ marginTop: 4 }}>发布后 24 小时填一次数据。可以导出表格，贴进助教的学员跟踪表。</p></div><button className="btn g sm" id="opsCsv" onClick={exportCsv}>导出表格</button></div>
      <div className="list" id="opsReview">{reviewed.length ? reviewed.map(s => <div key={s.date}><span>{s.label} · {s.topic.title}<br /><span className="xs m3">{s.column}</span></span><span className="v">播放 {s.progress!.metrics!.views} · 赞 {s.progress!.metrics!.likes} · 私信 {s.progress!.metrics!.leads}</span></div>) : <div><span className="m">还没有回填的数据</span></div>}</div>
      <p className="note" style={{ textAlign: 'center', marginTop: 26 }}>不会自动生成视频，也不会自动发布；自动抓取播放数据需要平台授权，二期再做。</p>
    </div>
  </div>;
}

function PublishCard({ s, draft, job, onDone }: { s: SlotView; draft?: CopyDraft; job: Job | null; onDone: () => void }) {
  const { toast } = useApp();
  const o = job?.output as VideoOutput | null;
  const pack = [draft?.title ?? s.topic.title, draft ? copyText(draft) : s.topic.hook, (draft?.tags ?? []).join(' ')].filter(Boolean).join('\n\n');
  return <div className="tdc"><div className="row"><Src k="real">今天要发</Src><span className="s" style={{ flex: 1 }}>「{s.topic.title}」</span>
    <button className="btn g sm" onClick={() => { void navigator.clipboard?.writeText(pack); toast('标题、文案和标签已复制'); }}>复制发布包</button>
    {o?.videoUrl ? <a className="btn g sm" href={fileUrl(o.videoUrl)} download={`${o.title}.mp4`}>下载视频</a> : <span className="xs m3">{job ? '视频还没合成' : '还没出片'}</span>}
    <button className="btn y sm" onClick={onDone}>我已发布</button></div></div>;
}

function MetricsCard({ s, onSave }: { s: SlotView; onSave: (m: SlotMetrics) => void }) {
  const [m, setM] = useState<SlotMetrics>({ views: 0, likes: 0, comments: 0, leads: 0 });
  const f = (k: keyof SlotMetrics, n: string) => <label className="xs m3" style={{ display: 'grid', gap: 4 }}>{n}<input className="fld sm ro" type="number" min={0} value={m[k] || ''} onChange={e => setM({ ...m, [k]: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 90 }} /></label>;
  return <div className="tdc"><div className="row" style={{ alignItems: 'flex-end' }}><Src k="warn">数据待回填</Src><span className="s" style={{ flex: 1, minWidth: 160 }}>{s.label}「{s.topic.title}」发了一天了</span>
    {f('views', '播放')}{f('likes', '点赞')}{f('comments', '评论')}{f('leads', '私信')}<button className="btn y sm" onClick={() => onSave(m)}>记下</button></div></div>;
}
