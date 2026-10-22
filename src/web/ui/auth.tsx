// 登录 / 注册表单。注册时匿名期间做的内容会原样带进账号。
import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { useApp } from '../store.tsx';

export function AuthForm({ onDone, initial = 'login' }: { onDone?: () => void; initial?: 'login' | 'register' }) {
  const { reloadSession, bump, toast } = useApp();
  const [mode, setMode] = useState<'login' | 'register'>(initial);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = mode === 'login' ? await api.login(email, password) : await api.register(email, password, name);
      await reloadSession(); bump(); toast(r.message); onDone?.();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : '出错了'); } finally { setBusy(false); }
  };
  return <form onSubmit={submit} id="authForm">
    <div className="seg" role="group" style={{ marginBottom: 16 }}>
      <button type="button" aria-pressed={mode === 'login'} onClick={() => setMode('login')}>登录</button>
      <button type="button" aria-pressed={mode === 'register'} onClick={() => setMode('register')}>注册</button>
    </div>
    {mode === 'register' && <><label className="lb" htmlFor="auName">名字</label><input className="fld" id="auName" autoComplete="name" value={name} onChange={e => setName(e.target.value)} required maxLength={40} /></>}
    <label className="lb" htmlFor="auEmail" style={{ marginTop: mode === 'register' ? 14 : 0 }}>邮箱</label>
    <input className="fld" id="auEmail" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
    <label className="lb" htmlFor="auPw" style={{ marginTop: 14 }}>密码 {mode === 'register' && <span className="m3">至少 8 位</span>}</label>
    <input className="fld" id="auPw" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
    {err && <p className="s" role="alert" style={{ color: 'var(--err)', marginTop: 12 }}>{err}</p>}
    <p className="note">{mode === 'register' ? '注册后，没登录时做的选题、文案、素材、排期都会带进账号。' : '登录后，没登录时新开的身份会并进账号。'}</p>
    <button className="btn y" id="auGo" type="submit" disabled={busy} style={{ width: '100%', marginTop: 14 }}>{busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}</button>
  </form>;
}

export function LoginScreen() {
  return <section className="view on"><div className="vb wrap" style={{ maxWidth: 420, paddingTop: 90 }}>
    <h1 className="d2" style={{ textAlign: 'center' }}>FIND AI × 大哲</h1>
    <p className="s m" style={{ textAlign: 'center', margin: '8px 0 28px' }}>先选题，再出片。登录后继续。</p>
    <div className="gbox" style={{ padding: 22 }}><AuthForm /></div>
  </div></section>;
}
