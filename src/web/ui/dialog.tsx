// 页面里自己的确认框 / 填写框：嵌在 claude.ai 页面（沙箱）里，浏览器自带的 confirm() / prompt() 会被直接跳过（不弹、当成取消），
// 所以后台的「停用」「删除」「收回」「退点」都用这个。
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

type Req = { msg: string; input?: string; ok?: string; done: (v: string | null) => void };

function Box({ r, close }: { r: Req; close: () => void }) {
  const [v, setV] = useState(r.input ?? '');
  const ref = useRef<HTMLInputElement | HTMLButtonElement | null>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const end = (x: string | null) => { r.done(x); close(); };
  return <div className="dlg-mask" role="presentation" onClick={e => { if (e.target === e.currentTarget) end(null); }} onKeyDown={e => { if (e.key === 'Escape') end(null); }}>
    <div className="dlg" role="dialog" aria-modal="true" aria-label="确认">
      <p className="dlg-msg">{r.msg}</p>
      {r.input !== undefined && <input ref={el => { ref.current = el; }} className="dlg-in" value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') end(v); }} />}
      <div className="dlg-ops">
        <button type="button" className="dlg-no" onClick={() => end(null)}>取消</button>
        <button type="button" className="dlg-ok" id="dlgOk" ref={el => { if (r.input === undefined) ref.current = el; }} onClick={() => end(r.input !== undefined ? v : 'ok')}>{r.ok ?? '确定'}</button>
      </div>
    </div>
  </div>;
}

function open(r: Omit<Req, 'done'>): Promise<string | null> {
  return new Promise(resolve => {
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    root.render(<Box r={{ ...r, done: resolve }} close={() => setTimeout(() => { root.unmount(); el.remove(); })} />);
  });
}

/** 确认：点「确定」返回 true */
export const ask = async (msg: string, ok?: string) => (await open({ msg, ok })) !== null;
/** 填一句话：取消返回 null */
export const askText = (msg: string, def = '') => open({ msg, input: def });
