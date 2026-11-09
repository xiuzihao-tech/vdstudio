// 余额与充值：点数套餐 → 选微信 / 支付宝 → 扫码付款 → 到账（页面每 2 秒查一次单）。
// 同一套也用来付「大哲诊断账号」¥899。出片时余额不够，直接在当前页弹充值，不用跳走。
import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { api } from '../../api.ts';
import { useApp, useData } from '../../store.tsx';
import { useMods } from '../../ui/mods.tsx';
import { CHANNEL_NAME, ORDER_TTL_MIN, STATUS_NAME, totalPoints, yuan, type Order, type PayChannel, type Product } from '../../../shared/billing.ts';
import { KIND_NAME } from '../../../shared/points.ts';
import { InviteCard } from '../../ui/invite.tsx';

/** 二维码（SVG） */
export function Qr({ text, size = 200 }: { text: string; size?: number }) {
  const svg = useMemo(() => { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }, [text]);
  return <div className="qr" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

const CH_ICON: Record<PayChannel, string> = { wechat: '微', alipay: '支', mock: '演' };
const PAY_VERB: Record<PayChannel, string> = { wechat: '微信支付', alipay: '支付宝付款', mock: '模拟付款' };

/** 扫码付款弹层：显示二维码、倒计时，轮询到账 */
function PayBody({ order, onPaid }: { order: Order & { qr: string | null }; onPaid: (o: Order) => void }) {
  const { fail, toast, reloadSession } = useApp();
  const [o, setO] = useState(order);
  const [left, setLeft] = useState(ORDER_TTL_MIN * 60);
  useEffect(() => {
    let live = true, h: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await api.order(order.id); if (!live) return; setO(r.order);
        if (r.order.status === 'paid') { await reloadSession(); onPaid(r.order); return; }
        if (r.order.status === 'closed') return;
      } catch { /* 网络抖一下，下次再查 */ }
      h = setTimeout(tick, 2000);
    };
    h = setTimeout(tick, 2000);
    return () => { live = false; clearTimeout(h); };
  }, [order.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const h = setInterval(() => setLeft(x => Math.max(0, x - 1)), 1000); return () => clearInterval(h); }, []);
  const mock = async () => { try { const r = await api.mockPay(o.id); await reloadSession(); toast('模拟付款成功'); onPaid(r.order); } catch (e) { fail(e); } };
  return <div className="paybody" id="payBody">
    <p className="paysum"><b>{yuan(o.amount)}</b><span>{o.title}</span></p>
    {o.status === 'closed' || left === 0 ? <p className="s">订单超时关掉了，重新下单就行。</p> : <>
      {o.qr && <Qr text={o.qr} />}
      <p className="s" style={{ marginTop: 10 }}>用<b>{o.channel === 'alipay' ? '支付宝' : o.channel === 'wechat' ? '微信' : '手机'}</b>扫一扫付款 · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} 内有效</p>
      <p className="xs m3" style={{ marginTop: 4 }}>付完这里会自动到账，不用关页面。</p>
      {o.channel === 'mock' && <button className="btn k" id="mockPay" style={{ marginTop: 14 }} onClick={mock}>模拟付款成功（演示）</button>}
    </>}
  </div>;
}

/** 下单并弹出扫码；付好后回调 */
export function usePayOrder() {
  const { sheet, fail } = useApp();
  return async (product: Product, channel: PayChannel, packageId: string | undefined, onPaid: (o: Order) => void) => {
    try {
      const { order } = await api.createOrder(product, channel, packageId);
      sheet({ title: CHANNEL_NAME[channel], body: <PayBody order={order} onPaid={o => { sheet(null); onPaid(o); }} /> });
    } catch (e) { fail(e); }
  };
}

/** 选套餐 + 渠道 + 付款（充值页和「余额不够」弹层共用） */
export function Recharge({ need, onPaid }: { need?: number; onPaid?: (o: Order) => void }) {
  const { toast, bump } = useApp();
  const b = useData(() => api.billing(), []);
  const pay = usePayOrder();
  const [pk, setPk] = useState<string | null>(null);
  const [ch, setCh] = useState<PayChannel | null>(null);
  const mods = useMods();
  if (!mods.on('recharge')) return <p className="s m">在线充值还没开放，先用兑换码（课程赠送或找老师买）。</p>;
  if (!b.data) return <p className="s m">加载中…</p>;
  const { packages, channels } = b.data;
  // 差多少点：默认选第一个够用的套餐，没有就选推荐的
  const fit = need ? packages.find(p => totalPoints(p) >= need) : null;
  const sel = packages.find(p => p.id === pk) ?? fit ?? packages.find(p => p.tag === '推荐') ?? packages[0];
  const chan = ch && channels.includes(ch) ? ch : channels[0];
  return <div className="recharge" id="recharge">
    <div className="pkgs">{packages.map(p => <button key={p.id} className="pkg" data-pkg={p.id} aria-pressed={sel.id === p.id} onClick={() => setPk(p.id)}>
      {p.tag && <span className="pkg-tag">{p.tag}</span>}
      <span className="pkg-n">{p.n}</span>
      <b>{totalPoints(p).toLocaleString()}<small> 点</small></b>
      <span className="pkg-b">{p.bonus ? `含赠送 ${p.bonus.toLocaleString()} 点` : '　'}</span>
      <span className="pkg-p">{yuan(p.price)}</span>
      <span className="xs m3">约 {Math.round(totalPoints(p) / 60)} 分钟成片</span>
    </button>)}</div>
    {!channels.length ? <p className="s err" style={{ marginTop: 14 }}>在线支付还没开通，先用兑换码。</p> : <div className="chans" role="radiogroup" aria-label="支付方式">
      {channels.map(c => <button key={c} role="radio" aria-checked={chan === c} data-ch={c} className={`chan ch-${c}`} onClick={() => setCh(c)}><i>{CH_ICON[c]}</i>{CHANNEL_NAME[c]}</button>)}
    </div>}
    {channels.length > 0 && <button className="btn k big" id="payGo" style={{ marginTop: 14 }} onClick={() => pay('points', chan!, sel.id, o => { toast(`到账 ${o.points.toLocaleString()} 点`); b.reload(); bump(); onPaid?.(o); })}>
      {PAY_VERB[chan!]} {yuan(sel.price)} · 到账 {totalPoints(sel).toLocaleString()} 点</button>}
    <p className="xs m3" style={{ marginTop: 8 }}>1 点≈1 秒成片。点数不过期，失败的生成自动退点。</p>
  </div>;
}

/** 余额不够时弹充值 */
export function useRecharge() {
  const { sheet } = useApp();
  return (need: number, onPaid?: () => void) => sheet({ title: need > 0 ? `余额不够，还差 ${need.toLocaleString()} 点` : '充值点数', wide: true, body: <Recharge need={need} onPaid={() => { sheet(null); onPaid?.(); }} /> });
}

export function PayPage() {
  const { session, toast, fail, reloadSession, bump, route } = useApp();
  const mods = useMods();
  // 侧栏「邀请好友」进来：滚到邀请卡片
  useEffect(() => { if (route.sub === 'invite') setTimeout(() => document.getElementById('inviteCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300); }, [route.sub]);
  const b = useData(() => api.billing(), []);
  const led = useData(() => api.ledger(), []);
  const [code, setCode] = useState('');
  const bal = Math.round(session?.workspace.balance ?? 0);
  return <section className="view on" id="v-pay"><div className="vb wrap sch">
    <div className="hero tight" style={{ padding: '40px 0 0' }}>
      <p className="eyebrow">余额与充值</p>
      <h1 className="d2">还有 <em id="payBal">{bal.toLocaleString()} 点</em>，约 {Math.round(bal / 60)} 分钟成片。</h1>
      <p className="s m" style={{ marginTop: 8 }}>1 点≈1 秒成片：真人口播一条约 60 点，样片四成价。</p>
    </div>
    <div className="paygrid">
      <div className="card"><p className="t2" style={{ marginBottom: 12 }}>充值</p><Recharge onPaid={() => { led.reload(); }} /></div>
      <div>
        <div className="card">
          <p className="t2">兑换码</p>
          <p className="xs m3" style={{ marginTop: 4 }}>课程赠送、线下付款拿到的码在这里换。</p>
          <div className="row" style={{ gap: 8, flexWrap: 'nowrap', marginTop: 10 }}>
            <input className="fld" id="redeemIn" value={code} onChange={e => setCode(e.target.value)} placeholder="输入兑换码" />
            <button className="btn y" id="redeemBtn" disabled={code.trim().length < 4} onClick={async () => { try { const r = await api.redeem(code.trim()); toast(`到账 ${r.points} 点`); setCode(''); await reloadSession(); led.reload(); bump(); } catch (e) { fail(e); } }}>兑换</button>
          </div>
        </div>
        {mods.on('invite') && <div style={{ marginTop: 12 }}><InviteCard /></div>}
        <div className="card" style={{ marginTop: 12 }}>
          <p className="t2">订单</p>
          <div className="list" id="orders" style={{ marginTop: 8 }}>{b.data?.orders.length ? b.data.orders.slice(0, 10).map(o => <div key={o.id}><span>{o.title}<br /><span className="xs m3">{new Date(o.createdAt).toLocaleString()} · {CHANNEL_NAME[o.channel]}</span></span><span className="v">{yuan(o.amount)}<br /><span className={`xs ${o.status === 'paid' ? 'ok' : 'm3'}`}>{STATUS_NAME[o.status]}</span></span></div>) : <div><span className="m">还没有订单</span></div>}</div>
        </div>
        <div className="card" style={{ marginTop: 12 }}>
          <p className="t2">点数流水</p>
          <div className="list" id="ledger" style={{ marginTop: 8 }}>{led.data?.items.length ? led.data.items.slice(0, 15).map((x, i) => <div key={i}><span>{x.reason}<br /><span className="xs m3">{KIND_NAME[x.kind] ?? ''}{KIND_NAME[x.kind] ? ' · ' : ''}{new Date(x.createdAt).toLocaleString()}</span></span><span className="v" style={{ color: x.delta > 0 ? 'var(--real)' : undefined }}>{x.delta > 0 ? '+' : ''}{Math.round(x.delta)}</span></div>) : <div><span className="m">还没有流水</span></div>}</div>
        </div>
      </div>
    </div>
  </div></section>;
}
