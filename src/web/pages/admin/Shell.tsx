// 后台外壳（dazheip 后台同款）：明黄侧栏、「管理权限」、「管理菜单」，右边是 眉标 + 标题 + 刷新。
// 视频站的新功能直接插进 dazheip 原有菜单里（不另起分组）；dazheip 原有的几项在这边没有，点了去主站后台。
// 菜单按后台角色过滤：没有权限的页面不出现，接口也会拒绝。
import { useEffect, useState, type ReactNode } from 'react';
import { api, type AdminMenu } from '../../api.ts';
import { useApp } from '../../store.tsx';
import type { AdminPerm } from '../../../shared/admin.ts';
import { Dashboard } from './Dashboard.tsx';
import { SkillsPage } from './Skills.tsx';
import { UpstreamsPage } from './Upstreams.tsx';
import { PointsPage } from './Points.tsx';
import { ReferralPage } from './Referral.tsx';
import { JobsPage } from './Jobs.tsx';
import { AccountsPage, AuditPage } from './Accounts.tsx';
import { AdminBilling } from '../AdminBilling.tsx';
import { AdminModules } from '../AdminModules.tsx';
import { FeedbackList, Invites, Redeem, Users } from '../Admin.tsx';
import { setAsStudent } from '../../ui/mods.tsx';

export type PageId = 'overview' | 'skills' | 'upstreams' | 'points' | 'referral' | 'orders' | 'jobs' | 'users' | 'codes' | 'feedback' | 'modules' | 'accounts' | 'audit';
interface Ours { k: 'ours'; id: PageId; n: string; perm: AdminPerm; eb: string; icon: string; isNew?: boolean; d: string }
interface Dz { k: 'dz'; id: string; n: string }

/** 菜单顺序照 dazheip 后台排，新功能插在相关的位置 */
const MENU: (Ours | Dz)[] = [
  { k: 'ours', id: 'overview', n: '数据总览', perm: 'overview', eb: '内容管理', icon: 'i-grid', d: '视频站的用户、订单、出片、积分一屏看完' },
  { k: 'dz', id: 'knowledge', n: '知识与情报' },
  { k: 'dz', id: 'strategy', n: '策略中心' },
  { k: 'dz', id: 'persona', n: '默认人设' },
  { k: 'dz', id: 'samples', n: '样本案例' },
  { k: 'dz', id: 'compliance', n: '合规规则' },
  { k: 'ours', id: 'skills', n: '技能中心', perm: 'skills', eb: 'AI 视频 · 技能', icon: 'i-chip', isNew: true, d: '每个功能一个技能包：提示词、规则、价格都在这里改，存版本、能回滚' },
  { k: 'ours', id: 'upstreams', n: '上游接口', perm: 'upstreams', eb: 'AI 视频 · 接口', icon: 'i-plug', isNew: true, d: '大模型、视频、配音、支付的地址和密钥；保存马上生效，不用重启' },
  { k: 'dz', id: 'members', n: '会员管理' },
  { k: 'ours', id: 'users', n: '视频站用户', perm: 'users', eb: '用户', icon: 'i-users', d: '注册用户、余额、生成次数' },
  { k: 'ours', id: 'points', n: '积分系统', perm: 'points', eb: '积分与订单', icon: 'i-coin', isNew: true, d: '积分口径、成片价格、流水、手动调整' },
  { k: 'ours', id: 'referral', n: '邀请赠送', perm: 'referral', eb: '积分与订单', icon: 'i-gift', isNew: true, d: '分享链接 → 好友注册 → 好友充值，双方得积分' },
  { k: 'ours', id: 'orders', n: '充值订单', perm: 'orders', eb: '积分与订单', icon: 'i-receipt', d: '充值套餐、诊断价格、订单和退款' },
  { k: 'ours', id: 'jobs', n: '出片任务', perm: 'jobs', eb: 'AI 视频', icon: 'i-film', isNew: true, d: '全站的样片、成片任务；失败原因、人工退点' },
  { k: 'ours', id: 'codes', n: '兑换码与邀请码', perm: 'codes', eb: '用户', icon: 'i-ticket', d: '线下收款发兑换码；邀请制下发邀请码' },
  { k: 'dz', id: 'notice', n: '通知管理' },
  { k: 'dz', id: 'service', n: '在线客服' },
  { k: 'ours', id: 'feedback', n: '用户反馈', perm: 'feedback', eb: '用户', icon: 'i-chat', d: '页面右下角「提意见」收到的反馈' },
  { k: 'dz', id: 'course', n: '实战课堂' },
  { k: 'ours', id: 'modules', n: '模块开关', perm: 'modules', eb: '系统', icon: 'i-toggle', d: '哪些功能开放、预告、内测，诊断解锁价，文件保存期限' },
  { k: 'ours', id: 'accounts', n: '后台账号', perm: 'admins', eb: '系统', icon: 'i-key', isNew: true, d: '谁能进后台、能看哪些页面' },
  { k: 'ours', id: 'audit', n: '操作日志', perm: 'audit', eb: '系统', icon: 'i-log', isNew: true, d: '后台每一次修改：谁、什么时候、改了什么' },
  { k: 'dz', id: 'settings', n: '系统设置' },
];
const OURS = MENU.filter((m): m is Ours => m.k === 'ours');

export function AdminShell() {
  const { session, route, nav, bump, toast, fail, reloadSession } = useApp();
  const me = session!.admin!;
  const [dz, setDz] = useState<{ base: string; menu: AdminMenu[] } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { api.admin.me().then(r => setDz(r.dazheip)).catch(() => undefined); }, []);
  useEffect(() => { document.title = '大哲 IP研究院 · 管理后台'; return () => { document.title = 'FIND AI × 大哲 视频工作室'; }; }, []);
  const allowed = OURS.filter(m => me.perms.includes(m.perm));
  const cur = allowed.find(m => m.id === route.sub) ?? allowed[0];
  const go = (id: PageId) => { setOpen(false); nav({ view: 'admin', sub: id }); };
  const dzUrl = (id: string) => dz?.menu.find(m => m.id === id)?.url ?? `https://www.dazheip.com/admin/${id}`;
  const logout = async () => { try { await api.logout(); await reloadSession(); toast('已退出后台'); } catch (e) { fail(e); } };
  if (!cur) return <div className="adm"><main className="adm-main"><p>这个后台账号还没有分配能看的页面，找超级管理员在「后台账号」里设置。</p></main></div>;
  return <div className="adm" id="adm">
    <aside className={`adm-side${open ? ' open' : ''}`}>
      <div className="adm-logo"><b>大哲 IP研究院</b><small>DA ZHE IP RESEARCH INSTITUTE</small></div>
      <div className="adm-perm" id="admPerm"><span>管理权限</span><b>{me.roleName}</b><small>{me.email}</small></div>
      <button className="adm-menubtn" aria-expanded={open} onClick={() => setOpen(!open)}>管理菜单 · {cur.n} <span aria-hidden="true">{open ? '▴' : '▾'}</span></button>
      <p className="adm-lb">管理菜单</p>
      <nav className="adm-nav" aria-label="管理菜单">
        {MENU.map(m => m.k === 'dz'
          ? <a key={m.id} href={dzUrl(m.id)} target="_blank" rel="noopener" title="在大哲 IP 主站后台打开"><Ico id="i-ext" />{m.n}<span className="ext">↗</span></a>
          : me.perms.includes(m.perm) && <button key={m.id} data-adm={m.id} aria-current={cur.id === m.id ? 'page' : undefined} onClick={() => go(m.id)}><Ico id={m.icon} />{m.n}{m.isNew && <span className="new">新</span>}</button>)}
      </nav>
      <div className="adm-foot">
        <button id="admBack" onClick={() => { setAsStudent(false); nav('make'); }} title="管理员视角：没开放的模块也能看到"><Ico id="i-back" />返回前台</button>
        <button id="admAsStudent" onClick={() => { setAsStudent(true); nav('make'); }} title="和学员看到的一样"><Ico id="i-users" />按学员看前台</button>
        <button id="admOut" onClick={logout}><Ico id="i-out" />退出登录</button>
      </div>
    </aside>
    <main className="adm-main" id="admMain">
      <header className="adm-hd">
        <div><p className="eb">{cur.eb}</p><h1>{cur.n}</h1><p className="adm-sub">{cur.d}</p></div>
        <span className="sp" />
        <button className="btn g" id="admRefresh" onClick={() => { bump(); toast('已刷新'); }}>刷新</button>
      </header>
      <Page id={cur.id} />
    </main>
  </div>;
}

function Page({ id }: { id: PageId }): ReactNode {
  switch (id) {
    case 'overview': return <Dashboard />;
    case 'skills': return <SkillsPage />;
    case 'upstreams': return <UpstreamsPage />;
    case 'points': return <PointsPage />;
    case 'referral': return <ReferralPage />;
    case 'orders': return <AdminBilling />;
    case 'jobs': return <JobsPage />;
    case 'users': return <Users />;
    case 'codes': return <><Invites /><div style={{ height: 28 }} /><Redeem /></>;
    case 'feedback': return <FeedbackList />;
    case 'modules': return <AdminModules />;
    case 'accounts': return <AccountsPage />;
    case 'audit': return <AuditPage />;
  }
}

const Ico = ({ id }: { id: string }) => <svg aria-hidden="true"><use href={`#${id}`} /></svg>;
