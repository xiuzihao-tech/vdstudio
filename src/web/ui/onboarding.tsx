// 新手引导（首次进入）：人设档案 5 问 → 声音和形象（可跳过）。说话风格不再让用户选，由 AI 从录音和已发文案里判断。
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../store.tsx';
import { Pills } from './kit.tsx';

const PLATFORMS = ['抖音', '小红书', '视频号', 'B 站'];
const key = (ws: string) => `findai.onboarded.${ws}`;

export function useOnboarding() {
  const { session, sheet } = useApp();
  useEffect(() => {
    if (!session || navigator.webdriver) return;
    try { if (localStorage.getItem(key(session.workspace.id))) return; } catch { return; }
    sheet({ title: '先认识一下你', body: <Profile /> });
  }, [session?.workspace.id]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Profile() {
  const { session, sheet, nav, fail, setSession, toast } = useApp();
  const p = session!.workspace.positioning;
  const [who, setWho] = useState(p.name);
  const [aud, setAud] = useState(p.aud.join('、'));
  const [pillars, setPillars] = useState(p.pillars.slice(0, 3).join('、'));
  const [goal, setGoal] = useState(p.goal ?? session!.persona.goal);
  const [plat, setPlat] = useState<string[]>(p.platforms ?? ['抖音']);
  const [step, setStep] = useState(1);
  const done = () => { try { localStorage.setItem(key(session!.workspace.id), '1'); } catch { /* 忽略 */ } };
  const split = (s: string) => s.split(/[、,，\s]+/).map(x => x.trim()).filter(Boolean);
  if (step === 2) return <>
    <p className="s">文案和分镜会自动用上这份档案。接下来两件事能让视频更像你，都可以以后再做：</p>
    <div className="list" style={{ marginTop: 14 }}>
      <button onClick={() => { done(); sheet(null); nav('me'); }}><span>录 30 秒声音<br /><span className="xs m3">复刻后配音就是你自己的声音</span></span><span className="v">去录 ›</span></button>
      <button onClick={() => { done(); sheet(null); nav('me'); }}><span>拍 1 分钟正脸视频<br /><span className="xs m3">建真人分身，口播视频由它出镜</span></span><span className="v">去拍 ›</span></button>
    </div>
    <div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}><button className="btn y" id="onbLater" onClick={() => { done(); sheet(null); }}>以后再说，先去出片</button></div>
  </>;
  return <>
    <p className="s m" style={{ marginBottom: 12 }}>5 个问题，写一次，之后每条视频的文案和画面都会用上。</p>
    <label className="lb" htmlFor="onbWho">1. 你是谁（账号名或身份）</label><input className="fld" id="onbWho" value={who} onChange={e => setWho(e.target.value)} />
    <label className="lb" htmlFor="onbAud" style={{ marginTop: 12 }}>2. 你的内容给谁看</label><input className="fld" id="onbAud" value={aud} onChange={e => setAud(e.target.value)} placeholder="用顿号隔开" />
    <label className="lb" htmlFor="onbPil" style={{ marginTop: 12 }}>3. 常讲的 3 个栏目</label><input className="fld" id="onbPil" value={pillars} onChange={e => setPillars(e.target.value)} placeholder="比如：完工案例、避坑科普、工地日记" />
    <label className="lb" htmlFor="onbGoal" style={{ marginTop: 12 }}>4. 希望观众做什么</label><input className="fld" id="onbGoal" value={goal} onChange={e => setGoal(e.target.value)} placeholder="比如：私信发户型图" />
    <p className="lb" style={{ marginTop: 12 }}>5. 发哪些平台</p><Pills value={plat} options={PLATFORMS} onChange={v => setPlat(x => x.includes(v) ? x.filter(y => y !== v) : [...x, v])} />
    <div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}>
      <button className="btn g" onClick={() => { done(); sheet(null); }}>跳过</button>
      <button className="btn y" id="onbSave" disabled={!who.trim() || !split(aud).length} onClick={async () => {
        try {
          const s = await api.savePositioning({ ...p, name: who.trim().slice(0, 40), aud: split(aud).slice(0, 6), pillars: split(pillars).slice(0, 8), goal: goal.trim().slice(0, 40), platforms: plat });
          setSession(s); toast('人设档案存好了'); setStep(2);
        } catch (e) { fail(e); }
      }}>保存</button>
    </div>
  </>;
}
