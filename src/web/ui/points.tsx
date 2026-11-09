// 点数：余额、兑换码、邀请、流水。在线支付等新公司主体办好后再接，MVP 先用兑换码（线下收款）。
import { useState } from 'react';
import { api } from '../api.ts';
import { useApp, useData } from '../store.tsx';
import { useMods } from './mods.tsx';
import { InviteCard } from './invite.tsx';
import { KIND_NAME } from '../../shared/points.ts';

export function PointsSheet() {
  const { session, toast, fail, reloadSession } = useApp();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const led = useData(() => api.ledger(), []);
  const mods = useMods();
  return <>
    <div className="lenv ro">{Math.round(session?.workspace.balance ?? 0).toLocaleString()}<small>点</small></div>
    <p className="lb" style={{ marginTop: 18 }}>兑换码</p>
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      <input className="fld" id="redeemIn" value={code} onChange={e => setCode(e.target.value)} placeholder="输入兑换码" />
      <button className="btn y" id="redeemBtn" disabled={busy || code.trim().length < 4} onClick={async () => {
        setBusy(true);
        try { const r = await api.redeem(code.trim()); toast(`到账 ${r.points} 点`); setCode(''); await reloadSession(); led.reload(); } catch (e) { fail(e); } finally { setBusy(false); }
      }}>兑换</button>
    </div>
    {mods.on('invite') && <div style={{ marginTop: 18 }}><InviteCard /></div>}
    <p className="lb" style={{ marginTop: 18 }}>最近流水</p>
    <div className="list" id="ledger">{led.data?.items.length ? led.data.items.slice(0, 20).map((x, i) => <div key={i}><span>{x.reason}<br /><span className="xs m3">{KIND_NAME[x.kind] ?? ''}{KIND_NAME[x.kind] ? ' · ' : ''}{new Date(x.createdAt).toLocaleString()}</span></span><span className="v" style={{ color: x.delta > 0 ? 'var(--real)' : undefined }}>{x.delta > 0 ? '+' : ''}{Math.round(x.delta)}</span></div>) : <div><span className="m">还没有流水</span></div>}</div>
  </>;
}
