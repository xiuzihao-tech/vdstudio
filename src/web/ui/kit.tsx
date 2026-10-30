// 基础组件：画面占位/真实图片、来源标签、分段选择、药丸选择、流程条、付费确认、空状态。
import { useState, type ReactNode } from 'react';
import { useApp } from '../store.tsx';
import type { Asset } from '../../shared/types.ts';
import { fileUrl } from '../config.ts';

const SRCN: Record<string, string> = { real: '实拍', gen: 'AI 生成', demo: '示意' };
export function Src({ k = '', children }: { k?: string; children?: ReactNode }) {
  return <span className={`src ${k}`}>{children ?? SRCN[k] ?? k}</span>;
}

/** 画面：有真实文件显示文件，否则用场景占位 */
export function Ph({ k, tag, asset, className }: { k: string; tag?: string; asset?: Asset | null; className?: string }) {
  if (asset?.url && asset.mime?.startsWith('image/')) return <div className={`ph ${className ?? ''}`} data-k="img"><img src={fileUrl(asset.url)} alt={asset.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />{tag && <Src k={tag} />}</div>;
  if (asset?.url && asset.mime?.startsWith('video/')) return <div className={`ph ${className ?? ''}`} data-k="img"><video src={`${fileUrl(asset.url)}#t=0.1`} muted playsInline preload="metadata" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />{tag && <Src k={tag} />}</div>;
  return <div className={`ph ${className ?? ''}`} data-k={k}>{k === 'person' && <i />}{tag && <Src k={tag} />}</div>;
}

export function Seg<T extends string | number>({ value, options, onChange, label, render }: { value: T; options: readonly T[]; onChange: (v: T) => void; label?: string; render?: (v: T) => ReactNode }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(o => <button key={String(o)} type="button" aria-pressed={o === value} onClick={() => onChange(o)}>{render ? render(o) : String(o)}</button>)}
    </div>
  );
}

export function Pills<T extends string | number>({ value, options, onChange, label, disabled, small = true }: { value: T | T[]; options: readonly (T | [T, string])[]; onChange: (v: T) => void; label?: string; disabled?: (v: T) => boolean; small?: boolean }) {
  const sel = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <div className="pills" role="group" aria-label={label}>
      {options.map(o => {
        const [v, t]: [T, string] = Array.isArray(o) ? (o as [T, string]) : [o as T, String(o)];
        const dis = disabled?.(v);
        return <button key={String(v)} type="button" className={`pill${small ? ' sm' : ''}`} aria-pressed={sel(v)} aria-disabled={dis || undefined} style={dis ? { opacity: 0.45 } : undefined} onClick={() => onChange(v)}>{t}</button>;
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className="row s" style={{ justifyContent: 'space-between', gap: 10, marginTop: 12, flexWrap: 'nowrap' }}>
      <span>{label}{hint && <><br /><span className="xs m3">{hint}</span></>}</span>
      <input type="checkbox" className="sw" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
    </label>
  );
}

const FLOW: [string, string][] = [['find', '选题'], ['copy', '文案'], ['gen', '生成视频'], ['plan', '排期发布']];
export function Steps({ cur }: { cur: 'find' | 'copy' | 'gen' | 'plan' }) {
  const { nav } = useApp();
  const ix = FLOW.findIndex(f => f[0] === cur);
  return (
    <div className="steps" aria-label="创作流程">
      {FLOW.map(([k, n], i) => (
        <span key={k} style={{ display: 'contents' }}>
          {i > 0 && <i />}
          <button type="button" className={ix > i ? 'done' : ''} aria-current={k === cur ? 'step' : undefined}
            onClick={() => k === 'find' || k === 'copy' ? nav({ view: 'ip', sub: k }) : nav(k as 'gen' | 'plan')}>
            <b>{ix > i ? '✓' : i + 1}</b>{n}
          </button>
        </span>
      ))}
    </div>
  );
}

/** 所有付费动作先过这里：列清楚扣多少点，确认后才执行 */
export function usePay() {
  const { sheet, session } = useApp();
  return ({ title, lines, note, ok = '开始', then }: { title: string; lines: [string, number][]; note?: string; ok?: string; then: () => Promise<void> | void }) => {
    const tot = Math.round(lines.reduce((a, l) => a + l[1], 0));
    sheet({
      title,
      body: <>
        <div className="list">{lines.map(([n, c], i) => <div key={i}><span>{n}</span><span className="v">{Math.round(c)} 点</span></div>)}<div className="tot"><span>预计</span><span>{tot} 点</span></div></div>
        <p className="note">余额 {Math.round(session?.workspace.balance ?? 0).toLocaleString()} 点。按任务完成结算，失败自动退点。{note && <><br />{note}</>}</p>
      </>,
      foot: <PayFoot label={`${ok} · ${tot} 点`} onOk={then} />,
    });
  };
}
function PayFoot({ label, onOk }: { label: string; onOk: () => Promise<void> | void }) {
  const { sheet } = useApp();
  const [busy, setBusy] = useState(false);
  return <>
    <button className="btn g" onClick={() => sheet(null)}>取消</button>
    <button className="btn y" id="payOk" disabled={busy} onClick={async () => { setBusy(true); try { sheet(null); await onOk(); } finally { setBusy(false); } }}>{label}</button>
  </>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="stbox" style={{ display: 'block', margin: '60px auto' }}><h2 className="d3">{title}</h2>{children && <p>{children}</p>}{action}</div>;
}

export function Skel({ h = 18, w = '100%' }: { h?: number; w?: string | number }) {
  return <div className="skel" style={{ height: h, width: w }} />;
}

/** 文件选择：返回一个打开系统选择框的函数 */
/** 正在等用户选文件的输入框：留一个引用，免得对话框开着时被浏览器回收，选完文件却收不到 change 事件 */
const pendingInputs = new Set<HTMLInputElement>();
/** 选文件（点了上传、选了文件却没反应，多半是输入框被回收了，所以这里一直拿着它，选完或取消后再放开） */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    pendingInputs.add(inp);
    const drop = () => pendingInputs.delete(inp);
    inp.addEventListener('change', () => { drop(); resolve([...(inp.files ?? [])]); }, { once: true });
    setTimeout(drop, 10 * 60_000);
    inp.click();
  });
}
