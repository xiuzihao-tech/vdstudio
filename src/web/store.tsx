// 全局状态：会话、导航、提示、弹层、跨页交接（文案 → 生成 / 制作台，素材 → 各处，排期 → 选题库）。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, type Session } from './api.ts';
import { setVideoModels } from '../shared/gen.ts';
import type { GenSettings, Topic } from '../shared/types.ts';

export type View = 'home' | 'ip' | 'gen' | 'wb' | 'plan' | 'lib' | 'admin';
export interface Route { view: View; sub?: string; id?: string }

export function parseRoute(path: string): Route {
  const [, v, sub, id] = path.split('/');
  const views: View[] = ['home', 'ip', 'gen', 'wb', 'plan', 'lib', 'admin'];
  return { view: (views as string[]).includes(v) ? (v as View) : 'home', sub: sub || undefined, id: id || undefined };
}
export const routePath = (r: Route) => r.view === 'home' ? '/' : `/${[r.view, r.sub, r.id].filter(Boolean).join('/')}`;

/** 排期“从选题库挑”时带过去的目标格子 */
export interface PlaceTarget { planId: string; date: string; label: string }
/** 制作台的输入：一组带台词的镜头 + 全片设置 */
export interface WbSeed { title: string; lines: string[]; assetIds: string[]; settings?: Partial<GenSettings>; topicId?: string | null }

interface SheetSpec { title: string; body: ReactNode; foot?: ReactNode; wide?: boolean }
interface Ctx {
  session: Session | null; reloadSession: () => Promise<void>; setSession: (s: Session) => void;
  /** 强制登录模式下未登录 */
  needLogin: boolean;
  route: Route; nav: (r: Route | View, replace?: boolean) => void;
  toast: (m: string) => void; fail: (e: unknown) => void;
  sheet: (s: SheetSpec | null) => void;
  genSeed: Partial<GenSettings> | null; setGenSeed: (g: Partial<GenSettings> | null) => void;
  wbSeed: WbSeed | null; setWbSeed: (w: WbSeed | null) => void;
  place: PlaceTarget | null; setPlace: (p: PlaceTarget | null) => void;
  matSeed: string[] | null; setMatSeed: (ids: string[] | null) => void;
  /** 任何会影响选题、排期、余额的写操作之后调用，让各页重新拉数据 */
  bump: () => void; version: number;
  jobsVersion: number; bumpJobs: () => void;
}
const C = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(C); if (!c) throw new Error('useApp 必须在 AppProvider 里用'); return c; };

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSessionRaw] = useState<Session | null>(null);
  /** 换会话时同步视频档位目录（服务端按接入的中转站给出实际能力），保证前后端校验一致 */
  const setSession = useCallback((s: Session | null) => { if (s?.models) setVideoModels(s.models); setSessionRaw(s); }, []);
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname));
  const [toastMsg, setToast] = useState<{ m: string; n: number } | null>(null);
  const [sheetSpec, setSheet] = useState<SheetSpec | null>(null);
  const [genSeed, setGenSeed] = useState<Partial<GenSettings> | null>(null);
  const [wbSeed, setWbSeed] = useState<WbSeed | null>(null);
  const [place, setPlace] = useState<PlaceTarget | null>(null);
  const [matSeed, setMatSeed] = useState<string[] | null>(null);
  const [version, setVersion] = useState(0);
  const [jobsVersion, setJobsVersion] = useState(0);
  const lastFocus = useRef<HTMLElement | null>(null);

  const [needLogin, setNeedLogin] = useState(false);
  const reloadSession = useCallback(async () => {
    try { setSession(await api.session()); setNeedLogin(false); }
    catch (e) { if (e instanceof ApiError && e.status === 401) { setSession(null); setNeedLogin(true); } else throw e; }
  }, [setSession]);
  useEffect(() => { void reloadSession(); }, [reloadSession]);
  useEffect(() => { if (session) document.body.dataset.theme = session.workspace.theme; }, [session]);
  useEffect(() => { const f = () => setRoute(parseRoute(location.pathname)); addEventListener('popstate', f); return () => removeEventListener('popstate', f); }, []);
  // 埋点：每次切页记一次（只记页面名，不记内容）
  useEffect(() => { if (session) void api.track('page_view', { view: route.view, sub: route.sub ?? '' }); }, [route.view, route.sub, !!session]); // eslint-disable-line react-hooks/exhaustive-deps

  const nav = useCallback((r: Route | View, replace = false) => {
    const next = typeof r === 'string' ? { view: r } : r;
    const p = routePath(next);
    if (p !== location.pathname) (replace ? history.replaceState : history.pushState).call(history, null, '', p);
    setRoute(next); setSheet(null); window.scrollTo(0, 0);
  }, []);
  const toast = useCallback((m: string) => setToast({ m, n: Date.now() }), []);
  const fail = useCallback((e: unknown) => {
    const net = e instanceof TypeError && /fetch|network|load failed/i.test(e.message);
    if (net && unloading) return; // 跳页/刷新时被浏览器中断的请求，不算错
    if (!net) console.error(e);
    setToast({ m: e instanceof ApiError ? e.message : net ? '网络不太稳，稍后再试' : '出错了，稍后再试', n: Date.now() });
  }, []);
  const sheet = useCallback((s: SheetSpec | null) => {
    if (s && !sheetSpec) lastFocus.current = document.activeElement as HTMLElement;
    setSheet(s);
    if (!s && lastFocus.current && document.contains(lastFocus.current)) lastFocus.current.focus();
  }, [sheetSpec]);
  useEffect(() => { if (!toastMsg) return; const h = setTimeout(() => setToast(null), 2600); return () => clearTimeout(h); }, [toastMsg]);
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet(null); }; addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, []);

  const value = useMemo<Ctx>(() => ({
    session, reloadSession, setSession, needLogin, route, nav, toast, fail, sheet, genSeed, setGenSeed, wbSeed, setWbSeed, place, setPlace, matSeed, setMatSeed,
    bump: () => { setVersion(v => v + 1); void reloadSession(); }, version, jobsVersion, bumpJobs: () => { setJobsVersion(v => v + 1); void reloadSession(); },
  }), [session, needLogin, reloadSession, route, nav, toast, fail, sheet, genSeed, wbSeed, place, matSeed, version, jobsVersion]);

  return (
    <C.Provider value={value}>
      {children}
      <div className={`scrim${sheetSpec ? ' on' : ''}`} onClick={() => sheet(null)} />
      <div className={`sheet${sheetSpec ? ' on' : ''}`} role="dialog" aria-modal="true" aria-labelledby="shT" aria-hidden={!sheetSpec}>
        {sheetSpec && <>
          <div className="shh"><h2 id="shT">{sheetSpec.title}</h2><button className="cls" id="shX" aria-label="关闭" autoFocus onClick={() => sheet(null)}>×</button></div>
          <div className="sb" id="shB">{sheetSpec.body}</div>
          {sheetSpec.foot && <div className="sf" id="shF">{sheetSpec.foot}</div>}
        </>}
      </div>
      <div id="toast" role="status" aria-live="polite" className={toastMsg ? 'on' : ''}>{toastMsg?.m}</div>
    </C.Provider>
  );
}

/** 拉数据的小钩子：依赖变化或全局 version 变化时重拉 */
let unloading = false;
if (typeof window !== 'undefined') { window.addEventListener('pagehide', () => { unloading = true; }); window.addEventListener('beforeunload', () => { unloading = true; }); }

export function useData<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; reload: () => void; loading: boolean; error: string | null; set: (t: T) => void } {
  const { version, fail } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true; setLoading(true);
    load().then(d => { if (live) { setData(d); setError(null); } }).catch(e => { if (live) { setError(e instanceof ApiError ? e.message : '加载失败'); fail(e); } }).finally(() => live && setLoading(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, n]);
  return { data, loading, error, reload: () => setN(x => x + 1), set: setData };
}

export type { Topic };
