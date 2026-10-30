// 管理后台：概览（漏斗、每日活跃、花费）、用户、邀请码、反馈、开关。只有 ADMIN_EMAILS 里的账号能进。
import { useState } from 'react';
import { api, type ModelList } from '../api.ts';
import { useApp, useData } from '../store.tsx';
import { Empty, Seg, Skel, Src } from '../ui/kit.tsx';
import { AdminModules } from './AdminModules.tsx';

type Tab = 'overview' | 'modules' | 'users' | 'invites' | 'feedback' | 'ai' | 'redeem';
const TABN: Record<Tab, string> = { overview: '概览', modules: '模块开关', users: '用户', invites: '邀请码', redeem: '兑换码', feedback: '反馈', ai: 'AI 服务' };
const fmt = (s: string | null) => (s ? new Date(s).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export function AdminPage() {
  const { session, route, nav } = useApp();
  if (!session?.isAdmin) return <section className="view on"><div className="vb wrap"><Empty title="只有管理员能看">把你的邮箱加进服务器的 ADMIN_EMAILS，再用这个邮箱登录。</Empty></div></section>;
  const tab = (Object.keys(TABN) as Tab[]).includes(route.sub as Tab) ? (route.sub as Tab) : 'overview';
  return <section className="view on" id="v-admin"><div className="vb wrap" style={{ paddingTop: 40 }}>
    <div className="row" style={{ alignItems: 'flex-end' }}><h1 className="d2" style={{ flex: 1 }}>后台</h1>
      <Seg value={tab} options={Object.keys(TABN) as Tab[]} render={t => TABN[t]} onChange={t => nav({ view: 'admin', sub: t }, true)} /></div>
    <div style={{ marginTop: 24 }}>{tab === 'overview' ? <Overview /> : tab === 'modules' ? <AdminModules /> : tab === 'users' ? <Users /> : tab === 'invites' ? <Invites /> : tab === 'redeem' ? <Redeem /> : tab === 'ai' ? <AiServices /> : <FeedbackList />}</div>
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

/** AI 服务：看接入状态、拉取两个站的可用模型、切换默认文案模型和各视频档位用的模型、连通测试 */
const PREFER_LLM = [/^deepseek-v4\.1-flash$/i, /^deepseek-v4-flash$/i, /deepseek-v\d/i, /deepseek-chat/i, /qwen3?-max/i, /qwen/i, /gpt-5/i, /claude-sonnet/i, /gemini/i];
/** 推荐配置（2026-10 按两站价格表选：中文写作好、便宜、稳定） */
const RECOMMENDED = {
  llm: 'deepseek-v4.1-flash', fine: 'deepseek-v4-pro', fallbacks: ['deepseek-v4-flash'],
  video: { s25: 'seedance-2.5', s20: 'seedance-2.0', s20f: 'seedance-2.0-fast', wan: 'wan3.0', draft: 'seedance-2.0-mini' } as Record<string, string>,
};
function AiServices() {
  const { fail, toast } = useApp();
  const d = useData(() => api.admin.ai(), []);
  const [lists, setLists] = useState<{ llm: ModelList; video: ModelList } | null>(null);
  const [busy, setBusy] = useState('');
  const [llm, setLlm] = useState<string | null>(null);
  const [vm, setVm] = useState<Record<string, string> | null>(null);
  const [fine, setFine] = useState<string | null>(null);
  const [fb, setFb] = useState<string | null>(null);
  const [test, setTest] = useState<Awaited<ReturnType<typeof api.admin.aiTest>> | null>(null);
  if (!d.data) return <Skel h={200} />;
  const st = d.data.status, curLlm = llm ?? st.copy.model ?? '', curVm = vm ?? st.video.models ?? {};
  const curFine = fine ?? st.copy.fineModel ?? '', curFb = fb ?? (st.copy.fallbacks ?? []).join(', ');
  const dirty = llm !== null || vm !== null || fine !== null || fb !== null;
  const useRecommended = () => { setLlm(RECOMMENDED.llm); setFine(RECOMMENDED.fine); setFb(RECOMMENDED.fallbacks.join(', ')); if (st.video.kind === 'newapi') setVm({ ...curVm, ...RECOMMENDED.video }); toast('已填入推荐配置，点「保存」生效'); };
  const pull = async () => { setBusy('pull'); try { const r = await api.admin.aiModels(); setLists(r); if (!r.llm.ok && !r.video.ok) toast('两个站都没连上，看下面的错误'); } catch (e) { fail(e); } finally { setBusy(''); } };
  const save = async () => { setBusy('save'); try { const r = await api.admin.aiSave({ llmModel: curLlm, llmModelFine: curFine, llmFallbacks: curFb.split(/[,，\s]+/).filter(Boolean), videoModels: curVm }); d.set({ ...d.data!, status: r.status }); setLlm(null); setVm(null); setFine(null); setFb(null); toast('已保存，马上生效'); } catch (e) { fail(e); } finally { setBusy(''); } };
  const runTest = async () => { setBusy('test'); setTest(null); try { setTest(await api.admin.aiTest()); } catch (e) { fail(e); } finally { setBusy(''); } };
  const llmOptions = lists?.llm.models.filter(m => !/(seedance|wan|video|image|embedding|tts|whisper|dall|veo|kling|sora|minimax-h)/i.test(m)) ?? [];
  const suggested = PREFER_LLM.map(re => llmOptions.find(m => re.test(m))).find(Boolean);
  const videoOptions = lists?.video.models.filter(m => /(seedance|wan|video|kling|veo|sora|hailuo|minimax|vidu|jimeng|sd-)/i.test(m)) ?? [];
  const kind = { mock: <Src>模拟</Src>, llm: <Src k="real">已接入</Src>, seedance: <Src k="real">方舟直连</Src>, newapi: <Src k="real">已接入</Src> } as const;
  return <div id="aiSvc">
    <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
      <button className="btn g" id="aiPull" disabled={!!busy} onClick={pull}>{busy === 'pull' ? '拉取中…' : '拉取可用模型'}</button>
      <button className="btn g" id="aiTest" disabled={!!busy || st.copy.kind === 'mock'} onClick={runTest}>{busy === 'test' ? '测试中…' : '测试文案模型'}</button>
      <button className="btn g" id="aiRec" disabled={!!busy || st.copy.kind === 'mock'} onClick={useRecommended}>用推荐配置</button>
      <button className="btn y" id="aiSave" disabled={!!busy || !dirty} onClick={save}>保存</button>
    </div>
    {test && <p className="s" style={{ marginTop: 12, color: test.ok ? 'var(--real)' : 'var(--err)' }}>{test.ok ? `✓ ${test.model} 通了，${test.ms} 毫秒：${test.reply}` : `✗ ${test.model}：${test.error}`}</p>}
    <div className="gctl" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', marginTop: 16 }}>
      <div className="gbox"><div className="hd">文案模型 {kind[st.copy.kind]}<span>{st.copy.baseUrl ?? '没配密钥，用模拟结果'}</span></div>
        {st.copy.kind === 'mock' ? <p className="s m">在服务器的 .env 里填 LLM_BASE_URL 和 LLM_API_KEY 后重启。</p> : <>
          <label className="lb" htmlFor="aiLlm">默认模型</label>
          <input className="fld" id="aiLlm" list="aiLlmList" value={curLlm} onChange={e => setLlm(e.target.value)} placeholder="比如 deepseek-v4、gpt-5.6-terra" />
          <datalist id="aiLlmList">{llmOptions.map(m => <option key={m} value={m} />)}</datalist>
          {suggested && suggested !== curLlm && <p className="xs" style={{ marginTop: 8 }}>建议用 <button className="lnk xs" onClick={() => setLlm(suggested)}>{suggested}</button>（中文写作好、价格低）</p>}
          <label className="lb" htmlFor="aiFine" style={{ marginTop: 14 }}>精写模型 <span className="m3">文案页「✦ 精写一版」用，不填就用默认模型</span></label>
          <input className="fld" id="aiFine" list="aiLlmList" value={curFine} onChange={e => setFine(e.target.value)} placeholder="比如 deepseek-v4-pro" />
          <label className="lb" htmlFor="aiFb" style={{ marginTop: 14 }}>备用模型 <span className="m3">主模型出错时依次改用，逗号分隔</span></label>
          <input className="fld" id="aiFb" value={curFb} onChange={e => setFb(e.target.value)} placeholder="比如 deepseek-v4-flash" />
          {lists && <p className="xs m3" style={{ marginTop: 8 }}>{lists.llm.ok ? `这个站有 ${llmOptions.length} 个文本模型可选` : `拉取失败：${lists.llm.error}`}</p>}
        </>}
      </div>
      <div className="gbox"><div className="hd">视频模型 {kind[st.video.kind]}<span>{st.video.baseUrl ?? '没配密钥，用模拟结果'}</span></div>
        {st.video.kind === 'mock' ? <p className="s m">在服务器的 .env 里填 VIDEO_BASE_URL 和 VIDEO_API_KEY 后重启。</p> : <>
          <p className="xs m3" style={{ marginBottom: 8 }}>页面上的每个档位，实际调用哪个模型：</p>
          {d.data.tiers.map(t => <div key={t.id} className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'nowrap' }}>
            <span className="s" style={{ width: 130, flex: 'none' }} title={t.d}>{t.n}</span>
            <input className="fld" list="aiVidList" data-tier={t.id} value={curVm[t.id] ?? ''} placeholder="不填 = 这个档位不可用" onChange={e => setVm({ ...curVm, [t.id]: e.target.value })} />
          </div>)}
          <datalist id="aiVidList">{videoOptions.map(m => <option key={m} value={m} />)}</datalist>
          {lists && <p className="xs m3">{lists.video.ok ? `这个站有 ${videoOptions.length} 个视频模型` : `拉取失败：${lists.video.error}`}</p>}
        </>}
      </div>
    </div>
    <p className="note">密钥只在服务器的 .env 里，这里看不到也改不了。改模型不用重启，保存后下一次调用就生效。</p>
  </div>;
}

/** 兑换码：线下收款后发给学员，在「点数」里兑换 */
function Redeem() {
  const { toast, fail } = useApp();
  const d = useData(() => api.admin.redeemCodes(), []);
  const [n, setN] = useState(5), [pts, setPts] = useState(500), [uses, setUses] = useState(1), [note, setNote] = useState('');
  const [fresh, setFresh] = useState<string[]>([]);
  const make = async () => { try { const r = await api.admin.createRedeem(n, pts, uses, note); setFresh(r.codes); d.reload(); toast(`生成了 ${r.codes.length} 个兑换码`); } catch (e) { fail(e); } };
  return <>
    <div className="gbox"><div className="hd">新建兑换码</div>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <label className="lb">数量<input className="fld" type="number" min={1} max={100} value={n} onChange={e => setN(Number(e.target.value))} style={{ width: 90 }} /></label>
        <label className="lb">每个多少点<input className="fld" type="number" min={1} value={pts} onChange={e => setPts(Number(e.target.value))} style={{ width: 110 }} /></label>
        <label className="lb">每个能用几次<input className="fld" type="number" min={1} value={uses} onChange={e => setUses(Number(e.target.value))} style={{ width: 90 }} /></label>
        <label className="lb" style={{ flex: 1 }}>备注<input className="fld" value={note} onChange={e => setNote(e.target.value)} placeholder="比如：10 月学员班" /></label>
        <button className="btn y" id="mkRedeem" onClick={make}>生成</button>
      </div>
      {fresh.length > 0 && <textarea className="fld" readOnly rows={Math.min(8, fresh.length)} value={fresh.join('\n')} style={{ marginTop: 12 }} />}
    </div>
    <div className="list" style={{ marginTop: 14 }}>{d.data?.codes.length ? d.data.codes.map(c => <div key={c.code}><span className="ro">{c.code}<br /><span className="xs m3">{c.note || '—'}</span></span><span className="v">{c.points} 点 · 已用 {c.used}/{c.maxUses}</span></div>) : <div><span className="m">还没有兑换码</span></div>}</div>
  </>;
}
