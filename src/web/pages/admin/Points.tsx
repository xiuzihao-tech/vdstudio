// 积分系统：按类型统计（充值、消耗、赠送、收回…）、积分口径、成片类型价格、手动调整、全站流水。
// 规则存在技能中心的「积分规则」「成片类型与价格」里（改了存版本、能回滚），这里是表单。
import { useEffect, useState } from 'react';
import { api, type PointsAdmin, type PointsConfig } from '../../api.ts';
import { useApp, useData } from '../../store.tsx';
import { Seg, Skel } from '../../ui/kit.tsx';
import { yuan } from '../../../shared/billing.ts';
import { GIFT_KINDS, KIND_NAME, type LedgerKind } from '../../../shared/points.ts';
import { Chip, Field, NumIn, Sec, Table, Tile, fmtNum, fmtTime, signed } from './ui.tsx';

const sampleOf = (pts: number, c: PointsConfig) => Math.max(c.sampleMin, Math.round((pts * c.sampleRate) / 5) * 5);

export function PointsPage() {
  const { toast, fail, nav } = useApp();
  const [days, setDays] = useState(30);
  const [q, setQ] = useState(''), [qq, setQq] = useState(''), [kind, setKind] = useState('');
  const d = useData(() => api.admin.points({ days, q: qq, kind }), [days, qq, kind]);
  const [cfg, setCfg] = useState<PointsConfig | null>(null);
  const [types, setTypes] = useState<PointsAdmin['types'] | null>(null);
  const [note, setNote] = useState('');
  const [adj, setAdj] = useState({ email: '', delta: 100, reason: '' });
  const [busy, setBusy] = useState('');
  useEffect(() => { if (d.data && !cfg) setCfg(d.data.config); if (d.data && !types) setTypes(d.data.types); }, [d.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d.data || !cfg || !types) return <Skel h={360} />;
  const x = d.data;
  const sum = (k: LedgerKind) => x.byKind.find(b => b.kind === k)?.sum ?? 0;
  const gift = GIFT_KINDS.reduce((a, k) => a + sum(k), 0);
  const set = (p: Partial<PointsConfig>) => setCfg({ ...cfg, ...p });
  const cfgDirty = JSON.stringify({ ...cfg, packages: null }) !== JSON.stringify({ ...x.config, packages: null });
  const typesDirty = JSON.stringify(types) !== JSON.stringify(x.types);
  const saveCfg = async () => {
    setBusy('cfg');
    const { packages: _p, ...rest } = cfg;
    try { const r = await api.admin.savePoints(rest, note || '积分规则'); setCfg(r.config); setNote(''); d.reload(); toast('积分规则已保存，马上生效'); } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const saveTypes = async () => {
    setBusy('types');
    try { const r = await api.admin.saveTypes(types.map(t => ({ id: t.id, pts: t.pts, secs: t.secs, enabled: t.enabled }))); setTypes(r.types); d.reload(); toast('价格已保存，前台刷新就能看到'); } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const adjust = async () => {
    if (!adj.email.trim() || !adj.delta || adj.reason.trim().length < 2) { toast('邮箱、积分数、原因都要填'); return; }
    if (!confirm(`给 ${adj.email} ${adj.delta > 0 ? '加' : '扣'} ${Math.abs(adj.delta)} 积分？原因：${adj.reason}`)) return;
    setBusy('adj');
    try { const r = await api.admin.adjust(adj.email.trim(), adj.delta, adj.reason.trim()); toast(`已${r.delta > 0 ? '加' : '扣'} ${Math.abs(r.delta)}，现在余额 ${fmtNum(r.balance)}`); setAdj({ email: '', delta: 100, reason: '' }); d.reload(); } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const period = days === 1 ? '今天' : `近 ${days} 天`;
  return <div id="admPoints">
    <div className="adm-toolbar"><Seg value={days} options={[1, 7, 30, 90, 365] as const} render={v => v === 1 ? '今天' : `近 ${v} 天`} onChange={setDays} /><span className="adm-note">1 {cfg.pointName}≈{cfg.secondsPerPoint} 秒成片</span></div>
    <div className="adm-tiles">
      <Tile label={`充值发放 · ${period}`} value={fmtNum(sum('recharge'))} />
      <Tile label={`出片消耗 · ${period}`} value={fmtNum(-sum('spend'))} sub={`失败退回 ${fmtNum(sum('refund'))}`} />
      <Tile label={`赠送发放 · ${period}`} value={fmtNum(gift)} sub="注册、邀请、返点、首充、分享" />
      <Tile label={`收回 · ${period}`} value={fmtNum(-(sum('revoke') + sum('order_refund')))} sub="退款扣回 + 奖励收回" />
      <Tile label={`管理员调整 · ${period}`} value={signed(sum('admin'))} sub={`兑换码 ${fmtNum(sum('redeem'))}`} />
      <Tile label="用户余额合计" value={fmtNum(x.balance)} sub="注册用户手里的积分" />
    </div>

    <Sec title="按类型" note={period}>
      <Table head={['类型', '笔数', '积分']} num={[1, 2]} empty="这段时间没有流水"
        rows={[...x.byKind].sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum)).map(b => [<button className="adm-link" onClick={() => { setKind(b.kind); document.getElementById('admLedger')?.scrollIntoView({ behavior: 'smooth' }); }}>{b.name}</button>, fmtNum(b.n), signed(b.sum)])} />
    </Sec>

    <Sec title="积分规则" id="admPtsCfg" note={x.version ? `技能「积分规则」第 ${x.version} 版` : '技能「积分规则」仓库默认'} extra={<button className="lnk xs" onClick={() => nav({ view: 'admin', sub: 'skills', id: 'points' })}>在技能中心看版本 ›</button>}>
      <div className="adm-card">
        <div className="adm-form">
          <Field label="积分叫什么" hint="前台显示的单位，比如「点」「积分」"><input value={cfg.pointName} maxLength={4} onChange={e => set({ pointName: e.target.value })} /></Field>
          <Field label="1 积分 ≈ 几秒成片" hint="只是说明口径，价格按下面的成片价扣"><NumIn value={cfg.secondsPerPoint} step={0.1} min={0.1} onChange={v => set({ secondsPerPoint: v })} suffix="秒" /></Field>
          <Field label="样片价 = 成片价 ×" hint="Seedance 2.5 样片模式，0.4 = 四成价"><NumIn value={cfg.sampleRate} step={0.05} min={0.05} max={1} onChange={v => set({ sampleRate: v })} /></Field>
          <Field label="样片最低" hint="样片最少扣多少"><NumIn value={cfg.sampleMin} onChange={v => set({ sampleMin: v })} suffix={cfg.pointName} /></Field>
          <Field label="每条最低" hint="改短时长后最少扣多少"><NumIn value={cfg.minCost} onChange={v => set({ minCost: v })} suffix={cfg.pointName} /></Field>
          <Field label="新访客试用积分" hint="没注册的新访客送多少；空着 = 跟服务器 INITIAL_POINTS"><input type="number" min={0} value={cfg.initialPoints ?? ''} placeholder="跟服务器设置" onChange={e => set({ initialPoints: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })} /></Field>
          <Field label="注册赠送" hint="注册成功再送（每个账号一次）"><NumIn value={cfg.signupBonus} onChange={v => set({ signupBonus: v })} suffix={cfg.pointName} /></Field>
          <Field label="余额不足提醒线" hint="低于这个数在前台提醒充值"><NumIn value={cfg.lowBalance} onChange={v => set({ lowBalance: v })} suffix={cfg.pointName} /></Field>
          <Field label="大哲诊断账号解锁价" hint="一次解锁，永久可用"><NumIn value={cfg.diagPrice / 100} step={0.01} min={0.01} onChange={v => set({ diagPrice: Math.round(v * 100) })} suffix="元" /></Field>
          <Field label="订单多久不付自动关" hint="扫码付款的有效期"><NumIn value={cfg.orderTtlMin} min={1} max={1440} onChange={v => set({ orderTtlMin: v })} suffix="分钟" /></Field>
        </div>
        <div className="adm-chips" style={{ marginTop: 14 }}>
          <input className="adm-in" placeholder="改了什么（写进版本记录）" value={note} onChange={e => setNote(e.target.value)} maxLength={200} />
          <button className="btn y" id="ptsCfgSave" disabled={!cfgDirty || !!busy} onClick={saveCfg}>{busy === 'cfg' ? '保存中…' : '保存积分规则'}</button>
          {cfgDirty && <button className="lnk xs" onClick={() => setCfg(x.config)}>放弃修改</button>}
        </div>
        <p className="adm-note" style={{ marginTop: 10 }}>充值套餐（价格、到账积分、赠送）在「<button className="lnk" onClick={() => nav({ view: 'admin', sub: 'orders' })}>充值订单</button>」页改：{x.config.packages.map(p => `${p.n} ${yuan(p.price)}→${fmtNum(p.points + p.bonus)}`).join('，')}</p>
      </div>
    </Sec>

    <Sec title="成片类型与价格" id="admTypes" note="前台「一键生成视频」按这里扣积分；停用的类型前台不显示">
      <Table head={['类型', '成片价', '推荐时长', '样片价（算出来的）', '前台显示']} num={[3]}
        rows={types.map((t, i) => [<b>{t.n}</b>,
          <NumIn value={t.pts} min={1} onChange={v => setTypes(types.map((y, j) => j === i ? { ...y, pts: Math.round(v) } : y))} suffix={cfg.pointName} />,
          <NumIn value={t.secs} min={3} max={600} onChange={v => setTypes(types.map((y, j) => j === i ? { ...y, secs: Math.round(v) } : y))} suffix="秒" />,
          fmtNum(sampleOf(t.pts, cfg)),
          <label className="adm-check"><input type="checkbox" checked={t.enabled} onChange={e => setTypes(types.map((y, j) => j === i ? { ...y, enabled: e.target.checked } : y))} />{t.enabled ? '开放' : '停用'}</label>])} />
      <div className="adm-chips" style={{ marginTop: 10 }}>
        <button className="btn y" id="typesSave" disabled={!typesDirty || !!busy} onClick={saveTypes}>{busy === 'types' ? '保存中…' : '保存价格'}</button>
        {typesDirty && <button className="lnk xs" onClick={() => setTypes(x.types)}>放弃修改</button>}
        <span className="adm-note">类型的说明、镜头结构、样片示例在技能「成片类型与价格」里改</span>
      </div>
    </Sec>

    <Sec title="手动调整" note="补偿、活动奖励、扣回违规赠送；每一笔都记进流水和操作日志">
      <div className="adm-card"><div className="adm-form">
        <Field label="用户邮箱"><input id="adjEmail" type="email" value={adj.email} onChange={e => setAdj({ ...adj, email: e.target.value })} placeholder="注册用的邮箱" /></Field>
        <Field label="加 / 扣多少" hint="负数是扣，扣到 0 为止"><NumIn id="adjDelta" value={adj.delta} min={-1000000} onChange={v => setAdj({ ...adj, delta: Math.round(v) })} suffix={cfg.pointName} /></Field>
        <Field label="原因" hint="用户在自己的流水里能看到"><input id="adjReason" value={adj.reason} maxLength={80} onChange={e => setAdj({ ...adj, reason: e.target.value })} placeholder="比如：视频生成慢的补偿" /></Field>
      </div>
      <div className="adm-chips" style={{ marginTop: 12 }}><button className="btn k" id="adjGo" disabled={!!busy} onClick={adjust}>{busy === 'adj' ? '处理中…' : '确认调整'}</button></div></div>
    </Sec>

    <Sec title="积分流水" id="admLedger" note="最近 300 笔"
      extra={<div className="adm-chips">
        <select className="adm-in" value={kind} onChange={e => setKind(e.target.value)} aria-label="按类型筛"><option value="">全部类型</option>{(Object.keys(KIND_NAME) as LedgerKind[]).map(k => <option key={k} value={k}>{KIND_NAME[k]}</option>)}</select>
        <input className="adm-in" placeholder="搜邮箱、名字、说明" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && setQq(q.trim())} />
        <button className="btn g sm" onClick={() => setQq(q.trim())}>搜</button>
        {(qq || kind) && <button className="lnk xs" onClick={() => { setQ(''); setQq(''); setKind(''); }}>清空</button>}
      </div>}>
      <Table head={['时间', '用户', '类型', '积分', '说明']} num={[3]} empty="没有符合的流水"
        rows={x.ledger.map(l => [fmtTime(l.createdAt), l.email ? <span>{l.name}<br /><span className="adm-note">{l.email}</span></span> : <span className="adm-note">未注册访客</span>,
          <Chip k={GIFT_KINDS.includes(l.kind) ? 'y' : l.kind === 'recharge' ? 'ok' : l.kind === 'revoke' || l.kind === 'order_refund' ? 'err' : ''}>{KIND_NAME[l.kind] ?? l.kind}</Chip>,
          <b className={l.delta < 0 ? 'adm-err' : 'adm-ok'}>{signed(l.delta)}</b>, l.reason])} />
    </Sec>
  </div>;
}
