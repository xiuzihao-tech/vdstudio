// 外壳：顶栏导航、余额、人设切换、任务列表、主题；手机底栏。
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useApp, type View } from '../store.tsx';
import { Src } from './kit.tsx';
import { AuthForm } from './auth.tsx';
import { PointsSheet } from './points.tsx';
import type { Job } from '../../shared/types.ts';
import { SoonBadge, setAsStudent, useMods } from './mods.tsx';
import { DAZHEIP_URL } from '../config.ts';
import { useStudio } from '../pages/studio/common.tsx';
import { weekStats } from '../../shared/studio.ts';

// 导航：按模块开关排——某个区的模块全关了，入口就不出现。选题文案、制作台先隐藏（代码保留，选题和文案在 dazheip 做）
// 视频 IP 主线（苗苗原型）：大哲诊断账号 / 一键生成视频 / 管理我的素材 / 安排发布计划 / 查看作品数据。旧页面（今天、AI 运营、知识库与形象、口播数字人）代码保留，菜单里不出现
export const TAB_MODS: Record<string, string[]> = { make: ['real', 'talk', 'aiVideo'], diag: ['unlock', 'diag'], mat: ['assets', 'avatars', 'kb'], sched: ['plan'], data: ['works', 'review'], gen: ['real', 'talk', 'aiVideo'], talk: ['avatarStudio'], ops: ['unlock'], me: ['kb', 'voiceClone', 'avatars'], lib: ['works', 'assets'] };
/** dazheip 现有的菜单（原样保留，点了回主站）；「视频 IP」「口播数字人」插在「制作封面图文」后面 */
const DZ_BEFORE: [string, string, string][] = [['开始创作文案', '/', 'i-pen'], ['查找选题灵感', '/topics', 'i-target'], ['制作封面图文', '/covers', 'i-flame']];
const DZ_AFTER: [string, string, string][] = [['常用创作工具', '/tools', 'i-tool'], ['大哲实战课堂', '/classroom', 'i-cap'], ['家居IP资讯', '/news', 'i-news'], ['我的资产', '/assets', 'i-box']];
const TABS: [View, string, string][] = [['diag', '大哲诊断账号', '诊断'], ['make', '一键生成视频', '出片'], ['mat', '管理我的素材', '素材'], ['sched', '安排发布计划', '计划'], ['data', '查看作品数据', '数据']];
const ICON: Record<string, string> = { diag: 'i-diag', make: 'i-wb', mat: 'i-lib', sched: 'i-cal', data: 'i-chart' };
const THEMES: [string, string][] = [['dazhe', '大哲'], ['studio', '展厅'], ['cinema', '放映'], ['glass', '天光'], ['poster', '海报']];
const JST: Record<string, [string, string]> = { queued: ['', '排队'], running: ['gen', '生成中'], done: ['real', '完成'], failed: ['err', '失败'] };

export function Header() {
  const { session, route, nav, sheet, setSession, fail, toast, jobsVersion, bump, reloadSession } = useApp();
  const [jobs, setJobs] = useState<Job[]>([]);
  const running = jobs.filter(j => j.status === 'queued' || j.status === 'running').length;
  const mods = useMods();
  const tabs = TABS.filter(([v]) => mods.anyShown(...TAB_MODS[v]));
  const { st } = useStudio();
  const week = st && session ? weekStats(st.plan, session.today).total : 0;
  const locked = st && !st.diag.unlocked;
  const cur = (v: View) => route.view === v || (v === 'make' && route.view === 'home');
  const dzLink = ([n, path, ic]: [string, string, string]) => <a key={path} className="dzl" href={`${DAZHEIP_URL}${path}`} target={DAZHEIP_URL ? '_blank' : undefined} rel="noopener"><svg className="nav-ic" aria-hidden="true"><use href={`#${ic}`} /></svg>{n}{DAZHEIP_URL && <span className="ext" aria-label="在大哲 IP 主站打开">↗</span>}</a>;
  const tabBtn = ([v, n]: [View, string, string]) => <button key={v} data-go={v} aria-current={cur(v) ? 'page' : undefined} onClick={() => nav(v)}><svg className="nav-ic" aria-hidden="true"><use href={`#${ICON[v]}`} /></svg>{n}{v === 'make' && <span className="fire" aria-label="热门">🔥</span>}{v === 'diag' && locked && <svg className="lock" aria-label="付费解锁"><use href="#i-lock" /></svg>}{v === 'sched' && week > 0 && <span className="cnt">{week}</span>}{badge(v)}</button>;
  // 「生成视频」整区只是预告时，角标挂在第一个模块上
  const badge = (v: string) => mods.any(...TAB_MODS[v]) ? null : <SoonBadge id={TAB_MODS[v][0]} />;

  useEffect(() => {
    let live = true, h: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try { const r = await api.jobs(); if (live) setJobs(r.jobs); if (r.jobs.some(j => j.status === 'running' || j.status === 'queued')) h = setTimeout(tick, 1500); } catch { /* 静默 */ }
    };
    void tick();
    return () => { live = false; clearTimeout(h); };
  }, [jobsVersion, session?.workspace.id]);

  const whoSheet = () => sheet({
    title: '我是',
    body: <>
      <div className="list">{session!.personas.map(p => (
        <button key={p.id} data-pv={p.id} onClick={async () => {
          try { const s = await api.switchPersona(p.id); setSession(s); bump(); sheet(null); toast(`已切到「${p.n}」，选题、素材、排期都换成这个身份的`); } catch (e) { fail(e); }
        }}><span>{p.n}</span><span className="v">{p.id === session!.persona.id ? '当前' : '›'}</span></button>
      ))}</div>
      <p className="lb" style={{ marginTop: 18 }}>界面风格</p>
      <div className="pills">{THEMES.map(([k, n]) => <button key={k} className="pill sm" data-th={k} aria-pressed={session!.workspace.theme === k}
        onClick={async () => { document.body.dataset.theme = k; setSession({ ...session!, workspace: { ...session!.workspace, theme: k } }); await api.setTheme(k).catch(fail); }}>{n}</button>)}</div>
      <p className="note">每个身份是独立的工作区：文案、素材、运营计划、形象互不影响。</p>
      <p className="lb" style={{ marginTop: 18 }}>账号</p>
      {session!.user
        ? <div className="list"><div><span>{session!.user.name}<br /><span className="xs m3">{session!.user.email}</span></span><button className="btn g sm" id="logoutBtn" onClick={async () => { try { await api.logout(); sheet(null); await reloadSession(); bump(); toast('已退出'); } catch (e) { fail(e); } }}>退出</button></div></div>
        : <><p className="s m" style={{ marginBottom: 12 }}>还没登录，内容只存在这台设备的浏览器里。注册后换设备也能用。</p><AuthForm initial="register" onDone={() => sheet(null)} /></>}
    </>,
  });

  const jobsSheet = () => sheet({
    title: '任务',
    body: <>
      {jobs.length ? <div className="list">{jobs.map(j => (
        <div key={j.id} style={{ flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: '60%' }}>{j.kind === 'video_final' ? '成片' : '视频'} · {j.title}<br /><span className="xs m3">{j.cost} 点{j.status === 'running' ? ` · ${j.steps[Math.min(j.step, j.steps.length - 1)]}` : ''}{j.error ? ` · ${j.error}` : ''}</span></span>
          <Src k={JST[j.status][0]}>{JST[j.status][1]}</Src>
        </div>
      ))}</div> : <p className="s m">还没有任务。</p>}
      <p className="note">刷新或断网后任务还在这里。生成失败会自动退点。</p>
    </>,
    foot: <button className="btn g" onClick={() => { sheet(null); nav({ view: 'lib', sub: 'works' }); }}>看全部作品</button>,
  });

  return <>
    <header className="gbar">
      <div className="logo"><span>FIND AI</span><span className="x">×</span><span className="dz">大哲<br className="sub" />IP研究院</span><span className="sub">视频工作室 · FIND AI 联合出品</span></div>
      <p className="menu-lb">菜单 / MODULES</p>
      <div className="dzlinks">{DZ_BEFORE.map(dzLink)}</div>
      <nav className="tabs" aria-label="主导航">
        {tabs.map(tabBtn)}
        {session?.isAdmin && <button data-go="admin" aria-current={route.view === 'admin' ? 'page' : undefined} onClick={() => nav('admin')}>后台</button>}
        {session?.isAdmin && <button id="asStudent" className={mods.student ? 'on' : ''} title="管理员预览：和学员看到的一样" onClick={() => setAsStudent(!mods.student)}>{mods.student ? '按学员看 ✓' : '按学员看'}</button>}
      </nav>
      <div className="dzlinks">{DZ_AFTER.map(dzLink)}</div>
      <span className="sp" />
      <button className="pts" id="ptsBtn" onClick={() => session && sheet({ title: '点数', body: <PointsSheet /> })}>余额 <b id="bal">{Math.round(session?.workspace.balance ?? 0).toLocaleString()}</b> 点<span className="ptsub">1点=1秒</span></button>
      {session && !session.user && <button className="btn g sm" id="loginBtn" onClick={() => sheet({ title: '登录', body: <AuthForm onDone={() => sheet(null)} /> })}>登录</button>}
      <button className="who" id="whoBtn" aria-label="切换身份和账号" onClick={whoSheet} disabled={!session}>{session ? `${session.user ? `${session.user.name} · ` : ''}${session.persona.n}` : '…'}</button>
      <button className="ico" id="taskBtn" aria-label="任务" onClick={jobsSheet}><svg><use href="#i-task" /></svg>{running > 0 && <span className="n">{running}</span>}</button>
    </header>
    <nav className="tbar" style={{ gridTemplateColumns: `repeat(${tabs.length},1fr)` }} aria-label="主导航（手机）">
      {tabs.map(([v, , m]) => <button key={v} data-go={v} aria-current={cur(v) ? 'page' : undefined} onClick={() => nav(v)}><svg><use href={`#${ICON[v]}`} /></svg>{m}{v === 'sched' && week > 0 && <span className="cnt">{week}</span>}</button>)}
    </nav>
  </>;
}

export function Icons() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <symbol id="i-pen" viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3" /></symbol>
      <symbol id="i-target" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" /></symbol>
      <symbol id="i-flame" viewBox="0 0 24 24"><path d="M12 3c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 1 1 2 2 3 4 0-3-1-5 0-8z" /></symbol>
      <symbol id="i-tool" viewBox="0 0 24 24"><path d="M14 6a4 4 0 0 0 5 5l-9 9-3-3 9-9a4 4 0 0 1-2-2z" /></symbol>
      <symbol id="i-cap" viewBox="0 0 24 24"><path d="M3 9l9-4 9 4-9 4-9-4zM7 11v4c2 2 8 2 10 0v-4" /></symbol>
      <symbol id="i-news" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></symbol>
      <symbol id="i-box" viewBox="0 0 24 24"><path d="M4 8l8-4 8 4v8l-8 4-8-4V8zM4 8l8 4 8-4M12 12v8" /></symbol>
      <symbol id="i-play" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3V9z" /></symbol>
      <symbol id="i-person" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1-4 4-6 7-6s6 2 7 6" /></symbol>
      <symbol id="i-home" viewBox="0 0 24 24"><path d="M4 11l8-6.5 8 6.5M6.5 9.5V19h11V9.5" /></symbol>
      <symbol id="i-make" viewBox="0 0 24 24"><path d="M12 4v16M4 12h16" /></symbol>
      <symbol id="i-wb" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M7 20h10M9 8v4M12 7v6M15 9v2" /></symbol>
      <symbol id="i-cal" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></symbol>
      <symbol id="i-lib" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></symbol>
      <symbol id="i-task" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></symbol>
      <symbol id="i-idea" viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" /></symbol>
      <symbol id="i-diag" viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4h6v3H9zM9 13l2 2 4-4" /></symbol>
      <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></symbol>
      <symbol id="i-chart" viewBox="0 0 24 24"><path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" /></symbol>
      <symbol id="i-up" viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6" /></symbol>
    </svg>
  );
}
