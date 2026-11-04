// 查看作品数据：发出去的每一条，播放、点赞、询盘；按栏目看哪档带客户。数据先手填（以后接平台）。
import { useState } from 'react';
import { useApp } from '../../store.tsx';
import { useStudio } from './common.tsx';
import { whenLabel, type PlanItem } from '../../../shared/studio.ts';

const fmt = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(1)}w` : n.toLocaleString();

export function DataPage() {
  const { session, toast, nav } = useApp();
  const { st, save } = useStudio();
  const [edit, setEdit] = useState<string | null>(null);
  if (!st || !session) return <section className="view on"><div className="vb wrap" style={{ paddingTop: 80 }}><p className="s m">加载中…</p></div></section>;
  const works = [...st.works].sort((a, b) => b.when.localeCompare(a.when));
  const sum = (k: 'play' | 'like' | 'ask') => works.reduce((a, w) => a + (w.stats?.[k] ?? 0), 0);
  const cols = [...new Set(works.map(w => w.column))].map(c => { const l = works.filter(w => w.column === c); return { c, n: l.length, play: l.reduce((a, w) => a + (w.stats?.play ?? 0), 0) / l.length, ask: l.reduce((a, w) => a + (w.stats?.ask ?? 0), 0) }; }).sort((a, b) => b.ask - a.ask);
  const maxAsk = Math.max(1, ...cols.map(c => c.ask));
  const setStat = (w: PlanItem, k: 'play' | 'like' | 'ask', v: number) => save({ works: st.works.map(x => x.id === w.id ? { ...x, stats: { play: 0, like: 0, ask: 0, ...x.stats, [k]: Math.max(0, v || 0) } } : x) });
  return <section className="view on" id="v-data"><div className="vb wrap sch">
    <div className="hero tight" style={{ padding: '40px 0 0' }}>
      <p className="eyebrow">查看作品数据</p>
      <h1 className="d2">发了 <em>{works.length} 条</em>，带来 {sum('ask')} 个询盘。</h1>
      <p className="s m" style={{ marginTop: 8 }}>先手填播放、点赞和询盘（私信问价算一个），以后接上平台自动拉。</p>
    </div>
    <div className="tiles" id="dataTiles">
      <div><b>{fmt(sum('play'))}</b><span>总播放</span></div>
      <div><b>{fmt(sum('like'))}</b><span>点赞</span></div>
      <div className="w"><b>{sum('ask')}</b><span>询盘</span></div>
      <div><b>{works.length}</b><span>已发布</span></div>
    </div>
    {cols.length > 0 && <>
      <p className="lb" style={{ marginTop: 26 }}>哪档栏目带客户</p>
      <div className="colbars" id="dataCols">{cols.map(c => <div key={c.c}><span className="cb-n">{c.c}<span className="xs m3"> · {c.n} 条 · 平均播放 {fmt(Math.round(c.play))}</span></span><span className="cb-b"><i style={{ width: `${c.ask / maxAsk * 100}%` }} /></span><b>{c.ask} 询盘</b></div>)}</div>
    </>}
    <p className="lb" style={{ marginTop: 26 }}>每一条</p>
    <div className="ptable dt" role="table" id="dataTable">
      <div className="pth" role="row"><span>标题</span><span>类型</span><span>账号</span><span>发布</span><span>播放</span><span>点赞</span><span>询盘</span><span /></div>
      {works.map(w => <div key={w.id} role="row" className="ptr">
        <span role="cell" className="pt-t">{w.title}<span className="xs m3">{w.column}</span></span>
        <span role="cell" data-l="类型">{w.type}</span>
        <span role="cell" data-l="账号">{w.account}</span>
        <span role="cell" data-l="发布">{whenLabel(w.when, session.today)}</span>
        {(['play', 'like', 'ask'] as const).map(k => <span key={k} role="cell" data-l={{ play: '播放', like: '点赞', ask: '询盘' }[k]}>{edit === w.id ? <input className="fld sm num" type="number" min={0} value={w.stats?.[k] ?? 0} onChange={e => void setStat(w, k, Number(e.target.value))} aria-label={k} /> : fmt(w.stats?.[k] ?? 0)}</span>)}
        <span role="cell" className="pt-a"><button className="lnk xs" onClick={() => { setEdit(edit === w.id ? null : w.id); if (edit === w.id) toast('记下了'); }}>{edit === w.id ? '好了' : '填数据'}</button></span>
      </div>)}
    </div>
    {!works.length && <p className="s m">还没有发出去的。去「安排发布计划」里点「发了」。<button className="lnk" onClick={() => nav('sched')}>去看看</button></p>}
  </div></section>;
}
