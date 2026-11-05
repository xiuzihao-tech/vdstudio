// 视频 IP 新版的公共部分：整份状态（诊断 / 发布计划 / 出片草稿）、数字人形象、示意图、成片预览、封面。
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api } from '../../api.ts';
import { useApp } from '../../store.tsx';
import { Ph } from '../../ui/kit.tsx';
import { fileUrl } from '../../config.ts';
import { avatarOf, mmss, vtype, type AvatarLook, type Mat, type Shot, type StudioState, type VType } from '../../../shared/studio.ts';

/* ---------- 状态：每个工作区一份，所有页面共用 ---------- */
let cur: { ws: string; st: StudioState } | null = null;
let loading: string | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const setCur = (ws: string, st: StudioState) => { cur = { ws, st }; emit(); };
/** 不经过渲染直接读最新状态 */
export const studioNow = () => cur?.st ?? null;

export function useStudio() {
  const { session, fail } = useApp();
  const ws = session?.workspace.id ?? '';
  const snap = useSyncExternalStore(subscribe, () => cur);
  useEffect(() => {
    if (!ws || cur?.ws === ws || loading === ws) return;
    loading = ws;
    api.studio().then(r => setCur(ws, r.state)).catch(fail).finally(() => { loading = null; });
  }, [ws, fail]);
  const st = snap?.ws === ws ? snap.st : null;
  /** 先改本地再存服务端（不等返回，免得连着改时被旧结果盖掉） */
  const save = (p: Partial<StudioState>, localOnly = false) => {
    if (!cur || cur.ws !== ws) return Promise.resolve();
    setCur(ws, { ...cur.st, ...p });
    if (localOnly) return Promise.resolve();
    return api.saveStudio(p).then(() => undefined).catch(fail);
  };
  const replace = (s: StudioState) => setCur(ws, s);
  /** 诊断按最新状态合并（连着发几条时不会被旧的盖掉） */
  const saveDiag = (p: Partial<StudioState['diag']>, localOnly = false) => cur ? save({ diag: { ...cur.st.diag, ...p } }, localOnly) : Promise.resolve();
  return { st, save, replace, saveDiag };
}

/* ---------- 数字人形象（系统形象由我们定，自己的来自「管理我的素材」） ---------- */
export function AvatarArt({ look, className }: { look: AvatarLook | string; className?: string }) {
  const a = typeof look === 'string' ? avatarOf(look) : look;
  const id = `av-${a.id}`;
  const cap: Record<AvatarLook['hairStyle'], string> = {
    crop: 'M37 64 C35 36 85 36 83 64 C80 50 70 46 60 46 C50 46 40 50 37 64 Z',
    short: 'M36 68 C32 34 88 34 84 68 C82 56 78 50 70 48 C62 52 48 50 42 54 C39 58 37 62 36 68 Z',
    bob: 'M37 68 C36 40 84 40 83 68 C78 54 64 50 54 53 C46 56 40 61 37 68 Z',
    long: 'M37 68 C36 40 84 40 83 68 C78 54 64 50 54 53 C46 56 40 61 37 68 Z',
  };
  const back = a.hairStyle === 'bob' ? 'M33 98 C24 36 96 36 87 98 Z' : a.hairStyle === 'long' ? 'M31 126 C20 36 100 36 89 126 Z' : null;

  return <svg className={`avart ${className ?? ''}`} viewBox="0 0 120 150" role="img" aria-label={`数字人：${a.n}`}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={a.bg} /><stop offset="1" stopColor={a.bg2} /></linearGradient></defs>
    <rect width="120" height="150" fill={`url(#${id})`} />
    <rect x="8" y="16" width="30" height="48" rx="2" fill="#fff" opacity=".28" />
    <rect x="86" y="34" width="26" height="4" fill="#000" opacity=".12" /><rect x="90" y="24" width="6" height="10" fill="#000" opacity=".1" /><rect x="100" y="20" width="8" height="14" fill="#000" opacity=".08" />
    {back && <path d={back} fill={a.hair} />}
    <path d="M8 150 C12 114 38 104 60 104 C82 104 108 114 112 150 Z" fill={a.top} />
    <path d="M50 104 L60 120 L70 104 Z" fill="#F4F1EC" opacity=".9" />
    <rect x="52" y="84" width="16" height="22" rx="6" fill={a.skin} />
    <ellipse cx="60" cy="68" rx="22" ry="26" fill={a.skin} />
    <path d={cap[a.hairStyle]} fill={a.hair} />
    <path d="M47 62 Q52 59 57 62 M63 62 Q68 59 73 62" stroke={a.hair} strokeWidth="2" fill="none" strokeLinecap="round" />
    <ellipse cx="52" cy="69" rx="2.2" ry="2.6" fill="#2A2420" /><ellipse cx="68" cy="69" rx="2.2" ry="2.6" fill="#2A2420" />
    <path d="M59 72 Q60 77 58 78" stroke="#000" strokeOpacity=".18" strokeWidth="1.4" fill="none" />
    <path d="M53 83 Q60 88 67 83" stroke="#8A4B3A" strokeWidth="2" fill="none" strokeLinecap="round" />
    {a.glasses && <g stroke="#1E1C1A" strokeWidth="1.6" fill="none"><circle cx="52" cy="69" r="6.5" /><circle cx="68" cy="69" r="6.5" /><path d="M58.5 69 H61.5" /></g>}
  </svg>;
}

/* ---------- 画面：用户素材 / 场景示意 / 数字人 ---------- */
export function Thumb({ mat, k, avatar, className }: { mat?: Mat | null; k?: string; avatar?: string | null; className?: string }) {
  if (avatar) return <div className={`ph thumb ${className ?? ''}`} data-k="av"><AvatarArt look={avatar} /></div>;
  if (mat?.url && mat.mime?.startsWith('image/')) return <div className={`ph thumb ${className ?? ''}`} data-k="img"><img src={fileUrl(mat.url)} alt={mat.name} /></div>;
  if (mat?.url && mat.mime?.startsWith('video/')) return <div className={`ph thumb ${className ?? ''}`} data-k="img"><video src={`${fileUrl(mat.url)}#t=0.1`} muted playsInline preload="metadata" /></div>;
  return <Ph k={mat?.k ?? k ?? 'live'} className={`thumb ${className ?? ''}`} />;
}

/** 示意图：这一类片按顺序由哪几段组成（让用户一眼看懂会出什么） */
export function Schema({ type, face, avatar }: { type: VType; face: 'avatar' | 'none'; avatar: string }) {
  const t = vtype(type);
  const SC = ['entry', 'live', 'kit', 'bed', 'stone', 'hotel'];
  let si = 0;
  return <div className="schema" aria-label={`${t.n}的组成示意`}>
    <div className="schema-row">{t.parts.map(([kind, label], i) => {
      const k = type === 'site' ? 'site' : SC[si++ % SC.length];
      const showAv = kind === 'avatar' && face === 'avatar';
      return <figure key={i} className={`sc sc-${kind}`}>
        {showAv ? <Thumb avatar={avatar} /> : kind === 'pair' ? <div className="pair"><Ph k="old" /><Ph k="new" /></div> : kind === 'macro' ? <div className="macro"><Ph k="stone" /><i /></div> : <Thumb k={kind === 'avatar' ? 'hotel' : k} />}
        <figcaption>{showAv ? '数字人' : kind === 'avatar' ? '空镜' : label}</figcaption>
      </figure>;
    })}</div>
    <div className="schema-bars">
      <span><b>字幕</b><i className="bar sub" /></span>
      <span><b>{face === 'avatar' ? '数字人声音' : t.face === 'none' ? '音乐' : '配音'}</b><i className={`bar ${face === 'avatar' || t.face !== 'none' ? 'voice' : 'music'}`} /></span>
    </div>
  </div>;
}

/* ---------- 成片预览：按镜头轮播，字幕跟着走（接上视频服务前的示意） ---------- */
export function Player({ shots, ratio, font, title, avatar, tag = '成片预览 · 示意' }: { shots: Shot[]; ratio: string; font: string; title: string; avatar: string; tag?: string }) {
  const [i, setI] = useState(0);
  const [t, setT] = useState(0);
  const [on, setOn] = useState(true);
  const start = useRef(0);
  const total = shots.reduce((a, s) => a + s.secs, 0);
  const s = shots[i] ?? shots[0];
  useEffect(() => {
    if (!on || !shots.length) return;
    start.current = performance.now() - t * 1000;
    let h = 0;
    const tick = () => {
      const now = (performance.now() - start.current) / 1000;
      if (now >= (shots[i]?.secs ?? 3)) { setI(x => (x + 1) % shots.length); setT(0); return; }
      setT(now); h = requestAnimationFrame(tick);
    };
    h = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(h);
  }, [on, i, shots.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const before = shots.slice(0, i).reduce((a, x) => a + x.secs, 0);
  const ar = ratio.startsWith('16:9') ? '16/9' : ratio.startsWith('1:1') ? '1/1' : ratio.startsWith('3:4') ? '3/4' : '9/16';
  return <div className="player" style={{ aspectRatio: ar }} data-font={font}>
    {s && <div className="pl-shot" key={`${i}`}><Thumb mat={s.mat} k={s.k} avatar={s.avatar ? avatar : null} className="kb" /></div>}
    <span className="pl-tag">{tag}</span>
    {i === 0 && t < 2.2 && <p className="pl-title">{title}</p>}
    {s && <p className="pl-sub">{s.line}</p>}
    <div className="pl-ctl">
      <button className="pl-btn" aria-label={on ? '暂停' : '播放'} onClick={() => setOn(x => !x)}>{on ? '❚❚' : '▶'}</button>
      <div className="pl-bar">{shots.map((x, k) => <i key={x.id} style={{ flex: x.secs }}><b style={{ width: k < i ? '100%' : k === i ? `${Math.min(100, t / x.secs * 100)}%` : 0 }} /></i>)}</div>
      <span className="pl-time">{mmss(before + t)} / {mmss(total)}</span>
    </div>
  </div>;
}

/** 封面三种排法：大字说人话 */
export function CoverArt({ v, title, mat, k }: { v: 'A' | 'B' | 'C'; title: string; mat?: Mat | null; k: string }) {
  const words = title.split(/[｜|·，,]/).filter(Boolean);
  const big = words[0] ?? title, small = words.slice(1).join(' ');
  return <div className={`cover cv-${v}`}>
    <Thumb mat={mat} k={k} />
    <div className="cv-txt"><b>{big}</b>{small && <span>{small}</span>}</div>
  </div>;
}
