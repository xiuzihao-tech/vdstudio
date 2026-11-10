// 后台账号：服务器 ADMIN_EMAILS 里的是超级管理员（这里改不了）；其余后台账号在这里加，按角色给能看的页面。
// 操作日志：后台每一次修改都记一条（谁、什么时候、改了什么），密钥只记改了哪些字段、不记内容。
import { useState } from 'react';
import { api } from '../../api.ts';
import { useApp, useData } from '../../store.tsx';
import { Skel } from '../../ui/kit.tsx';
import type { AdminPerm, AdminRole } from '../../../shared/admin.ts';
import { Chip, Field, Sec, Table, fmtTime } from './ui.tsx';
import { ask } from '../../ui/dialog.tsx';

const PERM_NAME: Record<AdminPerm, string> = { overview: '数据总览', skills: '技能中心', upstreams: '上游接口', points: '积分系统', referral: '邀请赠送', orders: '充值订单', jobs: '出片任务', users: '视频站用户', modules: '模块开关', codes: '兑换码与邀请码', feedback: '用户反馈', admins: '后台账号', audit: '操作日志' };

export function AccountsPage() {
  const { session, toast, fail } = useApp();
  const d = useData(() => api.admin.admins(), []);
  const [f, setF] = useState<{ email: string; role: AdminRole; note: string }>({ email: '', role: 'ops', note: '' });
  if (!d.data) return <Skel h={300} />;
  const x = d.data, roles = Object.keys(x.roles) as AdminRole[];
  const add = async (email = f.email, role = f.role, note = f.note) => {
    if (!email.trim()) { toast('填一下邮箱'); return; }
    try { await api.admin.addAdmin(email.trim(), role, note); toast(`${email} 现在是「${x.roles[role].n}」，用这个邮箱注册 / 登录就能进后台`); setF({ email: '', role: 'ops', note: '' }); d.reload(); } catch (e) { fail(e); }
  };
  const remove = async (email: string) => {
    if (!await ask(`删掉后台账号 ${email}？删了以后这个账号进不了后台（前台照常用）。`)) return;
    try { await api.admin.removeAdmin(email); toast('已删除'); d.reload(); } catch (e) { fail(e); }
  };
  return <div id="admAccounts">
    <Sec title="角色和能看的页面">
      <Table head={['角色', '适合谁', '能看的页面']} rows={roles.map(r => [<b>{x.roles[r].n}</b>, x.roles[r].d, <span className="adm-chips">{x.roles[r].perms.map(p => <Chip key={p}>{PERM_NAME[p]}</Chip>)}</span>])} />
      <p className="adm-note" style={{ marginTop: 8 }}>退款要「充值订单」+「积分系统」两个权限（财务、超级管理员）；客服能看订单，退不了款。</p>
    </Sec>
    <Sec title="超级管理员" note="服务器 .env 的 ADMIN_EMAILS 里配的，这里改不了">
      <div className="adm-chips">{x.supers.length ? x.supers.map(e => <Chip key={e} k="dark">{e}</Chip>) : <span className="adm-note">没配</span>}</div>
    </Sec>
    <Sec title="后台账号" id="admAdmins">
      <Table head={['邮箱', '角色', '备注', '谁加的', '时间', '']} empty="还没有加别的后台账号"
        rows={x.admins.map(a => [<b>{a.email}</b>,
          <select className="adm-in" value={a.role} onChange={e => void add(a.email, e.target.value as AdminRole, a.note)} aria-label="角色">{roles.map(r => <option key={r} value={r}>{x.roles[r].n}</option>)}</select>,
          a.note || '—', a.createdBy || '—', fmtTime(a.createdAt, true),
          a.email !== session?.admin?.email ? <button className="btn g sm" data-deladmin={a.email} onClick={() => remove(a.email)}>删除</button> : <span className="adm-note">你自己</span>])} />
      <div className="adm-card" style={{ marginTop: 14 }}>
        <div className="adm-form">
          <Field label="邮箱" hint="对方用这个邮箱注册 / 登录后就能进后台"><input id="admNewEmail" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="name@example.com" /></Field>
          <Field label="角色"><select id="admNewRole" value={f.role} onChange={e => setF({ ...f, role: e.target.value as AdminRole })}>{roles.map(r => <option key={r} value={r}>{x.roles[r].n} · {x.roles[r].d}</option>)}</select></Field>
          <Field label="备注"><input value={f.note} maxLength={40} onChange={e => setF({ ...f, note: e.target.value })} placeholder="比如：运营小王" /></Field>
        </div>
        <div className="adm-chips" style={{ marginTop: 12 }}><button className="btn y" id="admNewGo" onClick={() => void add()}>加后台账号</button></div>
      </div>
    </Sec>
  </div>;
}

export function AuditPage() {
  const [q, setQ] = useState(''), [qq, setQq] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const d = useData(() => api.admin.audit(qq), [qq]);
  if (!d.data) return <Skel h={300} />;
  const pretty = (s: string | null) => { if (!s) return ''; try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } };
  return <div id="admAudit">
    <div className="adm-toolbar">
      <input className="adm-in" placeholder="搜人、操作、对象" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && setQq(q.trim())} />
      <button className="btn g sm" onClick={() => setQq(q.trim())}>搜</button>
      {qq && <button className="lnk xs" onClick={() => { setQ(''); setQq(''); }}>清空</button>}
      <span className="adm-note">最近 300 条；上游接口的密钥只记改了哪些字段，不记内容</span>
    </div>
    <Table id="admAuditTbl" head={['时间', '谁', '做了什么', '对象', '详情']} empty="还没有操作记录"
      rows={d.data.items.map(a => [fmtTime(a.createdAt, true), a.actor, <b>{a.action}</b>, <code>{a.target}</code>,
        a.detail ? (open === a.id ? <pre className="adm-pre sm" onClick={() => setOpen(null)}>{pretty(a.detail)}</pre> : <button className="lnk xs" onClick={() => setOpen(a.id)}>{a.detail.length > 60 ? `${a.detail.slice(0, 60)}…` : a.detail}</button>) : ''])} />
  </div>;
}
