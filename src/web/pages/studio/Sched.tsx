// 安排发布计划：选题和发布合成一块。诊断排出来的选题进来是「待确认」，出完片「加入发布队列」回到这里是「已排期」。
// 状态走向：待确认 → 确认 → 待生成 → 去生成 → 已排期 → 发了 → 已发布（去「查看作品数据」填播放和询盘）。
import { useState } from 'react';
import { useApp } from '../../store.tsx';
import { useStudio } from './common.tsx';
import { ACCOUNTS, VTYPES, addDays, inWeek, weekStats, whenLabel, type PlanItem, type PlanStatus } from '../../../shared/studio.ts';
import type { VideoType } from '../../../shared/video.ts';

const STC: Record<PlanStatus, string> = { 已排期: 'ok', 待确认: 'warn', 待生成: 'gen', 已发布: 'done' };
type Range = 'week' | 'later' | 'all';

export function SchedPage() {
  const { session, nav, toast, setGenSeed, sheet, route } = useApp();
  const { st, save } = useStudio();
  const [range, setRange] = useState<Range>('week');
  const [acc, setAcc] = useState('全部');
  const [stf, setStf] = useState<PlanStatus | '全部'>('全部');
  if (!st || !session) return <section className="view on"><div className="vb wrap" style={{ paddingTop: 80 }}><p className="s m">加载中…</p></div></section>;
  const today = session.today;
  const plan = [...st.plan].sort((a, b) => a.when.localeCompare(b.when));
  const s = weekStats(plan, today);
  const accounts = [...new Set(plan.map(p => p.account))];
  const rows = plan.filter(p => p.status !== '已发布'
    && (range === 'all' || (range === 'week' ? inWeek(p.when, today) : p.when.slice(0, 10) > addDays(today, 6)))
    && (acc === '全部' || p.account === acc) && (stf === '全部' || p.status === stf));
  const diagWait = plan.filter(p => p.from === 'diag' && p.status === '待确认');
  const upd = (id: string, p: Partial<PlanItem>) => save({ plan: st.plan.map(x => x.id === id ? { ...x, ...p } : x) });
  const make = (p: PlanItem) => { setGenSeed({ title: p.title, topicId: p.id, copy: '', type: (VTYPES.find(t => t.n === p.type)?.id ?? 'talk') as unknown as VideoType }); nav('make'); };
  const publish = (p: PlanItem) => { void save({ plan: st.plan.filter(x => x.id !== p.id), works: [{ ...p, status: '已发布', stats: { play: 0, like: 0, ask: 0 } }, ...st.works] }); toast('记成已发布了，过两天去「查看作品数据」填播放和询盘'); };
  const edit = (p: PlanItem) => sheet({ title: '改这一条', body: <Edit p={p} accounts={[...new Set([...accounts, ...ACCOUNTS])]} cols={[...new Set([...(st.diag.result?.columns.map(c => c.n) ?? []), ...plan.map(x => x.column)])]} today={today}
    onSave={x => { void upd(p.id, x); sheet(null); toast('改好了'); }} onDel={() => { void save({ plan: st.plan.filter(y => y.id !== p.id) }); sheet(null); toast('删掉了'); }} /> });
  const act = (p: PlanItem) => p.status === '待确认' ? <button className="btn y sm" data-act="confirm" onClick={() => { void upd(p.id, { status: '待生成' }); toast('确认了，下一步去生成'); }}>确认</button>
    : p.status === '待生成' ? <button className="btn k sm" data-act="make" onClick={() => make(p)}>去生成 →</button>
      : <button className="btn g sm" data-act="pub" onClick={() => publish(p)}>发了</button>;

  return <section className="view on" id="v-sched"><div className="vb wrap sch">
    <div className="hero tight" style={{ padding: '40px 0 0' }}>
      <p className="eyebrow">安排发布计划</p>
      <h1 className="d2">这一周 <em>{s.total} 条</em>，谁做，什么状态，发哪个号。</h1>
    </div>
    <div className="tiles" id="schTiles">
      <div><b>{s.total}</b><span>本周计划</span></div>
      <div><b>{s.done}</b><span>已排期</span></div>
      <div className="w"><b>{s.confirm}</b><span>待确认</span></div>
      <div><b>{s.accounts}</b><span>账号</span></div>
    </div>
    {!st.diag.saved ? <div className="callout" id="schDiag"><span>还没做账号诊断。做完会按你的标签排出四档栏目和约 15 条选题，自动进到这里。</span><button className="btn g sm" onClick={() => nav('diag')}>去看看 →</button></div>
      : diagWait.length > 0 && <div className="callout y" id="schDiagWait"><span>诊断排进来 <b>{diagWait.length}</b> 条选题，等你确认。确认了就变成「待生成」。</span><button className="btn y sm" id="schConfirmAll" onClick={() => { void save({ plan: st.plan.map(x => x.from === 'diag' && x.status === '待确认' ? { ...x, status: '待生成' } : x) }); toast(`确认了 ${diagWait.length} 条`); }}>全部确认</button></div>}

    <div className="schbar">
      <div className="seg sm" role="group" aria-label="时间">{([['week', '这一周'], ['later', '之后'], ['all', '全部']] as [Range, string][]).map(([k, n]) => <button key={k} aria-pressed={range === k} onClick={() => setRange(k)}>{n}</button>)}</div>
      <select className="fld sm" aria-label="账号" value={acc} onChange={e => setAcc(e.target.value)}><option>全部</option>{accounts.map(a => <option key={a}>{a}</option>)}</select>
      <select className="fld sm" aria-label="状态" value={stf} onChange={e => setStf(e.target.value as PlanStatus | '全部')}><option>全部</option><option>已排期</option><option>待确认</option><option>待生成</option></select>
      <span className="sp" />
      <button className="btn g sm" id="schAdd" onClick={() => sheet({ title: '加一条', body: <Edit p={{ id: `m${Date.now().toString(36)}`, title: '', type: '真人口播', account: accounts[0] ?? ACCOUNTS[0], column: '观点', when: `${addDays(today, 1)}T19:00`, status: '待生成', from: 'video' }} accounts={[...new Set([...accounts, ...ACCOUNTS])]} cols={[...new Set(plan.map(x => x.column))]} today={today} onSave={x => { void save({ plan: [...st.plan, x] }); sheet(null); toast('加上了'); }} /> })}>＋ 加一条</button>
    </div>

    <div className="ptable" role="table" id="schTable">
      <div className="pth" role="row"><span role="columnheader">标题</span><span role="columnheader">类型</span><span role="columnheader">账号</span><span role="columnheader">栏目</span><span role="columnheader">日期</span><span role="columnheader">状态</span><span role="columnheader" /></div>
      {rows.length ? rows.map(p => <div key={p.id} role="row" className={`ptr${route.id === p.id ? ' hl' : ''}`} data-row={p.id}>
        <span role="cell" className="pt-t"><button className="lnk" onClick={() => edit(p)}>{p.title}</button>{p.why && <span className="xs m3">{p.from === 'diag' ? '诊断 · ' : ''}{p.why}</span>}</span>
        <span role="cell" data-l="类型">{p.type}</span>
        <span role="cell" data-l="账号">{p.account}</span>
        <span role="cell" data-l="栏目">{p.column}</span>
        <span role="cell" data-l="日期">{whenLabel(p.when, today)}</span>
        <span role="cell"><span className={`stt ${STC[p.status]}`}>{p.status}</span></span>
        <span role="cell" className="pt-a">{act(p)}</span>
      </div>) : <p className="s m" style={{ padding: 20 }}>这段时间没有安排。{range === 'week' ? '看看「之后」，或者加一条。' : ''}</p>}
    </div>
    <p className="xs m3" style={{ marginTop: 10 }}>每条选题的拍摄方式和案例阶段，后面按苗苗整理的补进来。</p>
  </div></section>;
}

function Edit({ p, accounts, cols, today, onSave, onDel }: { p: PlanItem; accounts: string[]; cols: string[]; today: string; onSave: (p: PlanItem) => void; onDel?: () => void }) {
  const [x, setX] = useState(p);
  return <div id="schEdit">
    <label className="lb" htmlFor="seT">标题</label>
    <input className="fld" id="seT" value={x.title} onChange={e => setX({ ...x, title: e.target.value })} />
    <div className="mkopts" style={{ marginTop: 12 }}>
      <label className="opt"><span className="xs m3">类型</span><select className="fld" value={x.type} onChange={e => setX({ ...x, type: e.target.value })}>{VTYPES.map(t => <option key={t.id}>{t.n}</option>)}</select></label>
      <label className="opt"><span className="xs m3">账号</span><select className="fld" value={x.account} onChange={e => setX({ ...x, account: e.target.value })}>{accounts.map(a => <option key={a}>{a}</option>)}</select></label>
      <label className="opt"><span className="xs m3">栏目</span><input className="fld" list="seCols" value={x.column} onChange={e => setX({ ...x, column: e.target.value })} /><datalist id="seCols">{cols.map(c => <option key={c} value={c} />)}</datalist></label>
      <label className="opt"><span className="xs m3">日期</span><input className="fld" type="datetime-local" min={`${today}T00:00`} value={x.when} onChange={e => setX({ ...x, when: e.target.value })} /></label>
      <label className="opt"><span className="xs m3">状态</span><select className="fld" value={x.status} onChange={e => setX({ ...x, status: e.target.value as PlanStatus })}>{['待确认', '待生成', '已排期'].map(s => <option key={s}>{s}</option>)}</select></label>
    </div>
    <div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}>
      {onDel && <button className="btn g" onClick={onDel}>删掉</button>}
      <button className="btn k" id="seOk" disabled={!x.title.trim() || !x.when} onClick={() => onSave({ ...x, title: x.title.trim() })}>保存</button>
    </div>
  </div>;
}
