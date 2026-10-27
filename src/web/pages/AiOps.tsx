// AI 运营：先付费解锁，再做 AI 面诊（按大哲一对一定位的方法问三块：个人、专业、品牌），出面诊报告（三类标签 + 栏目规划），
// 栏目直接变成运营计划。回答都存进知识库，后面写文案也会用。
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { useApp, useData } from '../store.tsx';
import { Seg, Skel, Src } from '../ui/kit.tsx';
import { OpsPlan } from './Ops.tsx';
import { SECTION_NAME, type DiagColumn, type DiagQuestion, type DiagReport, type Diagnosis } from '../../shared/kb.ts';
import { typeOf } from '../../shared/video.ts';

export function OpsPage() {
  const { route, nav } = useApp();
  const d = useData(() => api.diagnosis(), []);
  if (!d.data) return <section className="view on" id="v-ops"><div className="vb wrap" style={{ paddingTop: 60 }}><Skel h={320} /></div></section>;
  const { diagnosis: dg, questions, price } = d.data;
  const set = (x: Diagnosis) => d.set({ ...d.data!, diagnosis: x });
  const tab = !dg.report || route.sub === 'diag' ? 'diag' : route.sub === 'report' ? 'report' : 'plan';
  return <section className="view on" id="v-ops"><div className="vb">
    <div className="hero tight">
      <p className="eyebrow">AI 运营 · 专家版</p>
      <h1 className="d2">{!dg.unlocked ? <>先定位，<em>再出片。</em></> : dg.report ? <>你的账号，<em>按栏目来做。</em></> : <>AI 面诊，<em>十分钟。</em></>}</h1>
      {dg.report && <div style={{ marginTop: 22 }} id="opsTabs"><Seg value={tab === 'diag' ? 'report' : tab} options={['plan', 'report'] as const} render={v => v === 'plan' ? '运营计划' : '面诊报告'} onChange={v => nav({ view: 'ops', sub: v }, true)} /></div>}
    </div>
    {!dg.unlocked ? <Unlock price={price} onDone={set} />
      : tab === 'diag' ? <Interview dg={dg} questions={questions} onChange={set} />
      : tab === 'report' ? <Report dg={dg} onChange={set} onRedo={() => nav({ view: 'ops', sub: 'diag' })} />
      : <OpsPlan report={dg.report} />}
  </div></section>;
}

function Unlock({ price, onDone }: { price: number; onDone: (d: Diagnosis) => void }) {
  const { session, fail, reloadSession, sheet, toast } = useApp();
  const go = () => sheet({
    title: '解锁 AI 运营',
    body: <><div className="list"><div><span>AI 面诊 + 面诊报告 + 运营计划</span><span className="v">{price} 点</span></div></div><p className="note">余额 {Math.round(session!.workspace.balance).toLocaleString()} 点。解锁后可以随时重新面诊。</p></>,
    foot: <><button className="btn g" onClick={() => sheet(null)}>再想想</button><button className="btn y" id="unlockOk" onClick={async () => { try { const r = await api.unlock(); sheet(null); onDone(r.diagnosis); await reloadSession(); toast('解锁了，开始面诊'); } catch (e) { fail(e); } }}>解锁 · {price} 点</button></>,
  });
  return <div className="wrap" style={{ maxWidth: 1024 }}>
    <p className="lead" style={{ textAlign: 'center' }}>大哲 IP 研究院给学员做的一对一定位，现在由 AI 来做：聊十分钟，拿到你的个性、专业、品牌三类标签和账号栏目，之后的排期和文案都按它来。</p>
    <div className="valuegrid">
      <div className="vcard"><span className="num">01</span><b>AI 面诊</b><p>按个人、专业、品牌三块问你 9 个问题，会追问。回答都存进你的知识库。</p></div>
      <div className="vcard"><span className="num">02</span><b>面诊报告</b><p>三类标签、一句话定位、账号问题、头像昵称简介建议、3–5 个栏目。</p></div>
      <div className="vcard"><span className="num">03</span><b>运营计划</b><p>按栏目排好两周要发什么，文案按你的知识库写，你只管出片和发布。</p></div>
    </div>
    <div className="sample card">
      <p className="xs m3">报告示例（学员三哥）</p>
      <div className="row" style={{ gap: 6, marginTop: 10 }}><span className="tag pro">千平大宅</span><span className="tag pro">意式生活</span><span className="tag per">敢下判断</span><span className="tag per">爱旅行</span><span className="tag brand">高定木作</span></div>
      <p className="s" style={{ marginTop: 12 }}>栏目：千平大宅案例合集（转化）· 意式生活观点（流量）· 设计师访谈（人设）· 旅行里的设计（人设）</p>
    </div>
    <div className="ctabar"><button className="btn cta" id="unlockBtn" onClick={go}>解锁 AI 运营 · {price} 点 <span aria-hidden="true">→</span></button><p className="xs m3">不会自动花点数生成视频</p></div>
  </div>;
}

function Interview({ dg, questions, onChange }: { dg: Diagnosis; questions: DiagQuestion[]; onChange: (d: Diagnosis) => void }) {
  const { fail, toast, nav } = useApp();
  const firstOpen = questions.findIndex(q => !dg.answers[q.id]?.trim());
  const [i, setI] = useState(firstOpen < 0 ? questions.length - 1 : firstOpen);
  const [text, setText] = useState(dg.answers[questions[firstOpen < 0 ? questions.length - 1 : firstOpen]?.id] ?? '');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const answered = questions.filter(q => dg.answers[q.id]?.trim()).length;
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [i]);
  const q = questions[i];
  const save = async (next: number) => {
    setBusy(true);
    try { const r = await api.answer(q.id, text); onChange(r.diagnosis); const n = Math.min(questions.length - 1, next); setI(n); setText(r.diagnosis.answers[questions[n].id] ?? ''); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const report = async () => {
    setBusy(true);
    try { if (text.trim() && text !== dg.answers[q.id]) await api.answer(q.id, text); const r = await api.makeReport(); onChange(r.diagnosis); toast('面诊报告好了'); nav({ view: 'ops', sub: 'report' }, true); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  return <div className="wrap" style={{ maxWidth: 820 }}>
    <div className="diagbar"><span>已答 <b>{answered}</b> / {questions.length}</span><div className="bar"><i style={{ width: `${(answered / questions.length) * 100}%` }} /></div>
      {(['personal', 'pro', 'brand'] as const).map(s => <Src key={s} k={q.section === s ? 'real' : ''}>{SECTION_NAME[s]}</Src>)}</div>
    <div className="chat" id="diagChat">
      {questions.slice(0, i + 1).map((x, k) => <div key={x.id}>
        <div className="bub ai"><span className="who">AI 顾问</span>{x.q}<span className="hint">{x.hint}</span></div>
        {k < i && dg.answers[x.id] && <div className="bub me" onClick={() => { setI(k); setText(dg.answers[x.id]); }} title="点一下改">{dg.answers[x.id]}</div>}
      </div>)}
      <div ref={end} />
    </div>
    <div className="composer">
      <textarea id="diagIn" value={text} onChange={e => setText(e.target.value)} placeholder="想到什么说什么，越具体越好：数字、案例、业主原话都行" rows={3}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) void save(i + 1); }} />
      <div className="row" style={{ gap: 8 }}>
        <button className="btn g sm" onClick={() => toast('语音回答在接入语音识别后开放：按住说话，自动转成文字，也会用来学你的说话方式')}>按住说话</button>
        <button className="lnk xs" disabled={busy} onClick={() => { setText(''); void save(i + 1); }}>跳过这题</button>
        <span className="sp" />
        {answered >= 3 && <button className="btn g" id="diagReport" disabled={busy} onClick={report}>{busy ? '生成中…' : '先出报告'}</button>}
        {i < questions.length - 1
          ? <button className="btn y" id="diagNext" disabled={busy || !text.trim()} onClick={() => save(i + 1)}>下一题 →</button>
          : <button className="btn cta" id="diagDone" disabled={busy || answered + (text.trim() && !dg.answers[q.id] ? 1 : 0) < 3} onClick={report}>{busy ? '生成中…' : '生成面诊报告 →'}</button>}
      </div>
    </div>
  </div>;
}

const KIND_CLASS: Record<DiagColumn['kind'], string> = { 流量: 'per', 转化: 'pro', 人设: 'brand' };
function Report({ dg, onChange, onRedo }: { dg: Diagnosis; onChange: (d: Diagnosis) => void; onRedo: () => void }) {
  const { fail, toast, nav, bump } = useApp();
  const r = dg.report as DiagReport;
  const [adding, setAdding] = useState<keyof DiagReport['tags'] | null>(null);
  const [tagIn, setTagIn] = useState('');
  const edit = async (p: Partial<Pick<DiagReport, 'tags' | 'columns'>>) => { try { onChange((await api.editReport(p)).diagnosis); bump(); } catch (e) { fail(e); } };
  const groups: [keyof DiagReport['tags'], string, string][] = [['personality', '个性标签', 'per'], ['pro', '专业标签', 'pro'], ['brand', '品牌标签', 'brand']];
  return <div className="wrap" style={{ maxWidth: 1024 }} id="diagReportView">
    <div className="card report">
      <p className="eyebrow">一句话定位</p><h2 className="d3" style={{ marginTop: 6 }}>{r.position}</h2>
      <div className="taggrid">{groups.map(([k, n, c]) => <div key={k}><p className="lb">{n}</p><div className="row" style={{ gap: 6 }}>
        {r.tags[k].map(t => <span key={t} className={`tag ${c}`}>{t}<button aria-label={`去掉 ${t}`} onClick={() => edit({ tags: { ...r.tags, [k]: r.tags[k].filter(x => x !== t) } })}>×</button></span>)}
        {adding === k ? <input className="fld sm" autoFocus value={tagIn} onChange={e => setTagIn(e.target.value)} onBlur={() => setAdding(null)} onKeyDown={e => { if (e.key === 'Enter' && tagIn.trim()) { void edit({ tags: { ...r.tags, [k]: [...r.tags[k], tagIn.trim()] } }); setTagIn(''); setAdding(null); } }} style={{ width: 120 }} />
          : <button className="tag add" onClick={() => setAdding(k)}>＋</button>}</div></div>)}</div>
    </div>
    <div className="rgrid">
      <div className="card"><p className="t2">账号现在的问题</p><p className="s m" style={{ marginTop: 8 }}>{r.account}</p></div>
      <div className="card"><p className="t2">视觉建议</p><p className="s m" style={{ marginTop: 8 }}>{r.visual}</p></div>
      <div className="card"><p className="t2">昵称和简介</p><p className="s" style={{ marginTop: 8 }}>{r.nicknames.join(' / ')}</p><p className="s m" style={{ marginTop: 6, whiteSpace: 'pre-line' }}>{r.bio}</p></div>
    </div>
    <div className="row" style={{ margin: '34px 0 12px', alignItems: 'flex-end' }}><div style={{ flex: 1 }}><h2 className="t1">栏目规划</h2><p className="s m" style={{ marginTop: 4 }}>流量打开知名度，转化带来咨询，人设让人记住你。排期按这些栏目来。</p></div></div>
    <div className="colgrid">{r.columns.map((c, k) => <div key={c.name} className="colcard">
      <div className="row" style={{ justifyContent: 'space-between' }}><span className={`tag ${KIND_CLASS[c.kind]}`}>{c.kind}</span><span className="xs m3">每周 {c.perWeek} 条</span></div>
      <b>{c.name}</b><p className="xs m3">{typeOf(c.type).n} · {c.why}</p>
      <div className="row" style={{ gap: 4, marginTop: 'auto' }}>
        <button className="btn g sm" aria-label="少一条" onClick={() => edit({ columns: r.columns.map((x, j) => j === k ? { ...x, perWeek: Math.max(1, x.perWeek - 1) } : x) })}>−</button>
        <button className="btn g sm" aria-label="多一条" onClick={() => edit({ columns: r.columns.map((x, j) => j === k ? { ...x, perWeek: Math.min(7, x.perWeek + 1) } : x) })}>＋</button>
        <span className="sp" />{r.columns.length > 1 && <button className="lnk xs" onClick={() => edit({ columns: r.columns.filter((_, j) => j !== k) })}>删掉</button>}
      </div>
    </div>)}</div>
    <div className="ctabar"><button className="btn cta" id="toPlan" onClick={() => { toast('栏目已经用在运营计划里了'); nav({ view: 'ops', sub: 'plan' }); }}>按这些栏目排期 →</button><button className="btn g" onClick={onRedo}>补充回答，重新面诊</button></div>
  </div>;
}
