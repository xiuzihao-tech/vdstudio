// 封面图文、常用创作工具、实战课堂、我的资产。
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { useApp, useData } from '../../store.tsx';
import { Ph, Skel, Src, pickFiles, usePay } from '../../ui/kit.tsx';
import { useScheduleTopic } from '../../ui/pickers.tsx';
import { COURSES } from '../../../shared/catalog.ts';
import { copyText, secs } from '../../../shared/copy.ts';

/* ================= 封面 ================= */
const COVS: [string, string][] = [['y', '黄底大字'], ['big', '实景大字'], ['ba', '前后对比'], ['list', '清单式']];
export function Cover({ topicId }: { topicId?: string }) {
  const { session, fail, toast, setSession } = useApp();
  const pay = usePay();
  const init = useData(async () => topicId ? (await api.draft(topicId)).draft?.title ?? '' : '', [topicId]);
  const [title, setTitle] = useState<string | null>(null);
  const [style, setStyle] = useState(0);
  const tx = title ?? (init.data || session!.persona.topics[0][0]);
  const k = session!.persona.att[0];
  const save = async (generate: boolean) => {
    try { const r = await api.addCover(tx, COVS[style][1], generate); setSession({ ...session!, workspace: { ...session!.workspace, balance: r.balance } }); toast(generate ? '封面和 6 张配图好了，在“我的资产 · 封面资产”' : '已存到封面资产'); } catch (e) { fail(e); }
  };
  return <>
    <div className="row" style={{ marginTop: 26, alignItems: 'flex-end' }}><div style={{ flex: 1 }}><h2 className="t1">封面火力库</h2><p className="s m" style={{ marginTop: 4 }}>标题放上封面，选一个样式。小红书图文同时出 6 张配图。</p></div></div>
    <div className="paste" style={{ marginTop: 16 }}><label className="sr" htmlFor="covIn">封面标题</label><input id="covIn" value={tx} maxLength={40} onChange={e => setTitle(e.target.value)} placeholder="封面上的大字，一般 6–14 个字" /></div>
    <div className="covs" role="group" aria-label="封面样式">{COVS.map(([c, n], i) => (
      <button key={c} className={`cov ${c}`} aria-pressed={style === i} onClick={() => setStyle(i)}>
        {c === 'ba' ? <><Ph k="old" /><Ph k={k} /></> : <Ph k={k} />}<span className="ct">{tx}</span>
        {c === 'list' && <ol><li>先看动线</li><li>再定尺寸</li><li>最后挑材质</li></ol>}<em>{n}</em>
      </button>))}</div>
    <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
      <span className="xs m3" style={{ flex: 1 }}>封面为示意，正式版按真实素材出图。</span>
      <button className="btn g" onClick={() => save(false)}>存到封面资产</button>
      <button className="btn y" onClick={() => pay({ title: '封面 + 6 张配图', lines: [[`封面 · ${COVS[style][1]}`, 4], ['小红书配图 6 张', 8]], ok: '生成', then: () => save(true) })}>生成封面 + 6 张配图 · 12 点</button>
    </div>
  </>;
}

/* ================= 工具 ================= */
const TOOLS: [string, string, string, string][] = [['clone', '🎙', '声音克隆', '克隆你的音色，配音时直接选“本人声音”'], ['a2c', '🎧', '音频转文案', '把录音里的话转成文字'], ['v2c', '🎬', '视频提文案', '提取视频里的口播文案'], ['ban', '🚫', '违禁词检测', '查出广告法风险词，给替换建议'], ['live', '💬', '活人感优化', '把稿子改得更像人话'], ['viral', '🔍', '爆款短视频拆解', '拆开头、结构、表达和节奏']];
export function Tools() {
  const { session, sheet } = useApp();
  const clone = useCloneVoice();
  const vc = session!.workspace.voiceClone;
  return <>
    <p className="s m" style={{ marginTop: 26 }}>从素材提取到文案优化，把常用工具放在手边。处理结果可以直接送去写文案或生成视频。</p>
    <div className="tools6">{TOOLS.map(([k, ic, n, d]) => (
      <button key={k} className="tool" data-tool={k} onClick={() => k === 'clone' ? clone() : sheet({ title: n, body: <ToolBody k={k} /> })}>
        <span className="ic" aria-hidden="true">{ic}</span>
        <span><span className="t2" style={{ display: 'block' }}>{n}</span><span className="s m" style={{ display: 'block', marginTop: 4 }}>{d}</span>
          {k === 'clone' && <span style={{ display: 'block', marginTop: 8 }}>{vc === 'ready' ? <Src k="real">已克隆</Src> : vc === 'busy' ? <Src k="gen">克隆中</Src> : <Src>未克隆</Src>}</span>}</span>
      </button>))}</div>
  </>;
}

function ToolBody({ k }: { k: string }) {
  const { fail, nav, sheet, setGenSeed, session } = useApp();
  const [text, setText] = useState(k === 'ban' || k === 'live' ? '这是全网最好的收纳方案，保证十年不变形，零甲醛，业主的首选。' : '');
  const [hits, setHits] = useState<[string, string][] | null>(null);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const run = async () => {
    setBusy(true);
    try {
      if (k === 'ban') setHits((await api.banned(text)).hits);
      if (k === 'live') { setText((await api.humanize(text)).text); setDone('已改成更口语的说法，原文意思不变。'); }
      if (k === 'a2c' || k === 'v2c') setText((await api.transcribe(k === 'a2c' ? 'audio' : 'video', ref || '示例')).text);
      if (k === 'viral') { sheet(null); nav({ view: 'ip', sub: 'find' }); }
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const toCopy = async () => {
    try { const t = await api.addTopic({ title: `${k === 'v2c' ? '复用口播' : '录音整理'}：${session!.persona.focus.split('，')[0]}`, hook: text.split('。')[0], source: 'tool', why: k === 'v2c' ? '视频提文案' : '音频转文案' }); sheet(null); nav({ view: 'ip', sub: 'copy', id: t.id }); } catch (e) { fail(e); }
  };
  if (k === 'viral') return <><p className="s">爆款拆解在“找选题 → 我有对标”里，贴链接就能拆，拆完可以直接复刻成你的选题。</p><div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}><button className="btn y" onClick={run}>去拆解</button></div></>;
  return <>
    {(k === 'a2c' || k === 'v2c') && !text && <>
      {k === 'v2c' ? <><label className="lb" htmlFor="tIn">视频链接</label><input className="fld" id="tIn" value={ref} onChange={e => setRef(e.target.value)} placeholder="粘贴分享链接" /></>
        : <button className="pill" onClick={async () => { const f = await pickFiles('audio/*', false); if (f[0]) setRef(f[0].name); }}>{ref ? `已选择：${ref}` : '选择音频文件（mp3、m4a、wav）'}</button>}
    </>}
    {(text || k === 'ban' || k === 'live') && <><label className="lb" htmlFor="tTx">{k === 'ban' || k === 'live' ? '贴一段文案' : '识别结果（可修改）'}</label><textarea className="fld" id="tTx" rows={6} value={text} onChange={e => { setText(e.target.value); setHits(null); setDone(''); }} /></>}
    {hits && (hits.length ? <div className="list" style={{ marginTop: 12 }}>{hits.map(([w, r]) => <div key={w} className="bad" style={{ padding: '10px 14px' }}><span><mark>{w}</mark> → {r}</span></div>)}</div> : <p className="s" style={{ color: 'var(--real)', marginTop: 12 }}>没查到违禁词。</p>)}
    {done && <p className="s" style={{ color: 'var(--real)', marginTop: 12 }}>{done}</p>}
    <div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}>
      {hits && hits.length > 0 && <button className="btn g" id="tFix" onClick={() => { let t = text; hits.forEach(([w, r]) => { t = t.split(w).join(r); }); setText(t); setHits([]); }}>一键替换</button>}
      {(k === 'a2c' || k === 'v2c') && text && <><button className="btn g" onClick={toCopy}>送去写文案</button><button className="btn g" onClick={() => { setGenSeed({ copy: text.replace(/。/g, '。\n').trim(), title: '口播整理' }); nav('gen'); }}>直接生成视频</button></>}
      {!((k === 'a2c' || k === 'v2c') && text) && <button className="btn y" id="tGo" disabled={busy} onClick={run}>{busy ? '处理中…' : k === 'ban' ? '检测' : k === 'live' ? '优化' : k === 'v2c' ? '提取' : '转文字'}</button>}
    </div>
  </>;
}

/** 声音克隆：浏览器能录音就录 30 秒，不能就上传文件。必须勾选本人授权。 */
export function useCloneVoice() {
  const { sheet } = useApp();
  return () => sheet({ title: '声音克隆', body: <CloneBody /> });
}
function CloneBody() {
  const { session, sheet, toast, fail, reloadSession } = useApp();
  const [sec, setSec] = useState(0);
  const [rec, setRec] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [demo, setDemo] = useState(false);
  const [ok, setOk] = useState(false);
  const mr = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>();
  useEffect(() => () => { clearInterval(timer.current); mr.current?.stream.getTracks().forEach(t => t.stop()); }, []);
  const start = async () => {
    setBlob(null); setSec(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = []; const m = new MediaRecorder(stream); mr.current = m;
      m.ondataavailable = e => chunks.push(e.data);
      m.onstop = () => { setBlob(new Blob(chunks, { type: m.mimeType || 'audio/webm' })); stream.getTracks().forEach(t => t.stop()); };
      m.start(); setRec(true); setDemo(false);
      timer.current = setInterval(() => setSec(s => { if (s + 1 >= 30) { stop(); return 30; } return s + 1; }), 1000);
    } catch {
      // 没有麦克风（或预览环境）：用一段演示样本，便于走通流程
      setDemo(true); setRec(true);
      timer.current = setInterval(() => setSec(s => { if (s + 3 >= 30) { clearInterval(timer.current); setRec(false); setBlob(new Blob([new Uint8Array(2000)], { type: 'audio/webm' })); toast('没检测到麦克风，用演示样本代替'); return 30; } return s + 3; }), 150);
    }
  };
  const stop = () => { clearInterval(timer.current); mr.current?.state === 'recording' && mr.current.stop(); setRec(false); };
  const upload = async () => { const f = await pickFiles('audio/*', false); if (f[0]) { setBlob(f[0]); setSec(30); setDemo(false); } };
  const go = async () => {
    try { await api.cloneVoice(blob!, demo); sheet(null); toast('正在克隆，大约 1 分钟'); await reloadSession(); const h = setInterval(async () => { await reloadSession(); }, 1500); setTimeout(() => clearInterval(h), 8000); } catch (e) { fail(e); }
  };
  const vc = session!.workspace.voiceClone;
  return <>
    {vc === 'ready' && <div className="list" style={{ marginBottom: 16 }}><div><span>本人声音</span><Src k="real">已克隆 · 可用</Src></div></div>}
    <p className="lb">照着读这段（约 30 秒）</p>
    <div style={{ background: 'var(--pn2)', borderRadius: 'var(--r1)', padding: '12px 14px', fontSize: 15, lineHeight: 1.6 }}>大家好，我是{session!.workspace.positioning.name}。做这行这些年，我最想说的就是：先想清楚怎么住，再决定怎么做。今天带你看一个真实的项目。</div>
    <div className="rec" style={{ marginTop: 14 }}>
      <button className="recb" id="recB" aria-pressed={rec} onClick={rec ? stop : start}>{rec ? '停止' : blob ? '重录' : '录音'}</button>
      <div className="bar2"><i style={{ width: `${(sec / 30) * 100}%` }} /></div><span className="xs m ro">0:{String(sec).padStart(2, '0')}</span>
    </div>
    <button className="lnk xs" style={{ marginTop: 8 }} onClick={upload}>或者上传一段 30 秒以上的口播</button>
    <label className="row s" style={{ gap: 8, marginTop: 14, alignItems: 'flex-start', flexWrap: 'nowrap' }}><input type="checkbox" id="recOk" checked={ok} onChange={e => setOk(e.target.checked)} style={{ marginTop: 4 }} /><span>我确认这是我本人的声音，同意用于生成配音。克隆他人声音需要对方本人授权。</span></label>
    <p className="note">克隆免费，配音按生成时长计费。</p>
    <div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}><button className="btn g" onClick={() => sheet(null)}>取消</button><button className="btn y" id="recGo" disabled={!blob || sec < 30 || !ok} onClick={go}>开始克隆</button></div>
  </>;
}

/* ================= 课堂 ================= */
export function Classroom() {
  const { toast } = useApp();
  const [cat, setCat] = useState('全部');
  return <>
    <div className="row" style={{ marginTop: 26, alignItems: 'flex-end' }}><div style={{ flex: 1 }}><h2 className="t1">大哲实战课堂</h2><p className="s m" style={{ marginTop: 4 }}>从真实案例里学，用到下一条内容里。</p></div></div>
    <div className="pills" style={{ marginTop: 14 }}>{['全部', '选题', '文案', '拍摄', '剪辑', 'IP 定位'].map(c => <button key={c} className="pill sm" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}</div>
    <div className="courses">{COURSES.filter(c => cat === '全部' || c[0] === cat).map(c => <button key={c[1]} className="course" onClick={() => toast(`课程播放（示意）：${c[1]}`)}><Ph k={c[3]} tag="demo" /><div className="b"><p className="xs m3">{c[0]} · {c[2]}</p><p className="t2" style={{ marginTop: 4 }}>{c[1]}</p></div></button>)}</div>
  </>;
}

/* ================= 我的资产 ================= */
export function Mine() {
  const { nav, setGenSeed, toast } = useApp();
  const schedule = useScheduleTopic();
  const [tab, setTab] = useState<'fav' | 'draft' | 'cov' | 'pub'>('fav');
  const d = useData(async () => { const [t, dr, c, p] = await Promise.all([api.allTopics(), api.drafts(), api.covers(), api.published()]); return { t, dr: dr.drafts, c: c.covers, p: p.items }; }, []);
  if (!d.data) return <Skel h={200} />;
  const fav = d.data.t.topics.filter(t => t.fav);
  const M = [['fav', '收藏选题', fav.length], ['draft', '草稿箱', d.data.dr.length], ['cov', '封面资产', d.data.c.length], ['pub', '已发布', d.data.p.length]] as const;
  const empty = { fav: '还没收藏选题。在选题卡片上点 ☆。', draft: '写过的文案会自动存在这里。', cov: '做好的封面会出现在这里。', pub: '排期里发出去的内容会出现在这里。' }[tab];
  const rows = tab === 'fav' ? fav.map(t => <div key={t.id}><span className="ttl"><p>{t.title}</p><span className="xs m3">{t.dir} · {d.data!.t.scheduled[t.id] ? `已排期 ${d.data!.t.scheduled[t.id]}` : '未排期'}</span></span><button className="btn g sm" onClick={() => schedule(t)}>排期</button><button className="btn k sm" onClick={() => nav({ view: 'ip', sub: 'copy', id: t.id })}>写文案</button></div>)
    : tab === 'draft' ? d.data.dr.map(c => <div key={c.id}><span className="ttl"><p>{c.title}</p><span className="xs m3">{c.kind} · {c.len} 秒 · 约 {secs(copyText(c))} 秒口播</span></span><button className="btn g sm" onClick={() => nav({ view: 'ip', sub: 'copy', id: c.topicId })}>继续改</button><button className="btn y sm" onClick={() => { setGenSeed({ copy: copyText(c), title: c.title, topicId: c.topicId, len: c.len, assetIds: c.assetIds }); nav('gen'); }}>生成视频</button></div>)
      : tab === 'cov' ? d.data.c.map(c => <div key={c.id}><span className="ttl"><p>{c.title}</p><span className="xs m3">{c.style}</span></span><button className="btn g sm" onClick={() => toast('已开始下载（示意）')}>下载</button></div>)
        : d.data.p.map((s, i) => <div key={i}><span className="ttl"><p>{s.title}</p><span className="xs m3">{s.account} · {s.date}</span></span><Src k="real">已发</Src></div>);
  return <>
    <div className="mine" role="group" aria-label="我的资产">{M.map(([k, n, c]) => <button key={k} data-v={k} aria-pressed={tab === k} onClick={() => setTab(k)}><b>{c}</b><span className="s m">{n}</span></button>)}</div>
    <div className="rows">{rows.length ? <div className="list">{rows}</div> : <p className="s m" style={{ textAlign: 'center', padding: '40px 0' }}>{empty}</p>}</div>
  </>;
}
