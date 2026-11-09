// 后台通用小部件（dazheip 后台同款）：描边数据块、黑表头表格、状态小标签、表单字段、时间格式。
import type { ReactNode } from 'react';

export const fmtTime = (s: string | null | undefined, withYear = false) => s ? new Date(s).toLocaleString('zh-CN', { ...(withYear ? { year: 'numeric' } : {}), month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtNum = (n: number | null | undefined) => ((n ?? 0) || 0).toLocaleString('zh-CN');
export const signed = (n: number) => `${n > 0 ? '+' : ''}${fmtNum(Math.round(n))}`;

/** 数据块：标题 + 大数字 + 一行小字 */
export function Tile({ label, value, sub, tone, id }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'err'; id?: string }) {
  return <div className={`adm-tile${tone ? ` ${tone}` : ''}`} id={id}><span>{label}</span><b>{value}</b>{sub !== undefined && <small>{sub}</small>}</div>;
}

export function Chip({ k, children, title }: { k?: 'ok' | 'warn' | 'err' | 'dark' | 'y' | ''; children: ReactNode; title?: string }) {
  return <span className={`adm-chip${k ? ` ${k}` : ''}`} title={title}>{children}</span>;
}

/** 区块：标题（可带右侧操作）+ 内容 */
export function Sec({ title, extra, children, id, note }: { title: ReactNode; extra?: ReactNode; children: ReactNode; id?: string; note?: ReactNode }) {
  return <section className="adm-sec" id={id}>
    <div className="adm-sech"><h2>{title}</h2>{note && <span className="adm-note">{note}</span>}<span className="sp" />{extra}</div>
    {children}
  </section>;
}

/** 黑表头表格；rows 为空时显示一行空状态 */
export function Table({ head, rows, empty = '还没有数据', id, num = [] }: { head: ReactNode[]; rows: ReactNode[][]; empty?: string; id?: string; num?: number[] }) {
  return <div className="adm-scroll"><table className="adm-tbl" id={id}>
    <thead><tr>{head.map((h, i) => <th key={i} className={num.includes(i) ? 'num' : undefined}>{h}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={num.includes(j) ? 'num' : undefined}>{c}</td>)}</tr>)
      : <tr><td colSpan={head.length} className="adm-empty">{empty}</td></tr>}</tbody>
  </table></div>;
}

/** 表单字段：标签 + 输入 + 提示 */
export function Field({ label, hint, children, wide }: { label: ReactNode; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return <label className={`adm-field${wide ? ' wide' : ''}`}><span>{label}</span>{children}{hint && <em className="hint">{hint}</em>}</label>;
}

export function NumIn({ value, onChange, min = 0, max, step = 1, id, suffix }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; id?: string; suffix?: string }) {
  return <span className="adm-num"><input id={id} type="number" min={min} max={max} step={step} value={Number.isFinite(value) ? value : ''} onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />{suffix && <i>{suffix}</i>}</span>;
}

/** 很小的横条（表格里比大小用） */
export const Bar = ({ v, max }: { v: number; max: number }) => <span className="adm-bar" aria-hidden="true"><i style={{ width: `${max ? Math.max(v ? 3 : 0, Math.round((v / max) * 100)) : 0}%` }} /></span>;

/** 维护说明（SKILL.md 正文）：只认标题、列表、表格和代码块，其余按段落显示，不渲染 HTML */
export function Doc({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let list: string[] = [], code: string[] | null = null, table: string[] = [];
  const inline = (s: string) => s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('`') && p.endsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p);
  const flush = () => {
    if (list.length) { out.push(<ul key={out.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = []; }
    if (table.length) {
      const rows = table.filter(r => !/^\|\s*-/.test(r)).map(r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
      out.push(<div key={out.length} className="adm-scroll"><table className="adm-tbl sm"><thead><tr>{rows[0].map((c, i) => <th key={i}>{inline(c)}</th>)}</tr></thead><tbody>{rows.slice(1).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table></div>);
      table = [];
    }
  };
  for (const l of lines) {
    if (code) { if (l.startsWith('```')) { out.push(<pre key={out.length} className="adm-pre">{code.join('\n')}</pre>); code = null; } else code.push(l); continue; }
    if (l.startsWith('```')) { flush(); code = []; continue; }
    if (/^\s*\|/.test(l)) { if (list.length) flush(); table.push(l.trim()); continue; }
    if (table.length) flush();
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { flush(); out.push(h[1].length <= 2 ? <h3 key={out.length}>{inline(h[2])}</h3> : <h4 key={out.length}>{inline(h[2])}</h4>); continue; }
    const li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(l);
    if (li) { list.push(li[1]); continue; }
    flush();
    if (l.trim()) out.push(<p key={out.length}>{inline(l)}</p>);
  }
  if (code) out.push(<pre key={out.length} className="adm-pre">{(code as string[]).join('\n')}</pre>);
  flush();
  return <div className="adm-doc">{out}</div>;
}

/** 下载一个文件（导出用） */
export function download(name: string, blob: Blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
