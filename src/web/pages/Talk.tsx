// 口播数字人：dazheip 菜单里单独一个入口。三步：① 我的形象和声音 ② 这条说什么（按风格、用知识库写稿）③ 出镜方式 → 生成。
// 生成走「生成视频」同一条链路（真人口播类型 + 数字人出镜），到分镜那一步还能逐镜改。
import { useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../store.tsx';
import { Ph, Src } from '../ui/kit.tsx';
import { useModOpen, useMods } from '../ui/mods.tsx';
import { AvatarCard } from './Me.tsx';
import { useCloneVoice } from './ip/More.tsx';
import { SUBTYPES, chars } from '../../shared/video.ts';
import { VOICES } from '../../shared/catalog.ts';
import { VIDEO_STYLES, styleOf } from '../../shared/styles.ts';
import type { AvatarMode, GenSettings } from '../../shared/types.ts';

const TALK_STYLES = ['dazhe', 'yitiao', 'vlog', 'site'].map(id => VIDEO_STYLES.find(s => s.id === id)!);
const ST: Record<string, [string, string]> = { none: ['', '还没录'], busy: ['gen', '处理中'], ready: ['real', '可用'] };

export function TalkPage() {
  const { session, nav, setGenSeed, toast, fail } = useApp();
  const mods = useMods();
  useModOpen('avatarStudio');
  const clone = useCloneVoice();
  const ws = session!.workspace, av = ws.avatars ?? { clone: 'none', photo: 'none' };
  const ready = (['clone', 'photo'] as const).filter(k => av[k] === 'ready');
  const [who, setWho] = useState<AvatarMode>(ready[0] ?? 'clone');
  const [sub, setSub] = useState(SUBTYPES.talk[0].id);
  const [style, setStyle] = useState('dazhe');
  const [idea, setIdea] = useState('');
  const [copy, setCopy] = useState('');
  const [voice, setVoice] = useState<GenSettings['voice']>(ws.voiceClone === 'ready' ? 'me' : 'p1');
  const [busy, setBusy] = useState(false);
  const st = styleOf(style)!;
  const secs = Math.round(chars(copy) / 4.5);
  const pickWho = (ready as readonly string[]).includes(who) ? who : ready[0];

  const write = async () => {
    setBusy(true);
    try {
      const subN = SUBTYPES.talk.find(x => x.id === sub)?.n ?? '';
      const r = await api.writeCopy({ idea: idea || subN, len: 45, kb: true, style: st.n });
      const d = r.draft;
      setCopy([d.hook, ...d.body, d.cta].filter(Boolean).join('\n'));
      toast(r.used.length ? `按「${st.n}」写好了，用了知识库里的 ${r.used.length} 条` : `按「${st.n}」写好了`);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const go = () => {
    setGenSeed({ type: 'talk', sub, copy, title: copy.split('\n')[0].slice(0, 22), avatar: pickWho ?? 'none', voice, style: st.n, bgm: st.bgm, draft: true, });
    nav('gen');
  };

  return <section className="view on" id="v-talk"><div className="vb">
    <div className="hero tight">
      <p className="eyebrow">口播数字人 · 新</p>
      <h1 className="d2">录一次，以后每条口播<em>由你的数字人出镜</em>。</h1>
      <p className="s m" style={{ marginTop: 10, maxWidth: '40em' }}>拍 1 分钟正脸视频或传一张照片，再录 30 秒声音。之后写好稿子，数字人用你的样子和声音说出来，中间自动插画面。</p>
    </div>
    <div className="wrap talk">
      <div className="tstep">
        <p className="tsn">① 我的形象和声音</p>
        {mods.on('avatars') ? <div className="mecards">
          {mods.on('voiceClone') && <div className="card" id="talkVoice">
            <div className="row" style={{ justifyContent: 'space-between' }}><p className="t2">我的声音</p><Src k={ST[ws.voiceClone][0]}>{ST[ws.voiceClone][1]}</Src></div>
            <div className="meph"><Ph k="ref" /></div>
            <p className="s m">安静的地方录 30 秒，像平时讲解一样说。录完确认是本人并同意授权。</p>
            <div className="row" style={{ gap: 8, marginTop: 14 }}><button className="btn y sm" onClick={clone}>{ws.voiceClone === 'ready' ? '重新录' : '录 30 秒'}</button></div>
          </div>}
          <AvatarCard kind="clone" state={av.clone} onTry={() => setWho('clone')} />
          <AvatarCard kind="photo" state={av.photo} onTry={() => setWho('photo')} />
        </div> : <p className="s m">数字人形象还没开放。</p>}
      </div>

      <div className="tstep">
        <p className="tsn">② 这条说什么</p>
        <div className="card">
          <p className="lb">讲哪一类</p>
          <div className="pills" id="talkSub">{SUBTYPES.talk.map(x => <button key={x.id} className="pill" aria-pressed={sub === x.id} onClick={() => setSub(x.id)}>{x.n}</button>)}</div>
          <p className="lb" style={{ marginTop: 16 }}>口播风格</p>
          <div className="stgrid" id="talkStyles">{TALK_STYLES.map(s => <button key={s.id} className="stc" data-style={s.id} aria-pressed={style === s.id} onClick={() => setStyle(s.id)}>
            <span className="stn">{s.n}{s.hot && <span className="tag hot">招牌</span>}{s.draft && <span className="tag">待校准</span>}</span>
            <span className="stl">参考：{s.like}</span><span className="std">{s.d}</span>
          </button>)}</div>
          <div className="row" style={{ gap: 8, marginTop: 16, flexWrap: 'nowrap' }}>
            <input className="fld" id="talkIdea" value={idea} onChange={e => setIdea(e.target.value)} placeholder="这条想讲什么，比如：为什么我不建议做全屋吊顶" />
            <button className="btn y" id="talkWrite" disabled={busy} onClick={write}>{busy ? 'AI 在写…' : 'AI 写稿 →'}</button>
          </div>
          <textarea className="fld" id="talkCopy" rows={7} style={{ marginTop: 12 }} value={copy} onChange={e => setCopy(e.target.value)} placeholder="也可以直接贴自己的稿子。一句一行，每句配一个镜头。" />
          <p className="xs m3" style={{ marginTop: 6 }}>{chars(copy)} 字 · 约 {secs} 秒 · 按「{st.n}」：{st.copy.split('；')[0]}</p>
        </div>
      </div>

      <div className="tstep">
        <p className="tsn">③ 出镜方式</p>
        <div className="card talkopts">
          <div><p className="lb">谁出镜</p>
            <div className="vlist">{(['clone', 'photo'] as const).map(k => <button key={k} data-who={k} aria-pressed={pickWho === k} aria-disabled={av[k] !== 'ready' || undefined} onClick={() => av[k] === 'ready' ? setWho(k) : toast(k === 'clone' ? '先在上面拍视频建真人分身' : '先在上面传照片建照片形象')}>
              <span className="av"><Ph k="person" /></span><span><b>{k === 'clone' ? '真人分身' : '照片形象'}</b><span>{av[k] === 'ready' ? '可用' : av[k] === 'busy' ? '处理中…' : '还没建'}</span></span></button>)}</div></div>
          <div><p className="lb">用谁的声音</p>
            <div className="vlist">{VOICES.filter(v => v.id !== 'none' && (v.id !== 'me' || mods.on('voiceClone'))).map(v => <button key={v.id} data-voice={v.id} aria-pressed={voice === v.id} onClick={() => v.id === 'me' && ws.voiceClone !== 'ready' ? toast('先在上面录 30 秒声音') : setVoice(v.id)}>
              <span className="av">{v.k ? <Ph k={v.k} /> : '—'}</span><span><b>{v.n}</b><span>{v.id === 'me' ? (ws.voiceClone === 'ready' ? '已复刻' : '还没录') : v.d}</span></span></button>)}</div></div>
          <div><p className="lb">中间插画面</p>
            <p className="s">数字人全程出镜，中间自动插 2–4 个画面；到分镜那一步可以换成自己的作品照片或现场视频。</p>
            <p className="xs m3" style={{ marginTop: 8 }}>音乐「{st.bgm}」· 字幕「{st.subs === 'key' ? '大字黄底' : st.subs === 'doc' ? '小号白字' : '白字描边'}」，跟着风格走</p></div>
        </div>
      </div>

      <div className="ctabar">
        <button className="btn cta" id="talkGo" disabled={!pickWho || !copy.trim()} onClick={go}>生成口播视频 <span aria-hidden="true">→</span></button>
        <p className="xs m3">{!pickWho ? '先建一个形象（审核几分钟）' : !copy.trim() ? '先写好稿子' : '先出低价样片，满意再出成片；下一步可以逐镜改'}</p>
      </div>
    </div>
  </div></section>;
}
