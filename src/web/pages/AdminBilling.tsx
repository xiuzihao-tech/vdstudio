// 后台 · 充值订单：今天 / 近 30 天收入，支付渠道接没接上，套餐和诊断价格（改了马上生效），订单列表和标记退款。
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useApp, useData } from '../store.tsx';
import { Skel } from '../ui/kit.tsx';
import { CHANNEL_NAME, STATUS_NAME, totalPoints, yuan, type BillingConfig, type Package } from '../../shared/billing.ts';

export function AdminBilling() {
  const { toast, fail } = useApp();
  const d = useData(() => api.admin.billing(), []);
  const [cfg, setCfg] = useState<BillingConfig | null>(null);
  useEffect(() => { if (d.data && !cfg) setCfg(d.data.config); }, [d.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d.data || !cfg) return <Skel h={300} />;
  const x = d.data;
  const setPk = (i: number, p: Partial<Package>) => setCfg({ ...cfg, packages: cfg.packages.map((q, j) => j === i ? { ...q, ...p } : q) });
  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));
  return <div id="adminBilling">
    <div className="mine">
      <div className="gbox"><b className="ro" style={{ fontSize: 26 }}>{yuan(x.today.amount)}</b><p className="s m">今天收入 · {x.today.n} 单</p></div>
      <div className="gbox"><b className="ro" style={{ fontSize: 26 }}>{yuan(x.month.amount)}</b><p className="s m">近 30 天 · {x.month.n} 单 · 卖出 {x.month.points.toLocaleString()} 点</p></div>
      <div className="gbox"><b style={{ fontSize: 18 }}>{x.channels.filter(c => c !== 'mock').map(c => CHANNEL_NAME[c]).join('、') || '还没接真实支付'}</b><p className="s m">{x.mock ? '模拟支付开着（演示用，上线前在服务器配好微信或支付宝就会自动关掉）' : '在线支付已开通'}</p></div>
    </div>
    <p className="lb" style={{ marginTop: 24 }}>点数套餐（改了马上生效）</p>
    <div className="card">
      <div className="pkedit">
        <span className="xs m3">名称</span><span className="xs m3">价格（元）</span><span className="xs m3">点数</span><span className="xs m3">赠送</span><span className="xs m3">角标</span><span className="xs m3">到账 / 每元</span><span />
        {cfg.packages.map((p, i) => <div key={i} style={{ display: 'contents' }}>
          <input className="fld sm" value={p.n} onChange={e => setPk(i, { n: e.target.value })} aria-label="名称" />
          <input className="fld sm" type="number" min={0.01} step={0.01} value={p.price / 100} onChange={e => setPk(i, { price: Math.round(Number(e.target.value) * 100) })} aria-label="价格" />
          <input className="fld sm" type="number" min={1} value={p.points} onChange={e => setPk(i, { points: num(e.target.value) })} aria-label="点数" />
          <input className="fld sm" type="number" min={0} value={p.bonus} onChange={e => setPk(i, { bonus: num(e.target.value) })} aria-label="赠送" />
          <input className="fld sm" value={p.tag ?? ''} maxLength={6} onChange={e => setPk(i, { tag: e.target.value || undefined })} aria-label="角标" />
          <span className="s">{totalPoints(p).toLocaleString()} 点 · {(totalPoints(p) / (p.price / 100)).toFixed(1)}</span>
          <button className="lnk xs" disabled={cfg.packages.length <= 1} onClick={() => setCfg({ ...cfg, packages: cfg.packages.filter((_, j) => j !== i) })}>删</button>
        </div>)}
      </div>
      <div className="row" style={{ gap: 10, marginTop: 12 }}>
        <button className="btn g sm" disabled={cfg.packages.length >= 8} onClick={() => setCfg({ ...cfg, packages: [...cfg.packages, { id: `p${Date.now().toString(36).slice(-5)}`, n: '新套餐', price: 9900, points: 990, bonus: 0 }] })}>＋ 加一个</button>
        <span style={{ flex: 1 }} />
        <label className="row s" style={{ gap: 8 }}>大哲诊断账号解锁价（元）<input className="fld sm" id="diagPriceIn" type="number" min={1} value={cfg.diagPrice / 100} onChange={e => setCfg({ ...cfg, diagPrice: Math.round(Number(e.target.value) * 100) })} style={{ width: 100 }} /></label>
        <button className="btn y" id="billSave" onClick={async () => { try { const r = await api.admin.saveBilling(cfg); setCfg(r.config); toast('套餐已保存'); } catch (e) { fail(e); } }}>保存</button>
      </div>
    </div>
    <p className="lb" style={{ marginTop: 24 }}>订单</p>
    <div className="list" id="orderList">{x.orders.length ? x.orders.map(o => <div key={o.id} style={{ flexWrap: 'wrap' }}>
      <span style={{ flex: 1, minWidth: '50%' }}>{o.title} · <b>{yuan(o.amount)}</b><br /><span className="xs m3">{o.email ?? '未登录用户'} · {CHANNEL_NAME[o.channel]} · {new Date(o.createdAt).toLocaleString()} · {o.id}{o.tradeNo ? ` · 流水 ${o.tradeNo}` : ''}</span></span>
      <span className={`xs ${o.status === 'paid' ? 'ok' : 'm3'}`}>{STATUS_NAME[o.status]}</span>
      {o.status === 'paid' && <button className="btn g sm" onClick={async () => { if (!confirm(`把「${o.title}」标记成已退款？会扣回 ${o.points} 点。钱要在商户后台原路退。`)) return; try { const r = await api.admin.refundOrder(o.id); toast(r.note); d.reload(); } catch (e) { fail(e); } }}>标记退款</button>}
    </div>) : <div><span className="m">还没有订单</span></div>}</div>
  </div>;
}
