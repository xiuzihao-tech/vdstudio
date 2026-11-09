// 邀请有礼（前台）：记下打开的分享链接（?ref=邀请码）、注册时带上；「余额与充值」里的邀请卡片（链接、海报、规则、记录）；
// 被邀请的新访客顶部提示「注册多送 N 点」。奖励多少、什么时候发都在后台「邀请赠送」里改。
import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { api } from '../api.ts';
import { useApp, useData } from '../store.tsx';
import { AuthForm } from './auth.tsx';

const KEY = 'findai.ref', CLICKED = 'findai.refclick';

/** 打开页面时：地址里有 ?ref= 就记下来（注册时带上），并告诉服务端链接被打开了一次（同一个会话只算一次） */
export function captureRef() {
  try {
    const c = (new URLSearchParams(location.search).get('ref') ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,20}$/.test(c)) return;
    localStorage.setItem(KEY, c);
    if (sessionStorage.getItem(CLICKED) !== c) { sessionStorage.setItem(CLICKED, c); void api.referral.click(c).catch(() => undefined); }
  } catch { /* 隐私模式下存不了，不影响使用 */ }
}
export const refCode = () => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };
export const clearRef = () => { try { localStorage.removeItem(KEY); } catch { /* 忽略 */ } };

/** 分享链接：正常部署用 域名/?ref=码；离线单文件版（地址带 #）用当前页面地址 */
export const inviteLink = (code: string) => {
  const hash = !!(window as unknown as { __HASH_ROUTES?: boolean }).__HASH_ROUTES;
  const base = hash || location.protocol === 'file:' ? location.href.split(/[?#]/)[0] : `${location.origin}/`;
  return `${base}?ref=${encodeURIComponent(code)}`;
};

/** 被邀请的新访客：顶部一条提示，点了直接注册 */
export function RefBanner() {
  const { session, sheet } = useApp();
  const [pv, setPv] = useState<{ name: string; bonus: number } | null>(null);
  const [off, setOff] = useState(false);
  const code = refCode(), logged = !!session?.user;
  useEffect(() => { if (code && !logged) api.referral.preview(code).then(r => setPv(r.preview)).catch(() => undefined); }, [code, logged]);
  if (!pv || logged || off) return null;
  return <div className="refbar" id="refBar" role="note">
    <span className="refgift" aria-hidden="true">🎁</span>
    <span><b>{pv.name}</b> 邀请你来大哲 IP 视频工作室{pv.bonus > 0 ? <>，注册多送 <b>{pv.bonus}</b> 点</> : ''}</span>
    <button className="btn k sm" id="refReg" onClick={() => sheet({ title: '注册', body: <AuthForm initial="register" onDone={() => sheet(null)} /> })}>注册领取</button>
    <button className="cls" aria-label="关闭" onClick={() => setOff(true)}>×</button>
  </div>;
}

/** 邀请卡片：我的链接、复制、生成海报、规则、数据、记录 */
export function InviteCard() {
  const { session, sheet, toast, reloadSession } = useApp();
  const logged = !!session?.user;
  const d = useData(() => (logged ? api.referral.mine() : Promise.resolve({ needLogin: true as const })), [logged]);
  if (!logged) return <div className="card invite" id="inviteCard">
    <p className="t2">邀请有礼</p>
    <p className="s m" style={{ marginTop: 6 }}>注册后就有你的专属邀请链接：好友用它注册，你们都得点数；好友充值，你还能拿返点。</p>
    <button className="btn y sm" id="inviteReg" style={{ marginTop: 12 }} onClick={() => sheet({ title: '注册', body: <AuthForm initial="register" onDone={() => sheet(null)} /> })}>注册，拿我的邀请链接</button>
  </div>;
  if (!d.data || d.data.needLogin) return <div className="card invite" id="inviteCard"><p className="t2">邀请有礼</p><p className="s m">加载中…</p></div>;
  const r = d.data, link = inviteLink(r.code);
  const onShared = async () => { try { const x = await api.referral.share(); if (x.points > 0) { toast(`今天的分享奖励 +${x.points} 点`); void reloadSession(); } } catch { /* 不影响分享 */ } };
  const copy = async () => {
    const text = `${r.cfg.shareText}${link}`;
    try { await navigator.clipboard.writeText(text); toast('邀请链接已复制，发给朋友吧'); }
    catch { sheet({ title: '复制邀请链接', body: <textarea className="fld" readOnly rows={3} value={text} onFocus={e => e.target.select()} /> }); }
    void onShared();
  };
  const poster = () => sheet({ title: '邀请海报', body: <Poster title={r.cfg.shareTitle} text={r.cfg.shareText} code={r.code} link={link} bonus={r.cfg.invitee} name={session!.user!.name} onSaved={onShared} /> });
  return <div className="card invite" id="inviteCard">
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}><p className="t2">邀请有礼</p>{!r.enabled && <span className="xs err">活动暂停中，链接还能用但暂时不发奖励</span>}</div>
    <p className="s" style={{ marginTop: 6 }}>好友用你的链接注册，你得 <b>{r.cfg.inviter}</b> 点、好友多得 <b>{r.cfg.invitee}</b> 点{r.cfg.rate > 0 ? <>；好友以后充值，你再得 <b>{Math.round(r.cfg.rate * 100)}%</b> 返点</> : ''}。</p>
    <div className="invlink"><input className="fld" id="inviteLink" readOnly value={link} aria-label="我的邀请链接" onFocus={e => e.target.select()} /><span className="invcode">邀请码 <b>{r.code}</b></span></div>
    <div className="row" style={{ gap: 8, marginTop: 10 }}>
      <button className="btn y sm" id="inviteCopy" onClick={copy}>复制链接</button>
      <button className="btn g sm" id="invitePoster" onClick={poster}>生成海报</button>
      {r.cfg.shareDaily > 0 && <span className="xs m3">每天第一次分享 +{r.cfg.shareDaily} 点</span>}
    </div>
    <dl className="invstats">
      <div><dt>链接被打开</dt><dd>{r.clicks}</dd></div><div><dt>好友注册</dt><dd>{r.invited}</dd></div>
      <div><dt>好友充值</dt><dd>{r.recharged}</dd></div><div><dt>我得到</dt><dd>{r.earned.toLocaleString()} 点</dd></div>
    </dl>
    <details className="invrules"><summary>规则</summary><ol>{r.cfg.rules.map((x, i) => <li key={i}>{x}</li>)}</ol></details>
    {r.records.length > 0 && <div className="list" id="inviteList" style={{ marginTop: 10 }}>{r.records.slice(0, 10).map((x, i) => <div key={i}>
      <span>{x.who}<br /><span className="xs m3">{new Date(x.createdAt).toLocaleDateString()} · {x.statusName}{x.paid ? ' · 已充值' : ''}</span></span>
      <span className="v">{x.points ? `+${x.points}` : '—'}</span>
    </div>)}</div>}
  </div>;
}

/** 海报：黄底大字 + 二维码（画在 canvas 上，能直接存图） */
function Poster({ title, text, code, link, bonus, name, onSaved }: { title: string; text: string; code: string; link: string; bonus: number; name: string; onSaved: () => void }) {
  const { toast } = useApp();
  const url = useMemo(() => drawPoster({ title, text, code, link, bonus, name }), [title, text, code, link, bonus, name]);
  const save = () => { const a = document.createElement('a'); a.href = url; a.download = `邀请海报-${code}.png`; document.body.appendChild(a); a.click(); a.remove(); toast('海报已保存，发到朋友圈或群里'); onSaved(); };
  return <div id="posterSheet" style={{ textAlign: 'center' }}>
    <img src={url} alt="邀请海报" style={{ width: '100%', maxWidth: 300, border: '1px solid var(--ln2)', borderRadius: 8 }} />
    <p className="xs m3" style={{ margin: '8px 0 12px' }}>手机上长按图片也能保存</p>
    <button className="btn y" id="posterSave" onClick={save}>保存海报图片</button>
  </div>;
}

function drawPoster(o: { title: string; text: string; code: string; link: string; bonus: number; name: string }): string {
  const W = 750, H = 1200, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (!g) return '';
  const font = (w: number, s: number) => `${w} ${s}px "Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif`;
  const wrap = (s: string, x: number, y: number, maxW: number, lh: number, maxLines = 4) => {
    let line = '', n = 0;
    for (const ch of s) {
      if (g.measureText(line + ch).width > maxW && line) { g.fillText(line, x, y + n * lh); line = ch; n++; if (n >= maxLines) return y + n * lh; }
      else line += ch;
    }
    if (line) { g.fillText(line, x, y + n * lh); n++; }
    return y + n * lh;
  };
  g.fillStyle = '#FFCB05'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#0B0B0C';
  g.font = font(900, 30); g.fillText('大哲 IP研究院', 60, 96);
  g.font = font(700, 18); g.fillText('DA ZHE IP RESEARCH INSTITUTE · 视频工作室', 60, 126);
  g.fillRect(60, 150, 630, 4);
  g.font = font(900, 54); let y = wrap(o.title || '我在用大哲 IP 视频工作室做视频', 60, 240, 630, 70, 3);
  g.font = font(500, 28); y = wrap(o.text, 60, y + 20, 630, 44, 4);
  // 二维码卡片
  const cardY = Math.max(y + 30, 640), size = 360, x0 = (W - size) / 2;
  g.fillStyle = '#FFFFFF'; g.fillRect(x0 - 24, cardY, size + 48, size + 120);
  g.strokeStyle = '#0B0B0C'; g.lineWidth = 4; g.strokeRect(x0 - 24, cardY, size + 48, size + 120);
  const q = qrcode(0, 'M'); q.addData(o.link); q.make();
  const n = q.getModuleCount(), cell = Math.floor(size / n), off = x0 + (size - cell * n) / 2;
  g.fillStyle = '#0B0B0C';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect(off + k * cell, cardY + 24 + r * cell, cell, cell);
  g.font = font(800, 26); g.textAlign = 'center';
  g.fillText(o.bonus > 0 ? `扫码注册，多送 ${o.bonus} 点` : '扫码注册，一起做视频', W / 2, cardY + size + 66);
  g.font = font(500, 20); g.fillText(`${o.name} 的邀请码 ${o.code}`, W / 2, cardY + size + 98);
  g.textAlign = 'left';
  return c.toDataURL('image/png');
}
