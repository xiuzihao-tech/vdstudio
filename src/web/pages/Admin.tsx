// 管理后台：概览（漏斗、每日活跃、花费）、用户、邀请码、反馈、开关。只有 ADMIN_EMAILS 里的账号能进。
import { useState } from 'react';
import { api } from '../api.ts';
import { useApp, useData } from '../store.tsx';
import { Empty, Seg, Skel, Src } from '../ui/kit.tsx';

type Tab = 'overview' | 'users' | 'invites' | 'feedback';
const TABN: Record<Tab, string> = { overview: '概览', users: '用户', invites: '邀请码', feedback: '反馈' };
const fmt = (s: string | null) => (s ? new Date(s).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export function AdminPage() {
  const { session, route, nav } = useApp();
  if (!session?.isAdmin) return <section className="view on"><div className="vb wrap"><Empty title="只有管理员能看">把你的邮箱加进服务器的 ADMIN_EMAILS，再用这个邮箱登录。</Empty></div></section>;
  const tab = (Object.keys(TABN) as Tab[]).includes(route.sub as Tab) ? (route.sub as Tab) : 'overview';
  return <section className="view on" id="v-admin"><div className="vb wrap" style={{ paddingTop: 40 }}>
    <div className="row" style={{ alignItems: 'flex-end' }}><h1 className="d2" style={{ flex: 1 }}>后台</h1>
      <Seg value={tab} options={Object.keys(TABN) as Tab[]} render={t => TABN[t]} onChange={t => nav({ view: 'admin', sub: t }, true)} /></div>
    <div style={{ marginTop: 24 }}>{tab === 'overview' ? <Overview /> : tab === 'users' ? <Users /> : tab === 'invites' ? <Invites /> : <FeedbackList />}</div>
  </div></section>;
}

function Overview() {
  const { fail, toast } = useApp();
  const [days, setDays] = useState(7);
  const d = useData(() => api.admin.overview(days), [days]);
  const [pausedLocal, setPausedLocal] = useState<boolean | null>(null);
  if (!d.data) return <Skel h={300} />;
  const paused = pausedLocal ?? d.data.settings.genPaused;
  const o = d.data, top = Math.max(1, o.funnel[0]?.owners ?? 1);
  const spent = o.jobs.filter(j => j.status !== 'failed').reduce((a, j) => a + j.cost, 0);
  const fails = o.jobs.find(j => j.status === 'failed')?.n ?? 0, total = o.jobs.reduce((a, j) => a + j.n, 0);
  return <>
    <div className="row" style={{ gap: 10 }}>
      <Seg value={days} options={[1, 7, 30] as const} render={v => v === 1 ? '今天' : `近 ${v} 天`} onChange={setDays} /><span style={{ flex: 1 }} />
      <label className="row s" style={{ gap: 10 }}><span>{paused ? <b style={{ color: 'var(--err)' }}>生成已暂停</b> : '生成开放中'}</span>
        <input type="checkbox" className="sw" id="pauseSw" checked={!paused} onChange={async e => { const on = e.target.checked; setPausedLocal(!on); try { const r = await api.admin.setPaused(!on); setPausedLocal(r.settings.genPaused); toast(on ? '已恢复生成' : '已暂停：所有人都不能提交新的生成'); } catch (er) { setPausedLocal(null); fail(er); } }} /></label>
    </div>
    <div className="mine" style={{ marginTop: 18 }}>
      <div className="gbox"><b className="ro" style={{ fontSize: 26 }}>{o.totals.users}</b><p className="s m">注册用户 · 新增 {o.totals.newUsers}</p></div>
      <div className="gbox"><b className="ro" style={{ fontSize: 26 }}>{spent}</b><p className="s m">生成花费（点）· 今天 {o.totals.spentToday}{o.config.dailyBudget ? ` / ${o.config.dailyBudget}` : ''}</p></div>
      <div className="gbox"><b className="ro" style={{ fontSize: 26 }}>{total}</b><p className="s m">生成任务 · 失败 {fails}{total ? `（${Math.round((fails / total) * 100)}%）` : ''}</p></div>
      <div className="gbox"><b className="ro" style={{ fontSize: 26 }}>{o.totals.feedbackNew}</b><p className="s m">未处理反馈</p></div>
    </div>
    <div className="gbox" style={{ marginTop: 16 }}>
      <div className="hd">漏斗<span>做过这一步的人数（按账号去重）</span></div>
      <div id="funnel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{o.funnel.map((f, i) => {
        const prev = i ? o.funnel[i - 1].owners : 0;
        return <div key={f.label} style={{ display: 'grid', gridTemplateColumns: '84px 1fr 96px', gap: 12, alignItems: 'center' }}>
          <span className="s">{f.label}</span>
          <div style={{ height: 22, borderRadius: 6, background: 'color-mix(in srgb,var(--tx) 7%,transparent)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${(f.owners / top) * 100}%`, background: 'var(--ac)', borderRadius: 6 }} /></div>
          <span className="s ro" style={{ textAlign: 'right' }}><b>{f.owners}</b>{i > 0 && prev ? <span className="xs m3"> · {Math.round((f.owners / prev) * 100)}%</span> : ''}</span>
        </div>;
      })}</div>
      <p className="xs m3" style={{ marginTop: 10 }}>百分比是相对上一步的转化。</p>
    </div>
    <div className="gctl" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
      <div className="gbox"><div className="hd">每天</div>
        {o.daily.length ? <table className="s" style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr className="xs m3"><th style={{ textAlign: 'left' }}>日期</th><th style={{ textAlign: 'right' }}>活跃</th><th style={{ textAlign: 'right' }}>存草稿</th><th style={{ textAlign: 'right' }}>生成</th></tr></thead>
          <tbody>{o.daily.map(r => <tr key={r.day} style={{ borderTop: '1px solid var(--ln2)' }}><td style={{ padding: '6px 0' }}>{r.day.slice(5)}</td><td className="ro" style={{ textAlign: 'right' }}>{r.active}</td><td className="ro" style={{ textAlign: 'right' }}>{r.drafts}</td><td className="ro" style={{ textAlign: 'right' }}>{r.gens}</td></tr>)}</tbody></table> : <p className="s m">还没有数据</p>}
      </div>
      <div className="gbox"><div className="hd">配置</div><div className="list">
        <div><span>注册方式</span><span className="v">{o.config.inviteRequired ? '邀请制' : '开放注册'}{o.config.authRequired ? ' · 必须登录' : ' · 可匿名试用'}</span></div>
        <div><span>新用户点数</span><span className="v">{o.config.initialPoints}</span></div>
        <div><span>每人每天生成</span><span className="v">{o.config.dailyJobsPerUser || '不限'}</span></div>
        <div><span>全站每天预算</span><span className="v">{o.config.dailyBudget || '不限'}</span></div>
        <div><span>文案 / 视频</span><span className="v">{o.ai.copy === 'llm' ? '真实模型' : 'Mock'} / {o.ai.video === 'seedance' ? 'Seedance' : 'Mock'}</span></div>
      </div><p className="xs m3" style={{ marginTop: 8 }}>这些在服务器的 .env 里改，改完重启。</p></div>
    </div>
  </>;
}

function Users() {
  const { fail, toast } = useApp();
  const d = useData(() => api.admin.users(), []);
  if (!d.data) return <Skel h={200} />;
  if (!d.data.users.length) return <Empty title="还没有注册用户" />;
  const add = async (id: string, delta: number) => { try { d.set(await api.admin.addPoints(id, delta)); toast(`${delta > 0 ? '加' : '扣'}了 ${Math.abs(delta)} 点`); } catch (e) { fail(e); } };
  return <div className="list" id="userList">{d.data.users.map(u => <div key={u.id} style={{ flexWrap: 'wrap', gap: 10 }}>
    <span style={{ flex: 1, minWidth: 220 }}>{u.name} <span className="xs m3">{u.email}</span><br /><span className="xs m3">注册 {fmt(u.createdAt)} · 最近活跃 {fmt(u.lastActive)}{u.invite ? ` · 邀请码 ${u.invite}` : ''}</span></span>
    <span className="xs m ro" style={{ minWidth: 150 }}>余额 <b>{Math.round(u.balance)}</b> · 生成 {u.jobs} 次 · 花 {Math.round(u.spent)}</span>
    <button className="btn g sm" onClick={() => add(u.id, 500)}>＋500 点</button>
  </div>)}</div>;
}

function Invites() {
  const { fail, toast } = useApp();
  const d = useData(() => api.admin.invites(), []);
  const [n, setN] = useState(5), [uses, setUses] = useState(1), [note, setNote] = useState('');
  const [fresh, setFresh] = useState<string[]>([]);
  const link = (c: string) => `${location.origin}/?invite=${c}`;
  const make = async () => { try { const r = await api.admin.createInvites(n, uses, note); setFresh(r.codes); d.set({ invites: r.invites }); toast(`生成了 ${r.codes.length} 个邀请码`); } catch (e) { fail(e); } };
  return <>
    <div className="gbox"><div className="hd">新建邀请码</div>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <label className="s">数量<input className="fld" type="number" min={1} max={100} value={n} onChange={e => setN(Number(e.target.value))} style={{ width: 90, display: 'block', marginTop: 4 }} /></label>
        <label className="s">每个可用几次<input className="fld" type="number" min={1} max={1000} value={uses} onChange={e => setUses(Number(e.target.value))} style={{ width: 110, display: 'block', marginTop: 4 }} /></label>
        <label className="s" style={{ flex: 1, minWidth: 160 }}>备注<input className="fld" value={note} onChange={e => setNote(e.target.value)} placeholder="比如：设计师群第一批" style={{ display: 'block', marginTop: 4 }} /></label>
        <button className="btn y" id="mkInv" onClick={make}>生成</button>
      </div>
      {fresh.length > 0 && <div style={{ marginTop: 14 }}><p className="s">发给对方这个链接，打开后邀请码自动填好：</p>
        <textarea className="fld" readOnly rows={Math.min(8, fresh.length)} value={fresh.map(link).join('\n')} style={{ marginTop: 6, fontFamily: 'ui-monospace,monospace', fontSize: 13 }} />
        <button className="btn g sm" style={{ marginTop: 8 }} onClick={() => navigator.clipboard?.writeText(fresh.map(link).join('\n')).then(() => toast('已复制'), () => toast('复制不了，手动选一下'))}>复制全部链接</button></div>}
    </div>
    {d.data && <div className="list" style={{ marginTop: 16 }}>{d.data.invites.map(i => <div key={i.code}><span><b className="ro" style={{ letterSpacing: '.06em' }}>{i.code}</b> <span className="xs m3">{i.note}</span></span><span className="v">{i.used}/{i.maxUses} {i.used >= i.maxUses ? <Src>用完</Src> : <Src k="real">可用</Src>}</span></div>)}</div>}
  </>;
}

function FeedbackList() {
  const { fail } = useApp();
  const d = useData(() => api.admin.feedback(), []);
  if (!d.data) return <Skel h={200} />;
  if (!d.data.feedback.length) return <Empty title="还没有反馈">页面右下角有“提意见”按钮，用户提交后会出现在这里。</Empty>;
  const set = async (id: string, status: string) => { try { d.set(await api.admin.setFeedback(id, status)); } catch (e) { fail(e); } };
  return <div className="list" id="fbList">{d.data.feedback.map(f => <div key={f.id} style={{ flexWrap: 'wrap', gap: 10, opacity: f.status === 'done' ? 0.55 : 1 }}>
    <span style={{ flex: 1, minWidth: 260 }}>{f.text}<br /><span className="xs m3">{f.name ?? '匿名'}{f.email ? ` · ${f.email}` : ''}{f.contact ? ` · 联系：${f.contact}` : ''} · 在「{f.page}」· {fmt(f.createdAt)}</span></span>
    {f.status === 'new' ? <Src k="warn">新</Src> : f.status === 'read' ? <Src>已读</Src> : <Src k="real">已处理</Src>}
    {f.status !== 'read' && f.status !== 'done' && <button className="btn g sm" onClick={() => set(f.id, 'read')}>已读</button>}
    {f.status !== 'done' && <button className="btn g sm" onClick={() => set(f.id, 'done')}>处理完</button>}
  </div>)}</div>;
}
