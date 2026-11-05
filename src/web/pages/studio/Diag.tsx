// 大哲诊断账号（付费，¥899 一次解锁）：解锁页 + 示例报告 → 一路深聊（不限题数，随时结束）→ 三类标签 + 四档栏目
// → 第二轮问「每档能拍几套」→ 约 15 条选题 →「保存，进入发布计划」。诊断是可选的，不做也能直接出片。
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { useApp, useData } from '../../store.tsx';
import { studioNow, useStudio } from './common.tsx';
import { usePayOrder } from './Pay.tsx';
import { CHANNEL_NAME, yuan } from '../../../shared/billing.ts';
import {
  ACCOUNTS, DEMO_ANSWERS, DEMO_NAME, DIAG_MORE, DIAG_PRICE, DIAG_QS, SHENG, STAGES, diagResult, makeTopics, schedule, vtype,
  type DiagMsg, type DiagResult, type DiagState,
} from '../../../shared/studio.ts';

const WELCOME = '欢迎来到大哲诊断账号。我会一路问下去——从你的回答里抓个性、专业、品牌三类标签，最后定出四档栏目。题目不限，直到你说够了：随时点右上角「结束并生成诊断」。打字或者按麦克风说都行，想到什么说什么。';
const ACKS = ['记下了。', '好，这个很有用。', '明白。', '这句能做成栏目。', '嗯，接着来。'];
const qMsg = (i: number): DiagMsg => i < DIAG_QS.length
  ? { who: 'ai', text: DIAG_QS[i][1], stage: DIAG_QS[i][0], n: i + 1 }
  : { who: 'ai', text: DIAG_MORE[Math.min(i - DIAG_QS.length, DIAG_MORE.length - 1)], stage: 3, n: i + 1 };

export function DiagPage() {
  const { st, saveDiag } = useStudio();
  const [sample, setSample] = useState(false);
  if (!st) return <section className="view on"><div className="vb wrap" style={{ paddingTop: 80 }}><p className="s m">加载中…</p></div></section>;
  const g = st.diag;
  const setG = saveDiag;
  return <section className="view on" id="v-diag"><div className="vb wrap dg">
    {!g.unlocked ? (sample ? <Sample onBack={() => setSample(false)} /> : <Paywall onSample={() => setSample(true)} />)
      : !g.result ? <Chat g={g} setG={setG} />
        : g.round === 1 ? <Result r={g.result} setG={setG} g={g} />
          : <Round2 g={g} setG={setG} />}
  </div></section>;
}

function Paywall({ onSample }: { onSample: () => void }) {
  const { sheet, toast } = useApp();
  const { replace } = useStudio();
  const b = useData(() => api.billing(), []);
  const pay = usePayOrder();
  const price = b.data?.diagPrice ?? DIAG_PRICE * 100;
  const paid = async () => { const r = await api.studio(); replace(r.state); toast('解锁了，开始聊吧'); };
  const unlock = () => {
    const chs = b.data?.channels ?? [];
    if (!chs.length) { toast('在线支付还没开通，已购学员找老师开通'); return; }
    if (chs.length === 1) { void pay('diag', chs[0], undefined, () => void paid()); return; }
    sheet({ title: `解锁大哲诊断账号 · ${yuan(price)}`, body: <>
      <p className="s">一次解锁，永久可用，不按次扣点。选一个付款方式：</p>
      <div className="chans" style={{ marginTop: 14 }}>{chs.map(c => <button key={c} className={`chan ch-${c}`} data-ch={c} onClick={() => { sheet(null); void pay('diag', c, undefined, () => void paid()); }}>{CHANNEL_NAME[c]}</button>)}</div>
    </> });
  };
  return <div className="paywall" id="dgPaywall">
    <div className="pw-l">
      <p className="eyebrow">付费诊断 · 可选</p>
      <h1 className="d2">大哲诊断账号</h1>
      <p className="lead2">一路深聊，抓出你的个性 / 专业 / 品牌三类标签，再按标签定出四档栏目。</p>
      <p className="s m" style={{ marginTop: 10 }}>聊到你聊透为止。题目不限。诊断完，选题就有源头了。</p>
      <ul className="pw-list">
        <li>不限题数的深聊，抓到三类标签</li>
        <li>按标签生成四档栏目，每档带示例选题与更新频率</li>
        <li>诊断结果自动进入「安排发布计划」，写文案、出片都按它来</li>
        <li>结果可随时改，改了栏目和选题跟着变</li>
      </ul>
    </div>
    <div className="pw-r">
      <p className="pw-price"><b>{yuan(price)}</b><span>一次解锁 · 永久可用 · 不按次扣点</span></p>
      <button className="btn k big" id="dgUnlock" onClick={unlock}>{yuan(price)} 立即解锁</button>
      <button className="btn g big" id="dgSample" onClick={onSample}>先看盛哥的诊断结果 →</button>
      <p className="xs m3">已购学员直接进入，不会二次收费。解锁后进一步不消耗点数。</p>
      <p className="xs m3">不做诊断也能直接出片——去「一键生成视频」。</p>
    </div>
  </div>;
}

function Sample({ onBack }: { onBack: () => void }) {
  const topics = makeTopics(SHENG.columns, [3, 2, 2, 3]);
  return <>
    <div className="row" style={{ justifyContent: 'space-between', paddingTop: 30 }}><button className="lnk s" onClick={onBack}>← 返回</button><span className="tag">示例报告 · 内容待苗苗润色</span></div>
    <ResultView r={SHENG} />
    <p className="lb" style={{ marginTop: 26 }}>第二轮聊完排出的选题（前 6 条）</p>
    <ol className="toplist">{topics.slice(0, 6).map((t, i) => <li key={i}><b>{t.title}</b><span className="xs m3">{t.column} · {vtype(t.type).n}</span></li>)}</ol>
    <div className="stfoot"><span className="xs m3">你的诊断会按你自己的回答出。</span><button className="btn k" onClick={onBack}>想要我的 →</button></div>
  </>;
}

/* ---------- 一问一答 ---------- */
function Chat({ g, setG }: { g: DiagState; setG: (p: Partial<DiagState>, localOnly?: boolean) => Promise<void> }) {
  const { toast, session } = useApp();
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState(false);
  const live = { get current() { return studioNow()?.diag ?? g; } };
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!g.msgs.length) void setG({ msgs: [{ who: 'ai', text: WELCOME }, qMsg(0)], asked: 1 }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [g.msgs.length, typing]);
  const answers = g.msgs.filter(m => m.who === 'me').length;
  const stage = [...g.msgs].reverse().find(m => m.stage !== undefined)?.stage ?? 0;

  const send = async (t: string) => {
    const v = t.trim(); if (!v) return;

    setText('');
    const cur = live.current;
    const msgs = [...cur.msgs, { who: 'me' as const, text: v }];
    await setG({ msgs }, true);
    setTyping(true);
    await new Promise(r => setTimeout(r, 450));
    setTyping(false);
    const q = qMsg(cur.asked);
    await setG({ msgs: [...msgs, { ...q, text: `${ACKS[cur.asked % ACKS.length]}${q.text}` }], asked: cur.asked + 1 });
  };
  const finish = async () => {
    if (live.current.msgs.filter(m => m.who === 'me').length < 3) { toast('再聊两句，至少回答 3 个问题'); return; }
    setBusy(true);
    await new Promise(r => setTimeout(r, 900));
    const me = live.current.msgs.filter(m => m.who === 'me').map(m => m.text);
    await setG({ result: diagResult(me, session!.workspace.positioning.name || '我'), round: 1 });
    setBusy(false);
  };
  const demo = async () => {
    setBusy(true);
    for (let i = answers; i < DEMO_ANSWERS.length; i++) await send(DEMO_ANSWERS[i]);
    setBusy(false);
    await finish();
  };
  const mic = () => {
    const W = window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any };
    const SR = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!SR) { toast('这个浏览器不支持语音输入，先打字；手机上可以用输入法的语音键'); return; }
    const r = new SR(); r.lang = 'zh-CN'; r.interimResults = false;
    r.onresult = (e: any) => setText(x => x + e.results[0][0].transcript);
    r.onend = () => setRec(false);
    setRec(true); r.start();
  };
  const lastQ = [...g.msgs].reverse().find(m => m.who === 'ai' && m.n);
  return <div className="dgchat" id="dgChat">
    <div className="chathd">
      <div><p className="eyebrow">大哲诊断账号</p><ol className="dgsteps" id="dgStages">{STAGES.map((s, i) => <li key={s} className={i === stage ? 'on' : i < stage ? 'done' : ''}>{s}</li>)}</ol></div>
      <div className="row" style={{ gap: 10 }}><span className="xs m3" id="dgCount">第 {lastQ?.n ?? 1} 问 · 不限题数</span><button className="btn k sm" id="dgEnd" disabled={busy} onClick={finish}>结束并生成诊断</button></div>
    </div>
    <div className="msgs" id="dgMsgs">
      {g.msgs.map((m, i) => <div key={i} className={`msg ${m.who}`}>
        {m.who === 'ai' && <span className="aiav">哲</span>}
        <div className="dbub">{m.n && <span className="qn">第 {m.n} 问 · {STAGES[m.stage ?? 3]}</span>}<p>{m.text}</p></div>
      </div>)}
      {typing && <div className="msg ai"><span className="aiav">哲</span><div className="dbub dots"><i /><i /><i /></div></div>}
      {busy && !typing && answers >= 3 && <div className="msg ai"><span className="aiav">哲</span><div className="dbub"><p>好，我在整理你的标签和栏目…</p></div></div>}
      <div ref={end} />
    </div>
    <div className="chatin">
      <textarea className="fld" id="dgInput" rows={2} value={text} disabled={busy} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text); } }} placeholder="直接回答，想到什么说什么——打字，或者按右边的麦克风说" />
      <button className={`mic${rec ? ' on' : ''}`} aria-label="语音输入" onClick={mic}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg></button>
      <button className="btn k" id="dgSend" disabled={busy || !text.trim()} onClick={() => send(text)}>发送</button>
    </div>
    <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
      <button className="lnk xs" id="dgDemo" disabled={busy} onClick={demo}>一键演示 · {DEMO_NAME}</button>
      <span className="xs m3">回答随时存着，关掉页面下次接着聊</span>
    </div>
  </div>;
}

/* ---------- 结果：三类标签 + 四档栏目 ---------- */
const TAGN: [keyof DiagResult['tags'], string][] = [['personal', '个性标签'], ['pro', '专业标签'], ['brand', '品牌标签']];
function ResultView({ r, edit }: { r: DiagResult; edit?: (r: DiagResult) => void }) {
  const [adding, setAdding] = useState<string | null>(null);
  const [val, setVal] = useState('');
  return <div className="result" id="dgResult">
    <h1 className="d2" style={{ marginTop: 22 }}>{r.who} · 诊断结果</h1>
    <div className="tagcols">{TAGN.map(([k, n]) => <div key={k} className={`tagcol t-${k}`}>
      <p className="lb">{n}</p>
      <div className="tagwrap">{r.tags[k].map(t => <span key={t} className="dtag">{t}{edit && <button aria-label={`去掉 ${t}`} onClick={() => edit({ ...r, tags: { ...r.tags, [k]: r.tags[k].filter(x => x !== t) } })}>×</button>}</span>)}
        {edit && (adding === k ? <input className="fld sm" autoFocus value={val} onChange={e => setVal(e.target.value)} onBlur={() => { if (val.trim()) edit({ ...r, tags: { ...r.tags, [k]: [...r.tags[k], val.trim()] } }); setAdding(null); setVal(''); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} placeholder="加一个" style={{ width: 120 }} />
          : <button className="dtag add" onClick={() => setAdding(k)}>＋</button>)}</div>
    </div>)}</div>
    <p className="lb" style={{ marginTop: 26 }}>四档栏目</p>
    <div className="cols4">{r.columns.map((c, i) => <div key={i} className="colc" data-col={i}>
      <span className="colno">{i + 1}</span>
      {edit ? <input className="fld colname" value={c.n} aria-label="栏目名" onChange={e => edit({ ...r, columns: r.columns.map((x, j) => j === i ? { ...x, n: e.target.value } : x) })} /> : <b className="t2">{c.n}</b>}
      <p className="s m">{c.d}</p>
      <dl>
        <dt>示例选题</dt><dd>「{c.eg}」</dd>
        <dt>建议频率</dt><dd>{edit ? <select className="fld sm" value={c.freq} onChange={e => edit({ ...r, columns: r.columns.map((x, j) => j === i ? { ...x, freq: Number(e.target.value) } : x) })}>{[1, 2, 3].map(n => <option key={n} value={n}>每周 {n} 条</option>)}</select> : `每周 ${c.freq} 条`}</dd>
        <dt>来源标签</dt><dd>{c.src}</dd>
        <dt>常用片型</dt><dd>{vtype(c.type).n}</dd>
      </dl>
    </div>)}</div>
  </div>;
}

function Result({ r, g, setG }: { r: DiagResult; g: DiagState; setG: (p: Partial<DiagState>) => Promise<void> }) {
  const { sheet } = useApp();
  void g;
  const again = () => sheet({
    title: '重新聊一次？', body: <p className="s">这次的回答和结果会清掉，从第 1 问重新开始。已经进了发布计划的选题不受影响。</p>,
    foot: <><button className="btn g" onClick={() => sheet(null)}>算了</button><button className="btn k" id="dgAgainOk" onClick={() => { sheet(null); void setG({ msgs: [], asked: 0, result: null, counts: null, topics: null, round: 1, saved: false }); }}>重新聊</button></>,
  });
  return <>
    <ResultView r={r} edit={x => void setG({ result: x })} />
    <p className="xs m3" style={{ marginTop: 12 }}>标签和栏目都能直接改：点 × 去掉、点 ＋ 加，栏目名和频率也能改。</p>
    <div className="stfoot">
      <button className="btn g" id="dgAgain" onClick={again}>重新聊一次</button>
      <button className="btn k" id="dgNext" onClick={() => void setG({ round: 2, counts: r.columns.map(() => 0), topics: null })}>栏目就这样，接着排选题 →</button>
    </div>
  </>;
}

/* ---------- 第二轮：每档能拍几套 → 约 15 条选题 ---------- */
function Round2({ g, setG }: { g: DiagState; setG: (p: Partial<DiagState>) => Promise<void> }) {
  const { nav, toast, session } = useApp();
  const { st, save } = useStudio();
  const r = g.result!;
  const counts = g.counts ?? r.columns.map(() => 0);
  const cur = counts.findIndex(c => !c);
  const setCount = (i: number, n: number) => { const c = counts.map((x, j) => j === i ? n : x); void setG({ counts: c, topics: c.every(Boolean) ? makeTopics(r.columns, c) : null }); };
  const saveAll = () => {
    const acc = st!.plan[0]?.account ?? ACCOUNTS[0];
    const items = schedule(g.topics!, session!.today, acc);
    void save({ plan: [...st!.plan.filter(x => x.from !== 'diag' || x.status !== '待确认'), ...items], diag: { ...g, saved: true } });
    toast(`${items.length} 条选题进了发布计划，状态「待确认」`);
    nav('sched');
  };
  return <div className="r2" id="dgRound2">
    <button className="lnk s" style={{ marginTop: 26 }} onClick={() => void setG({ round: 1 })}>← 回到诊断结果</button>
    <h1 className="d2" style={{ marginTop: 10 }}>再问几个数，<em>把选题排出来</em></h1>
    <p className="s m" style={{ marginTop: 8 }}>栏目定了。按一周 3 条，我需要知道每档手上有多少能拍的，大概能排出 15 条选题。</p>
    <div className="msgs r2q">
      {r.columns.map((c, i) => (i <= cur || cur === -1) && <div key={i}>
        <div className="msg ai"><span className="aiav">哲</span><div className="dbub"><span className="qn">栏目 {i + 1} · {c.n}</span><p>{c.ask}</p></div></div>
        {counts[i] ? <div className="msg me"><div className="dbub"><p>{counts[i] >= 5 ? `5 ${c.unit}以上` : `${counts[i]} ${c.unit}`}</p></div><button className="lnk xs" onClick={() => setCount(i, 0)}>改</button></div>
          : <div className="nums" data-ask={i}>{[1, 2, 3, 4, 5].map(n => <button key={n} className="pill" onClick={() => setCount(i, n)}>{n === 5 ? `5${c.unit}+` : `${n} ${c.unit}`}</button>)}</div>}
      </div>)}
    </div>
    {g.topics && <>
      <p className="lb" style={{ marginTop: 26 }}>排出 {g.topics.length} 条选题 · 一周 3 条，排 {Math.ceil(g.topics.length / 3)} 周</p>
      <ol className="toplist" id="dgTopics">{g.topics.map((t, i) => <li key={i}><b>{t.title}</b><span className="xs m3">{t.column} · {vtype(t.type).n} · {t.why}</span></li>)}</ol>
      <p className="note">保存后：四档栏目会进入「安排发布计划」，每档的选题每周自动生成；写文案、出片都会按这套标签来。这些随时可以改。</p>
      <div className="stfoot">
        <button className="btn g" onClick={() => void setG({ round: 1 })}>改栏目</button>
        <button className="btn k" id="dgSave" onClick={saveAll}>保存，进入发布计划 →</button>
      </div>
    </>}
    {g.saved && <p className="xs m3" style={{ marginTop: 10 }}>已经保存过一次，再保存会替换还没确认的诊断选题。</p>}
  </div>;
}
