// 数据总览（dazheip 后台「数据总览」同款）：一排描边数据块 + 黑表头的「成片类型覆盖」表（对应主站的「品类样本覆盖」），
// 再往下是价格表、近 14 天、服务接入情况和使用漏斗。主站的样本、知识、会员数据还在 dazheip 后台的数据总览里。
import { useState } from 'react';
import { api } from '../../api.ts';
import { useApp, useData } from '../../store.tsx';
import { Seg, Skel } from '../../ui/kit.tsx';
import { yuan } from '../../../shared/billing.ts';
import { Overview } from '../Admin.tsx';
import { Bar, Chip, Sec, Table, Tile, fmtNum } from './ui.tsx';

const AI_NAME: Record<string, string> = { mock: '模拟', llm: '大模型', seedance: '方舟 Seedance', newapi: '土豆网关', minimax: 'MiniMax', none: '没接' };

export function Dashboard() {
  const { nav } = useApp();
  const [days, setDays] = useState(30);
  const d = useData(() => api.admin.dashboard(days), [days]);
  if (!d.data) return <Skel h={360} />;
  const x = d.data, t = x.tiles;
  const fails = t.jobs ? Math.round((t.failed / t.jobs) * 100) : 0;
  const maxU = Math.max(1, ...x.trend.map(r => r.users)), maxJ = Math.max(1, ...x.trend.map(r => r.jobs)), maxA = Math.max(1, ...x.trend.map(r => r.amount));
  const period = days === 1 ? '今天' : `近 ${days} 天`;
  return <div id="admDash">
    <div className="adm-toolbar"><Seg value={days} options={[1, 7, 30, 90] as const} render={v => v === 1 ? '今天' : `近 ${v} 天`} onChange={setDays} /><span className="adm-note">数字块里带「{period}」的按这个时间段算，其余是累计</span></div>
    <div className="adm-tiles" id="admTiles">
      <Tile label="用户数量" value={fmtNum(t.users)} sub={`今天新增 ${t.usersNew}`} />
      <Tile label="付费用户" value={fmtNum(t.payers)} sub="充过值或解锁过诊断" />
      <Tile label="已支付订单" value={fmtNum(t.orders)} sub={`诊断解锁 ${t.diagUnlocks} 单`} />
      <Tile label="已付费金额总计" value={yuan(t.revenue)} sub={`${period} ${yuan(t.revenuePeriod)}`} />
      <Tile label={`出片任务 · ${period}`} value={fmtNum(t.jobs)} sub={`成片 ${t.finals} · 样片 ${t.jobs - t.finals}`} />
      <Tile label={`失败 · ${period}`} value={fmtNum(t.failed)} sub={`失败率 ${fails}%（自动退点）`} tone={fails >= 20 ? 'err' : fails >= 8 ? 'warn' : undefined} />
      <Tile label={`消耗积分 · ${period}`} value={fmtNum(t.spent)} sub="出片扣的，已减去失败退回" />
      <Tile label={`充值发放 · ${period}`} value={fmtNum(t.issuedPaid)} sub="真金白银买的积分" />
      <Tile label={`赠送发放 · ${period}`} value={fmtNum(t.issuedGift)} sub="注册、邀请、返点、首充、分享" />
      <Tile label="用户余额合计" value={fmtNum(t.balance)} sub="注册用户手里还没用的积分" />
      <Tile label={`邀请注册 · ${period}`} value={fmtNum(t.referrals)} sub={<button className="lnk xs" onClick={() => nav({ view: 'admin', sub: 'referral' })}>看邀请赠送 ›</button>} />
      <Tile label="技能包" value={fmtNum(t.skills)} sub={<button className="lnk xs" onClick={() => nav({ view: 'admin', sub: 'skills' })}>后台改过 {t.skillsEdited} 个 ›</button>} />
      <Tile label="上游接口" value={`${t.upstreamsOn}/${t.upstreams}`} sub={<button className="lnk xs" onClick={() => nav({ view: 'admin', sub: 'upstreams' })}>已接通 ›</button>} tone={t.upstreamsOn ? undefined : 'warn'} />
      <Tile label="待处理反馈" value={fmtNum(t.feedbackNew)} sub={<button className="lnk xs" onClick={() => nav({ view: 'admin', sub: 'feedback' })}>去处理 ›</button>} tone={t.feedbackNew ? 'warn' : undefined} />
    </div>

    <Sec title="成片类型覆盖" note={`${period}的出片任务按成片类型分`} id="admCoverage">
      <Table head={['成片类型', '任务数', '成片', '样片', '失败', '消耗积分']} num={[1, 2, 3, 4, 5]} empty="这段时间还没有出片任务"
        rows={x.coverage.map(c => [<b>{c.name}</b>, fmtNum(c.n), fmtNum(c.final), fmtNum(c.sample), c.failed ? <span className="adm-err">{c.failed}</span> : 0, fmtNum(c.cost)])} />
    </Sec>

    <Sec title="成片类型与价格" note="前台「一键生成视频」显示的价格；样片 = 成片 × 样片比例" extra={<button className="btn g sm" onClick={() => nav({ view: 'admin', sub: 'points' })}>改价格</button>}>
      <Table head={['类型', '成片价（积分）', '样片价', '推荐时长', '状态']} num={[1, 2, 3]}
        rows={x.typePrices.map(p => [p.n, fmtNum(p.pts), fmtNum(p.sample), `${p.secs} 秒`, p.enabled ? <Chip k="ok">开放</Chip> : <Chip>已停用</Chip>])} />
    </Sec>

    <Sec title="近 14 天" note="每天的新注册、出片任务和收入">
      <Table head={['日期', '新用户', '', '出片任务', '', '收入', '']} num={[1, 3, 5]}
        rows={x.trend.map(r => [r.day.slice(5), r.users, <Bar v={r.users} max={maxU} />, r.jobs, <Bar v={r.jobs} max={maxJ} />, yuan(r.amount), <Bar v={r.amount} max={maxA} />])} />
    </Sec>

    <Sec title="服务接入" extra={<button className="btn g sm" onClick={() => nav({ view: 'admin', sub: 'upstreams' })}>去上游接口</button>}>
      <div className="adm-kv">
        <div><span>文案大模型</span><b>{AI_NAME[x.ai.copy] ?? x.ai.copy}</b></div>
        <div><span>视频生成</span><b>{AI_NAME[x.ai.video] ?? x.ai.video}</b></div>
        <div><span>配音</span><b>{AI_NAME[x.ai.tts] ?? x.ai.tts}</b></div>
        <div><span>看素材</span><b>{AI_NAME[x.ai.vision] ?? x.ai.vision}</b></div>
        <div><span>在线支付</span><b>{x.pay.channels.filter(c => c !== 'mock').map(c => c === 'wechat' ? '微信' : '支付宝').join('、') || '还没接'}{x.pay.mock ? ' · 模拟支付开着' : ''}</b></div>
      </div>
    </Sec>

    <Sec title="使用漏斗" note="做过这一步的人数（按账号去重）；右边的开关能暂停全站生成">
      <Overview compact />
    </Sec>
    <p className="adm-note" style={{ marginTop: 18 }}>主站的样本、知识节点、会员记录在大哲 IP 主站后台的「数据总览」里。</p>
  </div>;
}
