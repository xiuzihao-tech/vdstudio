// 创作首页：一句话 + 素材 → 3 个选题方向 → 写文案；下方是三步流程入口和排期节奏条。
import { useState } from 'react';
import { api } from '../api.ts';
import { useApp, useData } from '../store.tsx';
import { Ph, Skel, Steps } from '../ui/kit.tsx';
import { useAssetPicker } from '../ui/pickers.tsx';
import { TopicCard } from './ip/Find.tsx';
import { SLOT_LABEL } from '../../shared/schedule.ts';
import type { Asset, Topic } from '../../shared/types.ts';

export function Home() {
  const { session, nav, fail, setMatSeed } = useApp();
  const pick = useAssetPicker();
  const [text, setText] = useState('');
  const [att, setAtt] = useState<Asset[]>([]);
  const [ideas, setIdeas] = useState<Topic[] | null>(null);
  const [busy, setBusy] = useState(false);
  const plans = useData(() => api.plans(), []);
  const assets = useData(() => api.assets(), []);
  const p = session!.persona;
  const shown = att.length ? att : (assets.data?.assets.filter(a => a.type !== '人物').slice(0, 4) ?? []);

  const go = async () => {
    setBusy(true); setIdeas(null);
    try { const r = await api.fromCase(text, shown.map(a => a.k)); setIdeas(r.topics); setMatSeed(shown.map(a => a.id)); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const strip = plans.data?.plans[0]?.slots.filter(s => !('empty' in s)).slice(0, 6) ?? [];

  return <section className="view on" id="v-home"><div className="vb">
    <div className="hero">
      <h1 className="d1 rise">一句话，<em>出一条片。</em></h1>
      <p className="sub rise d2x">放进素材，说清楚想发什么。选题和文案交给大哲 IP，出片交给简易生成；哪一镜不满意，再去制作台只改那一镜。</p>
      <div className="comp rise d3x">
        <div className="att" id="att">
          {shown.map(a => <button key={a.id} className="th" title="点一下移除" onClick={() => setAtt(shown.filter(x => x.id !== a.id))}><Ph k={a.k} asset={a} /></button>)}
          <button className="add" aria-label="添加素材" onClick={() => pick(l => setAtt([...shown, ...l.filter(a => !shown.some(s => s.id === a.id))]))}>+</button>
        </div>
        <label className="sr" htmlFor="ask">想做一条什么样的视频</label>
        <textarea id="ask" rows={2} value={text} onChange={e => setText(e.target.value)} placeholder={p.ph} />
        <div className="bar"><span style={{ flex: 1 }} /><span className="modehint">{shown.length} 份素材 · {session!.workspace.positioning.name}</span>
          <button className="go" id="goBtn" aria-label="出 3 个选题" disabled={busy} onClick={go}><svg><use href="#i-up" /></svg></button></div>
      </div>
      <p className="hint">不写也行。直接点黄色按钮，AI 先看素材，再给你 3 个方向。</p>
      <Steps cur="find" />
      {(busy || ideas) && <div className="ideas" id="ideas" aria-live="polite">
        <div className="row" style={{ marginTop: 22, alignItems: 'flex-end' }}><h2 className="t1" style={{ flex: 1 }}>选一个方向</h2>{ideas && <button className="lnk s" onClick={go}>换一批</button>}</div>
        <div className="hot" id="topics">{busy ? [0, 1, 2].map(i => <div key={i} className="hc"><Skel w="60%" /><Skel h={22} /></div>) : ideas!.map(t => <TopicCard key={t.id} t={t} onChange={() => { }} />)}</div>
      </div>}
    </div>

    <div className="sec wrap">
      <h2 className="d2">三步出片</h2>
      <p className="sub" style={{ margin: '8px 0 26px' }}>先定选题，再写文案，最后一键生成。玩得溜的，再去制作台逐镜调。</p>
      <div className="entries">
        {([['ip', '1', '选题文案', '大哲 IP 选题库、对标拆解、文案检查'], ['gen', '2', '生成视频', '选模型、时长、声音，直接出片'], ['plan', '3', '排期发布', 'AI 预选未来两周的选题，你来审核']] as const).map(([v, n, t, d]) => (
          <button key={v} className="entry" onClick={() => nav(v)}><span className="n">{n}</span><span><span className="t2" style={{ display: 'block' }}>{t}</span><span className="s m" style={{ display: 'block', marginTop: 4 }}>{d}</span></span></button>))}
      </div>
    </div>

    <div className="sec wrap" style={{ paddingBottom: 20 }}>
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 22 }}><div style={{ flex: 1 }}><h2 className="d2">定好节奏，它按时备片。</h2><p className="sub" style={{ marginTop: 8 }}>说一次每周几条、几点发。AI 先把选题排好，等你点头。</p></div><button className="btn y" onClick={() => nav('plan')}>打开排期</button></div>
      <div className="strip" id="homeStrip">{strip.map(s => 'empty' in s ? null : <button key={s.date} className={`slotc${s.date === session!.today ? ' today' : ''}`} onClick={() => nav('plan')}><Ph k={s.topic.k} /><div className="b"><p className="dt">{s.weekday} {s.label}{s.date === session!.today ? ' · 今天' : ''}</p><p className="t2" style={{ marginTop: 4, fontSize: 14.5 }}>{s.topic.title}</p><p className="xs" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}><i className={`dot ${s.state}`} />{SLOT_LABEL[s.state]}</p></div></button>)}</div>
    </div>
  </div></section>;
}
