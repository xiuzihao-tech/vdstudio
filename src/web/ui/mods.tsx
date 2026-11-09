// 模块开关（前端）：按服务端算好的状态显示入口。on 正常显示；soon 显示「即将上线」；off 不渲染。
// 管理员默认什么都看得到，切「按学员看」后和学员看到的一样（存在这台设备上）。
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { api } from '../api.ts';
import { useApp } from '../store.tsx';
import { moduleOf, type ModView } from '../../shared/modules.ts';

const KEY = 'findai.asStudent';
const subs = new Set<() => void>();
let asStudent = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();
export function setAsStudent(v: boolean) {
  asStudent = v; try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* 忽略 */ }
  subs.forEach(f => f());
}
const useAsStudent = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => asStudent);

export function useMods() {
  const { session } = useApp();
  const student = useAsStudent();
  const all = !!session?.isAdmin && !student;
  const view = (id: string): ModView => all ? 'on' : session?.modules?.[id] ?? 'on';
  return {
    view,
    on: (id: string) => view(id) === 'on',
    /** 能看到入口（能用或预告） */
    shown: (id: string) => view(id) !== 'off',
    any: (...ids: string[]) => ids.some(id => view(id) === 'on'),
    anyShown: (...ids: string[]) => ids.some(id => view(id) !== 'off'),
    pro: (id: string) => !!session?.modulePro?.includes(id),
    adminAll: all, student, isAdmin: !!session?.isAdmin,
  };
}

/** 进入一个模块时记一次「打开」，后台据此看哪些模块真的有人用 */
export function useModOpen(id: string, when = true) {
  useEffect(() => { if (when) void api.track('module_open', { id }); }, [id, when]);
}

/** 包一层开关：能用显示内容；预告显示 soon（默认一张「即将上线」卡）；看不到就不渲染 */
export function Mod({ id, children, soon }: { id: string; children: ReactNode; soon?: ReactNode | false }) {
  const m = useMods(), v = m.view(id);
  if (v === 'on') return <>{children}</>;
  if (v === 'soon') return soon === false ? null : <>{soon ?? <SoonCard id={id} />}</>;
  return null;
}

export function SoonCard({ id, compact }: { id: string; compact?: boolean }) {
  const m = moduleOf(id);
  if (!m) return null;
  return <div className={`soon card${compact ? ' sm' : ''}`} data-soon={id}>
    <span className="soonb">即将上线</span>
    <b>{m.n}</b>
    <p className="s m">{m.d}</p>
  </div>;
}

/** 入口按钮上的小角标 */
export const SoonBadge = ({ id }: { id: string }) => {
  const m = useMods();
  return m.view(id) === 'soon' ? <span className="soonb sm">即将上线</span> : null;
};

/** 后台账号在前台「按学员看」时：右下角一个小条，点了退出预览 / 回后台（学员看不到） */
export function StudentChip() {
  const { session, nav } = useApp();
  const student = useAsStudent();
  if (!session?.isAdmin || !student) return null;
  return <div className="stuchip" id="stuChip">按学员看中 <button onClick={() => setAsStudent(false)}>退出预览</button><button onClick={() => nav('admin')}>回后台</button></div>;
}
