// 邀请赠送：分享链接 → 好友注册（双方得积分）→ 好友充值（邀请人返点、好友首充奖励）。
// 防刷：每天 / 每月上限、同一网络 24 小时限次；发现刷号能整条「收回奖励」。规则存在技能「邀请赠送」里，改了存版本。
import { useEffect, useState } from 'react';
import { api, type ReferralConfig, type RefStatus } from '../../api.ts';
import { useApp, useData } from '../../store.tsx';
import { Seg, Skel } from '../../ui/kit.tsx';
import { yuan } from '../../../shared/billing.ts';
import { KIND_NAME, type LedgerKind } from '../../../shared/points.ts';
import { Chip, Field, NumIn, Sec, Table, Tile, fmtNum, fmtTime } from './ui.tsx';
import { askText } from '../../ui/dialog.tsx';

const ST: Record<RefStatus, ['ok' | 'warn' | 'err' | '', string]> = { rewarded: ['ok', '已奖励'], pending: ['warn', '等好友出片 / 充值'], capped: ['', '超过上限'], blocked: ['err', '同网络重复'], revoked: ['err', '已收回'] };
const ON: Record<ReferralConfig['invite']['rewardOn'], string> = { register: '好友注册成功就发', first_gen: '好友第一次出片成功后发', first_pay: '好友第一次充值后发' };
/** 和服务端 rulesText 一样的替换，改的时候就能预览 */
const rulesOf = (c: ReferralConfig) => {
  const v: Record<string, string> = { inviter: String(c.invite.inviterPoints), invitee: String(c.invite.inviteePoints), rate: `${Math.round(c.rebate.rate * 100)}%`, days: String(c.rebate.days), dailyCap: String(c.invite.dailyCap), monthlyCap: String(c.invite.monthlyCap) };
  return c.rules.map(r => r.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m)).filter(r => !(c.rebate.rate <= 0 && /充值/.test(r) && /返|再得/.test(r)));
};

export function ReferralPage() {
  const { toast, fail, nav } = useApp();
  const [days, setDays] = useState(30);
  const [status, setStatus] = useState<'' | RefStatus>('');
  const [q, setQ] = useState(''), [qq, setQq] = useState('');
  const d = useData(() => api.admin.referral({ days, status, q: qq }), [days, status, qq]);
  const [c, setC] = useState<ReferralConfig | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { if (d.data && !c) setC(d.data.config); }, [d.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d.data || !c) return <Skel h={360} />;
  const x = d.data, s = x.stats;
  const dirty = JSON.stringify(c) !== JSON.stringify(x.config);
  const inv = (p: Partial<ReferralConfig['invite']>) => setC({ ...c, invite: { ...c.invite, ...p } });
  const reb = (p: Partial<ReferralConfig['rebate']>) => setC({ ...c, rebate: { ...c.rebate, ...p } });
  const save = async () => {
    setBusy('save');
    try { const r = await api.admin.saveReferral({ ...c, rules: c.rules.map(x => x.trim()).filter(Boolean) }, note || '邀请赠送规则'); setC(r.config); setNote(''); d.reload(); toast('邀请赠送规则已保存，马上生效'); } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const revoke = async (id: string, who: string) => {
    const why = await askText(`收回「${who}」这条邀请发出的全部积分（邀请人和好友的都收回，扣到 0 为止）。写一下原因：`, '刷号');
    if (why === null) return;
    if (why.trim().length < 2) { toast('原因至少写两个字'); return; }
    try { const r = await api.admin.revokeReferral(id, why.trim()); toast(`收回了 ${fmtNum(r.back)} 积分`); d.reload(); } catch (e) { fail(e); }
  };
  const pts = Object.entries(s.points) as [LedgerKind, number][];
  const period = days === 1 ? '今天' : `近 ${days} 天`;
  return <div id="admRef">
    <div className="adm-toolbar"><Seg value={days} options={[1, 7, 30, 90, 365] as const} render={v => v === 1 ? '今天' : `近 ${v} 天`} onChange={setDays} />
      {!x.config.enabled && <Chip k="err">邀请赠送已关闭</Chip>}</div>
    <div className="adm-tiles">
      <Tile label={`链接打开 · ${period}`} value={fmtNum(s.clicks)} sub="分享出去的链接被点开的次数" />
      <Tile label={`邀请注册 · ${period}`} value={fmtNum(s.registrations)} sub={`发了奖励 ${s.rewarded}`} />
      <Tile label={`好友充值 · ${period}`} value={fmtNum(s.payers)} sub={`共 ${yuan(s.payAmount)}`} />
      <Tile label={`发出积分 · ${period}`} value={fmtNum(pts.reduce((a, [, n]) => a + n, 0))} sub={pts.length ? pts.map(([k, n]) => `${KIND_NAME[k] ?? k} ${fmtNum(n)}`).join(' · ') : '还没发'} />
      <Tile label="注册转化" value={s.clicks ? `${Math.round((s.registrations / s.clicks) * 100)}%` : '—'} sub="注册 ÷ 打开" />
      <Tile label="充值转化" value={s.registrations ? `${Math.round((s.payers / s.registrations) * 100)}%` : '—'} sub="充值好友 ÷ 注册好友" />
    </div>

    <Sec title="规则" id="admRefCfg" note={x.version ? `技能「邀请赠送」第 ${x.version} 版` : '技能「邀请赠送」仓库默认'} extra={<button className="lnk xs" onClick={() => nav({ view: 'admin', sub: 'skills', id: 'referral' })}>在技能中心看版本 ›</button>}>
      <div className="adm-card">
        <label className="adm-check big"><input type="checkbox" id="refOn" checked={c.enabled} onChange={e => setC({ ...c, enabled: e.target.checked })} />开启邀请赠送（关了以后分享链接还能打开，但不再发奖励）</label>
        <p className="adm-lb2">好友注册</p>
        <div className="adm-form">
          <Field label="邀请人得"><NumIn id="refInviter" value={c.invite.inviterPoints} onChange={v => inv({ inviterPoints: Math.round(v) })} suffix="积分" /></Field>
          <Field label="好友得" hint="好友在注册赠送之外再得"><NumIn id="refInvitee" value={c.invite.inviteePoints} onChange={v => inv({ inviteePoints: Math.round(v) })} suffix="积分" /></Field>
          <Field label="什么时候发" hint="越往后越防刷，但拉新动力弱一些"><select id="refOnWhen" value={c.invite.rewardOn} onChange={e => inv({ rewardOn: e.target.value as ReferralConfig['invite']['rewardOn'] })}>{(Object.keys(ON) as (keyof typeof ON)[]).map(k => <option key={k} value={k}>{ON[k]}</option>)}</select></Field>
          <Field label="每人每天最多奖励" hint="超过的好友照样拿自己那份；0 = 不限"><NumIn value={c.invite.dailyCap} onChange={v => inv({ dailyCap: Math.round(v) })} suffix="个" /></Field>
          <Field label="每人每月最多奖励" hint="近 30 天；0 = 不限"><NumIn value={c.invite.monthlyCap} onChange={v => inv({ monthlyCap: Math.round(v) })} suffix="个" /></Field>
          <Field label="同一网络 24 小时最多" hint="同一个 IP 用同一个邀请码注册超过这个数不发；0 = 不限"><NumIn value={c.invite.ipDailyLimit} onChange={v => inv({ ipDailyLimit: Math.round(v) })} suffix="个" /></Field>
        </div>
        <p className="adm-lb2">好友充值</p>
        <div className="adm-form">
          <Field label="邀请人返点" hint="好友充值到账积分的百分之几；0 = 不返"><NumIn id="refRate" value={Math.round(c.rebate.rate * 1000) / 10} step={1} max={100} onChange={v => reb({ rate: Math.max(0, Math.min(100, v)) / 100 })} suffix="%" /></Field>
          <Field label="返哪几次"><select value={c.rebate.scope} onChange={e => reb({ scope: e.target.value as 'first' | 'all' })}><option value="all">好友每次充值都返</option><option value="first">只返好友第一次充值</option></select></Field>
          <Field label="返点有效期" hint="好友注册后多少天内的充值才返；0 = 一直返"><NumIn value={c.rebate.days} onChange={v => reb({ days: Math.round(v) })} suffix="天" /></Field>
          <Field label="每个好友最多返" hint="0 = 不封顶"><NumIn value={c.rebate.capPerInvitee} onChange={v => reb({ capPerInvitee: Math.round(v) })} suffix="积分" /></Field>
          <Field label="首充奖励（固定）" hint="任何人第一次充值都送，不管是不是被邀请的"><NumIn id="refFirst" value={c.firstRecharge.fixed} onChange={v => setC({ ...c, firstRecharge: { ...c.firstRecharge, fixed: Math.round(v) } })} suffix="积分" /></Field>
          <Field label="首充奖励（比例）" hint="再加到账积分的百分之几"><NumIn value={Math.round(c.firstRecharge.rate * 1000) / 10} max={200} onChange={v => setC({ ...c, firstRecharge: { ...c.firstRecharge, rate: Math.max(0, v) / 100 } })} suffix="%" /></Field>
        </div>
        <p className="adm-lb2">分享</p>
        <div className="adm-form">
          <Field label="每天第一次分享奖励" hint="点「复制链接 / 生成海报」算分享；0 = 不发"><NumIn value={c.shareDaily} onChange={v => setC({ ...c, shareDaily: Math.round(v) })} suffix="积分" /></Field>
          <Field label="分享标题"><input value={c.shareTitle} maxLength={60} onChange={e => setC({ ...c, shareTitle: e.target.value })} /></Field>
          <Field label="分享文案" wide><textarea rows={2} value={c.shareText} maxLength={200} onChange={e => setC({ ...c, shareText: e.target.value })} /></Field>
          <Field label="规则说明（前台「邀请有礼」显示，一行一条）" wide hint="可以用 {inviter} {invitee} {rate} {days} {dailyCap} {monthlyCap}，会换成上面的数">
            <textarea rows={Math.max(3, c.rules.length + 1)} value={c.rules.join('\n')} onChange={e => setC({ ...c, rules: e.target.value.split('\n').map(r => r.slice(0, 120)) })} /></Field>
        </div>
        <div className="adm-preview"><b>前台会显示：</b><ol>{rulesOf({ ...c, rules: c.rules.filter(r => r.trim()) }).map((r, i) => <li key={i}>{r}</li>)}</ol></div>
        <div className="adm-chips" style={{ marginTop: 12 }}>
          <input className="adm-in" placeholder="改了什么（写进版本记录）" value={note} onChange={e => setNote(e.target.value)} maxLength={200} />
          <button className="btn y" id="refSave" disabled={!dirty || !!busy} onClick={() => void save()}>{busy === 'save' ? '保存中…' : '保存规则'}</button>
          {dirty && <button className="lnk xs" onClick={() => setC(x.config)}>放弃修改</button>}
        </div>
      </div>
    </Sec>

    {s.top.length > 0 && <Sec title="邀请排行" note={period}>
      <Table head={['邀请人', '邀请', '发了奖励', '累计得到']} num={[1, 2, 3]}
        rows={s.top.map(t => [<span>{t.name ?? '—'}<br /><span className="adm-note">{t.email}</span></span>, fmtNum(t.n), fmtNum(t.ok), fmtNum(t.earned)])} />
    </Sec>}

    <Sec title="邀请记录" id="admRefList" note="最近 200 条"
      extra={<div className="adm-chips">
        <select className="adm-in" value={status} onChange={e => setStatus(e.target.value as '' | RefStatus)} aria-label="按状态筛"><option value="">全部状态</option>{(Object.keys(ST) as RefStatus[]).map(k => <option key={k} value={k}>{ST[k][1]}</option>)}</select>
        <input className="adm-in" placeholder="搜邮箱、邀请码" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && setQq(q.trim())} />
        <button className="btn g sm" onClick={() => setQq(q.trim())}>搜</button>
      </div>}>
      <Table head={['时间', '邀请人', '好友', '状态', '邀请人得', '好友得', '好友充值', '网络', '']} num={[4, 5, 6]} empty="还没有邀请记录"
        rows={x.list.map(r => [fmtTime(r.createdAt),
          <span>{r.inviterName ?? '—'}<br /><span className="adm-note">{r.inviter} · {r.code}</span></span>,
          <span>{r.inviteeName ?? '—'}<br /><span className="adm-note">{r.invitee}</span></span>,
          <span><Chip k={ST[r.status][0]}>{ST[r.status][1]}</Chip>{r.note && <><br /><span className="adm-note">{r.note}</span></>}</span>,
          fmtNum(r.inviterPoints), fmtNum(r.inviteePoints), r.paid ? yuan(r.paid) : '—', <span className="adm-note">{r.ip ?? '—'}</span>,
          r.status !== 'revoked' && (r.inviterPoints + r.inviteePoints > 0 || r.status === 'pending') ? <button className="btn g sm" data-revoke={r.id} onClick={() => revoke(r.id, `${r.inviter} → ${r.invitee}`)}>收回</button> : null])} />
    </Sec>
  </div>;
}
