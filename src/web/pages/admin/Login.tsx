// 后台登录页（/admin）：后台不在前台显示，只有后台账号（ADMIN_EMAILS 里的超级管理员，或「后台账号」里加的）能登进去。
// 不是后台账号：不给登录，也不动前台的登录状态。
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api.ts';
import { useApp } from '../../store.tsx';

export function AdminLogin() {
  const { session, reloadSession, nav, toast } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<{ email: string; password: string } | null>(null);
  useEffect(() => { api.authConfig().then(c => setDemo(c.demoLogin ?? null)).catch(() => undefined); }, []);
  useEffect(() => { document.title = '大哲 IP研究院 · 后台登录'; }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { const r = await api.adminLogin(email.trim(), password); await reloadSession(); toast(`欢迎回来，${r.me.roleName}`); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : '登录失败'); } finally { setBusy(false); }
  };
  const other = session?.user && !session.admin;
  return <div className="adm-login" id="admLogin">
    <aside className="adm-login-side">
      <div><b>大哲 IP研究院</b><small>DA ZHE IP RESEARCH INSTITUTE</small></div>
      <p>视频站管理后台：数据总览、技能中心、上游接口、积分系统、邀请赠送、充值订单、出片任务。只有开通了后台权限的账号能登录。</p>
    </aside>
    <main className="adm-login-main">
      <form className="adm-login-card" onSubmit={submit}>
        <h1>后台登录</h1>
        <p className="sub">用开通了后台权限的邮箱和密码登录</p>
        {other && <p className="err" style={{ marginTop: 0 }}>现在登录的 {session.user!.email} 没有后台权限，换一个后台账号登录。</p>}
        <label htmlFor="admEmail">邮箱</label>
        <input id="admEmail" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required />
        <label htmlFor="admPw">密码</label>
        <input id="admPw" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
        {err && <p className="err" role="alert">{err}</p>}
        <button className="go" id="admGo" type="submit" disabled={busy}>{busy ? '登录中…' : '登录后台'}</button>
        {demo && <p className="demo" id="admDemo">演示账号：{demo.email} / {demo.password}<button type="button" onClick={() => { setEmail(demo.email); setPassword(demo.password); }}>填入</button></p>}
        <button type="button" className="back" onClick={() => nav('make')}>回到前台</button>
      </form>
    </main>
  </div>;
}
