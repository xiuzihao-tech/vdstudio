// 右下角“提意见”：验证期收集用户原话，进后台的反馈列表。
import { useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../store.tsx';

const PAGE: Record<string, string> = { home: '创作', ip: '选题文案', gen: '生成视频', wb: '制作台', plan: '排期', lib: '作品与素材', admin: '后台' };

function Form() {
  const { route, sheet, toast, fail } = useApp();
  const [text, setText] = useState(''), [contact, setContact] = useState(''), [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { await api.feedback(text, PAGE[route.view] + (route.sub ? `/${route.sub}` : ''), contact); sheet(null); toast('收到了，谢谢！'); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return <>
    <label className="lb" htmlFor="fbTx">哪里不好用、想要什么功能，直接说</label>
    <textarea className="fld" id="fbTx" rows={5} value={text} onChange={e => setText(e.target.value)} maxLength={2000} placeholder="比如：生成出来的文案太像广告了" />
    <label className="lb" htmlFor="fbCt" style={{ marginTop: 12 }}>怎么联系你 <span className="m3">可选，微信或手机</span></label>
    <input className="fld" id="fbCt" value={contact} onChange={e => setContact(e.target.value)} maxLength={80} />
    <p className="note">会自动带上你当前所在的页面（{PAGE[route.view]}）。</p>
    <div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}><button className="btn g" onClick={() => sheet(null)}>取消</button><button className="btn y" id="fbGo" disabled={busy || text.trim().length < 2} onClick={send}>提交</button></div>
  </>;
}

export function FeedbackButton() {
  const { session, sheet } = useApp();
  if (!session) return null;
  return <button id="fbBtn" className="fbb" onClick={() => sheet({ title: '提意见', body: <Form /> })}>提意见</button>;
}
