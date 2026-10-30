// 新手引导（首次进入）：先选做哪一行，再填 3 个空（名字、客户、希望观众做什么）和平台 → 声音和形象（可跳过）。
// 输入框只给例子，不预填演示账号的内容（以前预填「林设计师」，用户一点保存就成了别人的档案）。
// 栏目不在这里问：交给 AI 面诊来定。点 × 关掉也算看过，不会每次进来都弹。
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../store.tsx';
import { Pills } from './kit.tsx';
import { useMods } from './mods.tsx';
import type { PersonaId } from '../../shared/types.ts';

const PLATFORMS = ['抖音', '小红书', '视频号', 'B 站'];
const key = (ws: string) => `findai.onboarded.${ws}`;
const mark = (...ids: string[]) => { try { ids.forEach(id => localStorage.setItem(key(id), '1')); } catch { /* 忽略 */ } };

export function useOnboarding() {
  const { session, sheet } = useApp();
  useEffect(() => {
    if (!session || navigator.webdriver) return;
    try { if (localStorage.getItem(key(session.workspace.id))) return; } catch { return; }
    const ws = session.workspace.id;
    sheet({ title: '先认识一下你', body: <Profile />, onClose: () => mark(ws) });
  }, [session?.workspace.id]); // eslint-disable-line react-hooks/exhaustive-deps
}

const EX: Record<string, { who: string; aud: string; goal: string }> = {
  designer: { who: '林设计师 · 青岛室内设计', aud: '准备装修的新房业主、二手房翻新家庭', goal: '私信发户型图' },
  deco: { who: '老周装饰 · 成都整装', aud: '准备装修的业主、老房翻新家庭', goal: '私信预约免费量房' },
  custom: { who: '阿杰木作 · 佛山高定木作', aud: '佛山、广州准备装修大平层和别墅的业主', goal: '私信预约看展厅' },
  material: { who: '石材老陈 · 云浮岩板', aud: '装修业主、设计师', goal: '私信要样板' },
  soft: { who: '小林软装 · 杭州', aud: '刚交房的业主', goal: '私信发户型和预算' },
  agent: { who: '王经理 · 深圳二手房', aud: '准备买房、换房的家庭', goal: '私信约看房' },
  dev: { who: '某某府 · 售楼处', aud: '本地改善型买房人', goal: '预约到访' },
  stay: { who: '山间民宿 · 莫干山', aud: '周末出游的家庭和情侣', goal: '私信订房' },
};

function Profile() {
  const { session, sheet, nav, fail, setSession, toast, bump } = useApp();
  const mods = useMods();
  const s0 = session!, p = s0.workspace.positioning;
  // 填过才回显；新账号全部留空，只给例子
  const filled = !!p.name;
  const [persona, setPersona] = useState<PersonaId>(s0.workspace.persona);
  const [who, setWho] = useState(filled ? p.name : '');
  const [aud, setAud] = useState(filled ? p.aud.join('、') : '');
  const [goal, setGoal] = useState(filled ? p.goal ?? '' : '');
  const [plat, setPlat] = useState<string[]>(p.platforms ?? ['抖音']);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const ex = EX[persona] ?? EX.designer;
  const split = (s: string) => s.split(/[、,，\s]+/).map(x => x.trim()).filter(Boolean);
  const done = () => mark(s0.workspace.id, session!.workspace.id);
  if (step === 2) return <>
    <p className="s">文案和分镜会自动用上这份档案。接下来两件事能让视频更像你，都可以以后再做：</p>
    <div className="list" style={{ marginTop: 14 }}>
      {mods.on('voiceClone') && <button onClick={() => { done(); sheet(null); nav({ view: 'me', sub: 'avatar' }); }}><span>录 30 秒声音<br /><span className="xs m3">复刻后配音就是你自己的声音</span></span><span className="v">去录 ›</span></button>}
      {mods.on('avatars') && <button onClick={() => { done(); sheet(null); nav({ view: 'me', sub: 'avatar' }); }}><span>拍 1 分钟正脸视频<br /><span className="xs m3">建真人分身，口播视频由它出镜</span></span><span className="v">去拍 ›</span></button>}
    </div>
    <div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}><button className="btn y" id="onbLater" onClick={() => { done(); sheet(null); }}>以后再说，先去出片</button></div>
  </>;
  const save = async () => {
    setBusy(true);
    try {
      // 换了行业：先切到这个行业的工作区，档案存到新的工作区里
      let s = session!;
      // 先记下新工作区「看过引导」，再换会话，免得引导在新工作区又弹一次
      if (persona !== s.workspace.persona) { s = await api.switchPersona(persona); mark(s.workspace.id); setSession(s); }
      const cur = s.workspace.positioning;
      s = await api.savePositioning({ ...cur, name: who.trim().slice(0, 40), aud: split(aud).slice(0, 6).length ? split(aud).slice(0, 6) : cur.aud, goal: goal.trim().slice(0, 40), platforms: plat });
      setSession(s); mark(s0.workspace.id, s.workspace.id); bump(); toast('人设档案存好了');
      if (mods.any('voiceClone', 'avatars')) setStep(2); else { sheet(null); nav('home'); }
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return <>
    <p className="s m" style={{ marginBottom: 12 }}>4 个问题，填一次，之后每条视频的文案都会用上。栏目不用想，AI 面诊会帮你定。</p>
    <p className="lb">1. 你做哪一行</p>
    <div className="pills" id="onbPersona">{s0.personas.map(x => <button key={x.id} className="pill" aria-pressed={persona === x.id} onClick={() => setPersona(x.id)}>{x.n}</button>)}</div>
    <label className="lb" htmlFor="onbWho" style={{ marginTop: 14 }}>2. 账号名或身份</label><input className="fld" id="onbWho" value={who} onChange={e => setWho(e.target.value)} placeholder={`比如：${ex.who}`} />
    <label className="lb" htmlFor="onbAud" style={{ marginTop: 12 }}>3. 你的客户是谁</label><input className="fld" id="onbAud" value={aud} onChange={e => setAud(e.target.value)} placeholder={`比如：${ex.aud}`} />
    <label className="lb" htmlFor="onbGoal" style={{ marginTop: 12 }}>4. 希望观众看完做什么</label><input className="fld" id="onbGoal" value={goal} onChange={e => setGoal(e.target.value)} placeholder={`比如：${ex.goal}`} />
    <p className="lb" style={{ marginTop: 12 }}>发哪些平台</p><Pills value={plat} options={PLATFORMS} onChange={v => setPlat(x => x.includes(v) ? x.filter(y => y !== v) : [...x, v])} />
    <div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}>
      <button className="btn g" onClick={() => { done(); sheet(null); }}>先跳过</button>
      <button className="btn y" id="onbSave" disabled={busy || !who.trim()} onClick={save}>{busy ? '保存中…' : '保存'}</button>
    </div>
  </>;
}
