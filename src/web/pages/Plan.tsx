// 排期：下一条、AI 预选题审核（通过 / 换一个 / 从选题库挑 / 去 IP 深挖）、备选池、两周格子、发布节奏与栏目配比。
import { useRef, useState } from 'react';
import { api, type DayView, type PlanBundle } from '../api.ts';
import { useApp, useData } from '../store.tsx';
import { Ph, Skel } from '../ui/kit.tsx';
import { useScheduleTopic } from '../ui/pickers.tsx';
import { SLOT_LABEL, hourLabel } from '../../shared/schedule.ts';
import { SLOT_COST, TOPIC_SOURCE_NAME, WEEKDAYS } from '../../shared/catalog.ts';
import type { Plan, SlotView, Topic } from '../../shared/types.ts';

const isSlot = (d: DayView): d is SlotView => !('empty' in d);

export function PlanPage() {
  const { session, toast, fail, nav, setPlace, sheet, bump } = useApp();
  const schedule = useScheduleTopic();
  const data = useData(async () => { const [p, t, d] = await Promise.all([api.plans(), api.allTopics(), api.drafts()]); return { plans: p.plans, topics: t.topics, drafts: d.drafts }; }, []);
  const [pi, setPi] = useState(0);
  if (!data.data) return <section className="view on" id="v-plan"><div className="vb wrap" style={{ paddingTop: 56 }}><Skel h={300} /></div></section>;
  const { plans, topics, drafts } = data.data;
  const pb = plans[Math.min(pi, plans.length - 1)], p = pb.plan, today = session!.today;
  const apply = (r: { plans: PlanBundle[]; message?: string }) => { data.set({ ...data.data!, plans: r.plans }); if (r.message) toast(r.message); bump(); };
  const act = (date: string, a: 'approve' | 'next' | 'unpin' | 'skip' | 'add') => api.slot(p.id, date, a).then(apply).catch(fail);
  const patch = (x: Partial<Plan>) => api.patchPlan(p.id, x).then(apply).catch(fail);
  const future = pb.slots.filter(isSlot).filter(s => s.date > today && s.state !== 'paused');
  const nCand = future.filter(s => s.pin === 'cand').length;
  const nx = pb.slots.filter(isSlot).find(s => s.date >= today && s.state !== 'paused');
  const fromLib = (s: SlotView) => { setPlace({ planId: p.id, date: s.date, label: `${p.account} · ${s.label} ${s.weekday}` }); nav({ view: 'ip', sub: 'find' }); };
  const draftOf = (id: string) => drafts.find(d => d.topicId === id);

  const pickSheet = (s: SlotView) => sheet({ title: `给 ${s.label} ${s.weekday} 挑选题`, body: <TopicPick plan={p} topics={topics} used={new Set(pb.slots.filter(isSlot).map(x => x.topicId))} onPick={async t => { try { apply(await api.slot(p.id, s.date, 'set', t.id)); sheet(null); } catch (e) { fail(e); } }} onLib={() => { sheet(null); fromLib(s); }} /> });

  const slotSheet = (s: SlotView) => sheet({
    title: s.topic.title,
    body: <>
      <div style={{ borderRadius: 'var(--r2)', overflow: 'hidden', marginBottom: 14 }}><Ph k={s.topic.k} tag={s.state === 'done' ? 'real' : 'gen'} /></div>
      {s.state === 'gap' && <p className="s" style={{ marginBottom: 14, color: 'var(--warn)' }}>可用素材不够（常用素材已用 4 次以上）。补几张就能继续；不补的话发布前再提醒，然后顺延。</p>}
      <div className="list"><div><span>状态</span><span className="v">{SLOT_LABEL[s.state]}</span></div><div><span>选题</span><span className="v">{s.pin === 'cand' ? 'AI 预选，待你审核' : '📌 已固定'}</span></div><div><span>发布</span><span className="v">{s.weekday} {s.label} {hourLabel(p.hour)}</span></div><div><span>为什么选</span><span className="v">{s.why}</span></div><div><span>栏目</span><span className="v">{s.column}</span></div><div><span>文案</span><span className="v">{draftOf(s.topicId) ? '已写' : '还没写'}</span></div></div>
    </>,
    foot: s.date < today ? <button className="btn g" onClick={() => sheet(null)}>好</button> : <>
      {s.date > today && <button className="btn g" onClick={() => { sheet(null); void act(s.date, 'skip'); }}>这次跳过</button>}
      {s.state === 'gap' && <button className="btn g" onClick={() => nav({ view: 'lib', sub: 'assets' })}>补素材</button>}
      {s.pin === 'cand' && s.date > today ? <button className="btn y" onClick={() => { sheet(null); void act(s.date, 'approve'); }}>通过选题</button>
        : <button className="btn y" onClick={() => nav({ view: 'ip', sub: 'copy', id: s.topicId })}>{draftOf(s.topicId) ? '改文案' : '写文案'}</button>}
    </>,
  });

  return <section className="view on" id="v-plan"><div className="vb">
    <div className="hero" style={{ paddingTop: 56 }}>
      <h1 className="d2">排期</h1>
      <div className="personas" id="accts" role="group" aria-label="账号" style={{ marginTop: 20 }}>
        {plans.map((x, i) => <button key={x.plan.id} className="pill" aria-pressed={i === pi} onClick={() => setPi(i)}>{x.plan.account}</button>)}
        <button className="pill" onClick={() => sheet({ title: '加一个发布账号', body: <AddAccount onDone={r => { apply(r); setPi(r.plans.length - 1); sheet(null); toast('点下面的日子和时间就设好了'); }} /> })}>＋ 账号</button>
      </div>
      <div className="nx" id="nx">{nx ? <>
        <Ph k={nx.topic.k} tag="gen" />
        <div>
          <p className="s m">下一条 · {nx.weekday} {nx.label} {hourLabel(p.hour)} 发</p>
          <p className="cd ro" style={{ marginTop: 10 }}>{nx.date === today ? '今天' : `${Math.round((Date.parse(nx.date) - Date.parse(today)) / 864e5)} 天后`}</p>
          <h2 className="d3" style={{ marginTop: 14 }}>{nx.topic.title}</h2>
          <p className="s m" style={{ marginTop: 8 }}>{nx.state === 'review' ? '样片已经好了，看一眼就行。不满意可以在制作台只改某一镜。' : nx.state === 'gap' ? '素材不够，补几张或换个栏目。' : nx.state === 'cand' ? '这条是 AI 预选的选题，你通过后才开始做样片。' : 'AI 会在发布前 48 小时出样片。'}</p>
          <div className="row" style={{ marginTop: 20 }}>
            {nx.state === 'cand' ? <><button className="btn y" onClick={() => act(nx.date, 'approve')}>通过这个选题</button><button className="btn g" onClick={() => act(nx.date, 'next')}>换一个</button></>
              : <><button className="btn y" onClick={() => nav({ view: 'ip', sub: 'copy', id: nx.topicId })}>{draftOf(nx.topicId) ? '看文案和样片' : '写文案'}</button></>}
            {nx.date > today && <button className="lnk s" onClick={() => act(nx.date, 'skip')}>这次跳过</button>}
          </div>
        </div></> : <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 30 }}><p className="t1">{p.running ? '这两周没有要发的' : '暂停中'}</p><p className="s m" style={{ marginTop: 6 }}>{p.running ? '在下面选几天就行。' : '打开“自动运行”就会继续。'}</p></div>}</div>
    </div>

    <div className="wrap" style={{ maxWidth: 1024 }}>
      <div className="row" style={{ margin: '48px 0 6px', alignItems: 'flex-end' }}><div style={{ flex: 1 }}><h2 className="t1">AI 预选题 · 等你审核</h2><p className="s m" style={{ marginTop: 4 }}>AI 按 IP 定位和栏目配比，先把未来两周的选题排好。通过就固定到那天；不满意就换一个，或从选题库挑。</p></div><span className="xs m3" id="preN">{future.length ? (nCand ? `${nCand} 条待审 · ${future.length - nCand} 条已固定` : `${future.length} 条都已固定`) : ''}</span></div>
      <div className="row" style={{ margin: '12px 0', gap: 8, justifyContent: 'flex-end' }}><button className="btn g sm" id="preRe" onClick={() => api.reroll(p.id).then(apply).catch(fail)}>AI 重新预选</button><button className="btn k sm" id="preAll" disabled={!nCand} onClick={() => api.approveAll(p.id).then(apply).catch(fail)}>全部通过</button></div>
      <div className="pre" id="pre">{future.length ? future.map(s => {
        const dr = draftOf(s.topicId);
        return <div key={s.date} className={`pc ${s.pin}`} data-pd={s.date}>
          <div className="pcd"><b>{s.label}</b>{s.weekday} {hourLabel(p.hour)}</div><Ph k={s.topic.k} />
          <div className="pcb" style={{ minWidth: 0 }}><p className="t2">{s.topic.title}</p><p className="xs m3" style={{ marginTop: 4 }}>{s.pin === 'cand' ? 'AI 预选' : '📌 已固定'} · {s.why} · 栏目：{s.column}{dr ? ' · 文案已写' : ''}</p></div>
          <div className="pca">{s.pin === 'cand'
            ? <><button className="btn y sm" data-pa2="ok" onClick={() => act(s.date, 'approve')}>通过</button><button className="btn g sm" data-pa2="next" onClick={() => act(s.date, 'next')}>换一个</button><button className="btn g sm" data-pa2="lib" onClick={() => pickSheet(s)}>从选题库挑</button></>
            : <><button className="btn g sm" data-pa2="copy" onClick={() => nav({ view: 'ip', sub: 'copy', id: s.topicId })}>{dr ? '改文案' : '写文案'}</button><button className="btn g sm" data-pa2="unpin" onClick={() => act(s.date, 'unpin')}>取消固定</button></>}
            <button className="lnk xs" data-pa2="dig" onClick={() => { setPlace({ planId: p.id, date: s.date, label: `${p.account} · ${s.label} ${s.weekday}` }); nav({ view: 'ip', sub: 'find' }); }}>去 IP 换题</button></div>
        </div>;
      }) : <p className="s m" style={{ padding: '20px 0', textAlign: 'center' }}>{p.running ? '这两周还没有要发的日子。在下面选几天就行。' : '已暂停，打开“自动运行”后 AI 会重新预选。'}</p>}</div>

      <div className="backlog" id="backlog"><span className="s m">备选池</span>
        {p.backlog.length ? p.backlog.map(id => { const t = topics.find(x => x.id === id); return t ? <button key={id} className="pill sm" data-bk={id} onClick={() => schedule(t)}>{t.title.length > 14 ? `${t.title.slice(0, 14)}…` : t.title} ›</button> : null; })
          : <span className="xs m3">在 IP 选题库点“排期 → 先放进备选池”，再到这里挑日子。</span>}
        <span style={{ flex: 1 }} /><button className="btn g sm" id="toIpFind" onClick={() => nav({ view: 'ip', sub: 'find' })}>去 IP 选题库加</button></div>

      <div className="row" style={{ margin: '48px 0 14px' }}><h2 className="t1" style={{ flex: 1 }}>接下来两周</h2><label className="row s" style={{ gap: 10 }}><span>{p.running ? '自动运行' : '已暂停'}</span><input type="checkbox" className="sw" id="run" checked={p.running} onChange={e => patch({ running: e.target.checked })} /></label></div>
      <div className="strip" id="strip">{pb.slots.map(d => isSlot(d)
        ? <button key={d.date} className={`slotc${d.date === today ? ' today' : ''}`} data-sd={d.date} onClick={() => slotSheet(d)}><Ph k={d.topic.k} /><div className="b"><p className="dt">{d.weekday} {d.label}{d.date === today ? ' · 今天' : ''}{d.pin === 'fixed' && d.date > today ? ' 📌' : ''}</p><p className="t2" style={{ marginTop: 4, fontSize: 14.5 }}>{d.topic.title}</p><p className="xs" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}><i className={`dot ${d.state}`} />{SLOT_LABEL[d.state]}</p></div></button>
        : <button key={d.date} className="slotc empty" data-ad={d.date} disabled={d.date <= today} onClick={() => act(d.date, 'add')}><span>{d.weekday} {d.label.split('/')[1]}<br />{d.date > today ? '＋ 加一条' : ''}</span></button>)}</div>

      <div className="rhythm">
        <div className="card">
          <p className="t2">什么时候发</p>
          <div className="wkd" id="wkd">{WEEKDAYS.map((w, i) => <button key={w} aria-pressed={p.weekdays.includes(i)} aria-label={w} onClick={() => patch({ weekdays: p.weekdays.includes(i) ? p.weekdays.filter(x => x !== i) : [...p.weekdays, i].sort() })}>{w.slice(1)}</button>)}</div>
          <TimeLine hour={p.hour} onChange={h => patch({ hour: h })} />
          <div className="row" style={{ marginTop: 22, justifyContent: 'space-between' }}><span className="s">样片出来后要我确认</span><input type="checkbox" className="sw" id="needOk" checked={p.needOk} onChange={e => patch({ needOk: e.target.checked })} /></div>
          <p className="xs m3" style={{ marginTop: 8 }}>每{p.weekdays.map(d => WEEKDAYS[d].slice(1)).join('、') || '—'} <b>{hourLabel(p.hour)}</b> 发。{p.needOk ? '选题通过后，发布前 48 小时出样片；12 小时没确认就顺延，不会自动发。' : '选题通过后样片直接进待发布箱，到点提醒你发。'}</p>
        </div>
        <div className="card">
          <div className="row"><p className="t2" style={{ flex: 1 }}>发什么</p><span className="xs m3">推子越高，出现越多</span></div>
          <Mix key={p.id} plan={p} onChange={mix => patch({ mix })} />
          <div className="row" style={{ marginTop: 18, justifyContent: 'space-between' }}><span className="s">每月最多花</span><span className="row" style={{ gap: 6 }}><button className="btn g sm" aria-label="减少" onClick={() => patch({ budget: Math.max(SLOT_COST, p.budget - SLOT_COST) })}>−</button><b className="ro" style={{ minWidth: 64, textAlign: 'center' }}>{p.budget} 点</b><button className="btn g sm" aria-label="增加" onClick={() => patch({ budget: p.budget + SLOT_COST })}>＋</button></span></div>
          <BudgetNote plan={p} />
        </div>
      </div>
      <p className="note" style={{ textAlign: 'center', marginTop: 26 }}>到点推送提醒，附成片和文案，一键复制去发。授权账号后自动发布待开放。生成失败不会自动花钱重试。</p>
    </div>
  </div></section>;
}

function BudgetNote({ plan }: { plan: Plan }) {
  const n = plan.weekdays.length * 4 + plan.added.length, c = n * SLOT_COST;
  return <p className="xs m3" style={{ marginTop: 8 }}>每月约 {n} 条 × {SLOT_COST} 点 ≈ {c} 点。{c > plan.budget ? <span style={{ color: 'var(--warn)' }}>超过上限，第 {Math.max(1, Math.floor(plan.budget / SLOT_COST))} 条后自动暂停。</span> : '在上限内，用完自动暂停。'}</p>;
}

function TimeLine({ hour, onChange }: { hour: number; onChange: (h: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const h = drag ?? hour;
  const at = (x: number) => { const r = ref.current!.getBoundingClientRect(); return Math.min(23.5, Math.round((6 + Math.min(1, Math.max(0, (x - r.left) / r.width)) * 18) * 2) / 2); };
  return <div className="tline" id="tline" ref={ref} role="slider" tabIndex={0} aria-label="发布时间" aria-valuemin={6} aria-valuemax={23.5} aria-valuenow={h} aria-valuetext={hourLabel(h)}
    onPointerDown={e => { ref.current!.setPointerCapture(e.pointerId); setDrag(at(e.clientX)); }}
    onPointerMove={e => drag !== null && setDrag(at(e.clientX))}
    onPointerUp={() => { if (drag !== null) { onChange(drag); setDrag(null); } }}
    onKeyDown={e => { const d = e.key === 'ArrowRight' ? 0.5 : e.key === 'ArrowLeft' ? -0.5 : 0; if (d) { e.preventDefault(); onChange(Math.min(23.5, Math.max(6, hour + d))); } }}>
    <i className="bg" /><i className="kn" style={{ left: `${((h - 6) / 18) * 100}%` }} />
    {[6, 12, 18, 24].map(x => <span key={x} className="lb2" style={{ left: `${((x - 6) / 18) * 100}%` }}>{x}:00</span>)}
    <span className="lb2" style={{ left: '80%', top: -2, color: 'var(--tx2)' }}>晚间高峰</span>
  </div>;
}

function Mix({ plan, onChange }: { plan: Plan; onChange: (m: Plan['mix']) => void }) {
  const [mix, setMix] = useState(plan.mix);
  const tot = mix.reduce((a, x) => a + x.v, 0) || 1;
  const setV = (i: number, v: number, commit: boolean) => { const m = mix.map((x, j) => j === i ? { ...x, v: Math.max(0.05, Math.min(1, +v.toFixed(2))) } : x); setMix(m); if (commit) onChange(m); };
  return <div className="mixd" id="mixd">{mix.map((m, i) => (
    <div className="fd" key={m.n}>
      <span className="val ro">{Math.round((m.v / tot) * 100)}%</span>
      <div className="slot" role="slider" tabIndex={0} aria-label={m.n} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(m.v * 100)}
        onPointerDown={e => { const el = e.currentTarget, r = el.getBoundingClientRect(); el.setPointerCapture(e.pointerId); const f = (y: number) => 1 - (y - r.top - 6) / (r.height - 12); setV(i, f(e.clientY), false); el.onpointermove = ev => setV(i, f(ev.clientY), false); el.onpointerup = ev => { el.onpointermove = null; setV(i, f(ev.clientY), true); }; }}
        onKeyDown={e => { const d = e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowDown' ? -0.05 : 0; if (d) { e.preventDefault(); setV(i, m.v + d, true); } }}>
        <i className="tk" /><i className="gv" /><i className="lv" style={{ height: `calc((100% - 12px) * ${m.v})` }} /><i className="cap" style={{ top: `calc(6px + (100% - 12px) * ${1 - m.v})` }} />
      </div>
      <span className="nm">{m.n.length > 5 ? m.n.slice(0, 5) : m.n}</span><span className="ends"><span>多</span><span>少</span></span>
    </div>))}</div>;
}

function TopicPick({ plan, topics, used, onPick, onLib }: { plan: Plan; topics: Topic[]; used: Set<string>; onPick: (t: Topic) => void; onLib: () => void }) {
  const G: [string, string, Topic[]][] = [['back', '备选池', plan.backlog.map(id => topics.find(t => t.id === id)).filter((t): t is Topic => !!t)], ['fav', '收藏', topics.filter(t => t.fav)], ['mine', 'AI 策划', topics.filter(t => t.source !== 'hot')], ['hot', '热门', topics.filter(t => t.source === 'hot')]];
  const [tab, setTab] = useState(G.find(g => g[2].length)?.[0] ?? 'hot');
  const list = G.find(g => g[0] === tab)![2];
  return <>
    <div className="seg" role="group" style={{ marginBottom: 14 }}>{G.map(g => <button key={g[0]} aria-pressed={g[0] === tab} onClick={() => setTab(g[0])}>{g[1]} {g[2].length}</button>)}</div>
    <div className="list">{list.length ? list.slice(0, 30).map(t => <button key={t.id} data-tp={t.id} onClick={() => onPick(t)}><span>{t.title}<br /><span className="xs m3">{t.dir} · {TOPIC_SOURCE_NAME[t.source]}{used.has(t.id) ? ' · 已在排期里' : ''}</span></span><span className="v">放到这天 ›</span></button>) : <div><span className="m">这里还没有选题</span></div>}</div>
    <div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}><button className="btn k" id="tpIp" onClick={onLib}>去 IP 选题库找</button></div>
  </>;
}

function AddAccount({ onDone }: { onDone: (r: { plans: PlanBundle[] }) => void }) {
  const { fail } = useApp();
  const [n, setN] = useState('');
  return <>
    <label className="lb" htmlFor="acctN">账号名</label><input className="fld" id="acctN" value={n} onChange={e => setN(e.target.value)} placeholder="例如：林设计师 · 视频号" />
    <div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}><button className="btn y" disabled={!n.trim()} onClick={() => api.addPlan(n.trim()).then(onDone).catch(fail)}>添加</button></div>
  </>;
}
