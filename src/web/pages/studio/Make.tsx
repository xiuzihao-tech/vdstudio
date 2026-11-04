// 一键生成视频：首页（拖素材）→ ① 传素材 → ② AI 建议 → ③ 确认分镜 → ④ 成片与发布 →「加入发布队列」回到安排发布计划。
// 入口只收素材或文案，成片类型交给 AI 推荐（也可以自己在下拉里定）。数字人在第 2 步选，不再单独一页。
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { api } from '../../api.ts';
import { useApp } from '../../store.tsx';
import { pickFiles } from '../../ui/kit.tsx';
import { ACCEPT } from '../../ui/pickers.tsx';
import { DAZHEIP_URL } from '../../config.ts';
import { speak } from '../Gen.tsx';
import { AvatarArt, CoverArt, Player, Schema, Thumb, useStudio } from './common.tsx';
import {
  ACCOUNTS, AUTO, AVATARS, FONT_NOTE, OPT, SAMPLES, SAMPLE_CATS, VOICES, VTYPES, addDays, advise, avatarOf, buildShots, chars, costOf, mmss, newDraft, pack, shotReady, splitLines, totalSecs, vtype, whenLabel,
  type MakeDraft, type Mat, type PlanItem, type Sample, type SampleCat, type Shot, type VType,
} from '../../../shared/studio.ts';
import type { Asset } from '../../../shared/types.ts';

const STEPS = ['传素材', 'AI 建议', '确认分镜', '成片与发布'];
const SAMPLE_COPY = '这套140㎡意式极简，我最想让你看两个细节。整面岩板没有做复杂造型，靠体块穿插撑住气场。开放式餐厨把动线缩短了4米，做饭不再绕圈。床头这面洞石，是整套房子最贵也最值的一笔。想看你家能做成什么样，评论区扣1，发你清单。';
const toMat = (a: Asset): Mat => ({ id: a.id, name: a.name, kind: a.type === '视频' || a.mime?.startsWith('video/') ? 'video' : 'photo', k: a.k, url: a.url, mime: a.mime });
const nowIso = () => new Date().toISOString();
const ago = (iso: string) => { const d = new Date(iso), n = new Date(); const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; return d.toDateString() === n.toDateString() ? `今天${hm}` : n.getTime() - d.getTime() < 2 * 864e5 ? `昨天${hm}` : `${d.getMonth() + 1}月${d.getDate()}日`; };
const TYPE_BY_NAME = Object.fromEntries(VTYPES.map(t => [t.n, t.id])) as Record<string, VType>;

/** 上传（拖进来或点选），失败的跳过 */
async function uploadAll(files: File[], toast: (m: string) => void): Promise<Mat[]> {
  const out: Mat[] = [];
  for (const f of files.slice(0, 20)) {
    if (!/^(image|video)\//.test(f.type)) { toast(`「${f.name}」不是图片或视频，先跳过`); continue; }
    try { out.push(toMat(await api.upload(f, '一键生成视频'))); } catch (e) { toast(e instanceof Error ? e.message : '上传失败'); }
  }
  return out;
}

export function MakePage() {
  const { route, nav, genSeed, setGenSeed, session } = useApp();
  const { st, save } = useStudio();
  // 从发布计划「去生成」带过来：新开一条草稿，带上标题和类型
  useEffect(() => {
    if (!genSeed || !st) return;
    const d = newDraft(nowIso());
    const t = genSeed.type ? (TYPE_BY_NAME[genSeed.type as string] ?? (VTYPES.some(v => v.id === genSeed.type) ? genSeed.type as VType : null)) : null;
    void save({ draft: { ...d, title: genSeed.title ?? '', copy: genSeed.copy ?? '', planId: genSeed.topicId ?? null, pick: t ?? AUTO } });
    setGenSeed(null);
    nav({ view: 'make', sub: 'flow' }, true);
  }, [genSeed, st]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st || !session) return <section className="view on"><div className="vb wrap" style={{ paddingTop: 80 }}><p className="s m">加载中…</p></div></section>;
  if (route.sub === 'flow' && st.draft) return <Flow />;
  return <Home />;
}

/* ---------- 首页 ---------- */
function Home() {
  const { nav, toast, sheet, fail } = useApp();
  const { st, save } = useStudio();
  const [mats, setMats] = useState<Mat[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [cat, setCat] = useState<SampleCat>('全部');
  const draft = st!.draft;
  const start = (m: Mat[], extra: Partial<MakeDraft> = {}) => { void save({ draft: { ...newDraft(nowIso()), mats: m, ...extra } }); nav({ view: 'make', sub: 'flow' }); };
  const add = async (files: File[]) => { if (!files.length) return; setBusy(true); try { const m = await uploadAll(files, toast); setMats(x => [...x, ...m]); if (m.length) toast(`收到 ${m.length} 份，也存进了「管理我的素材」`); } catch (e) { fail(e); } finally { setBusy(false); } };
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setOver(false);
    const files = [...e.dataTransfer.files];
    if (files.length) { void add(files); return; }
    const text = e.dataTransfer.getData('text/plain');
    if (text.trim()) start(mats, { copy: text.trim() });
  };
  const list = cat === '全部' ? SAMPLES : SAMPLES.filter(s => s.cat === cat);
  const preview = (s: Sample) => sheet({
    title: s.t, wide: true,
    body: <div className="smpv">
      <Player shots={s.scenes.map((k, i) => ({ id: `${s.id}-${i}`, title: '', line: [s.t, s.d, '成品示意 · 做同款换成你的素材', '看完点「做同款」'][i % 4], tip: '', k: k === 'person' ? 'live' : k, avatar: k === 'person', secs: 2.5 }))} ratio="9:16 竖屏" font="思源黑体" title={s.t} avatar="lin" />
      <div>
        <p className="eyebrow">{s.cat}{s.custom ? ' · 可定制' : ''}</p>
        <p className="t2" style={{ marginTop: 6 }}>{s.d}</p>
        <p className="s m" style={{ marginTop: 10 }}>{vtype(s.type).d}</p>
        <p className="xs m3" style={{ marginTop: 8 }}>要准备：{vtype(s.type).need} · 约 {vtype(s.type).pts} 点</p>
        {s.play && <p className="xs m3" style={{ marginTop: 6 }}>播放 {s.play} · 询盘 {s.ask}</p>}
        <div className="row" style={{ gap: 8, marginTop: 18 }}>
          {s.custom ? <button className="btn y" onClick={() => { sheet(null); toast('已记下，顾问会联系你沟通定制（演示）'); }}>预约定制</button>
            : s.soon ? <button className="btn g" onClick={() => { sheet(null); toast('这一类在做样片，先用「真人口播」'); }}>样片制作中</button>
              : <button className="btn y" id="smpGo" onClick={() => { sheet(null); start(mats, { pick: s.type }); }}>做同款 →</button>}
        </div>
      </div>
    </div>,
  });
  return <section className="view on" id="v-make"><div className="vb wrap mk">
    <div className="mkhero">
      <div>
        <p className="eyebrow">一键生成视频</p>
        <h1 className="d2">今天做<em>一件事</em>就好</h1>
        <p className="lead2">把素材放进来，剩下的交给 AI</p>
        <p className="s m" style={{ marginTop: 14, maxWidth: '30em' }}>传素材，出片。照片、视频、一段文案、或者你的数字人，丢进来就行。手里有什么就放什么，缺的 AI 来补——看完会告诉你适合做成什么、要多少点。</p>
      </div>
      <div className={`drop${over ? ' over' : ''}`} id="mkDrop" onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
        onClick={async e => { if ((e.target as HTMLElement).closest('button,a')) return; void add(await pickFiles(ACCEPT)); }}>
        <svg className="drop-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
        <b>把今天的素材拖进来</b>
        <span className="xs">支持照片、视频、文案、数字人</span>
        {mats.length > 0 && <div className="drop-mats">{mats.slice(0, 6).map(m => <Thumb key={m.id} mat={m} />)}{mats.length > 6 && <span>+{mats.length - 6}</span>}</div>}
        <button className="btn k" id="mkStart" disabled={busy} onClick={() => start(mats)}>{busy ? '上传中…' : mats.length ? `开始出片（${mats.length} 份）→` : '开始出片 →'}</button>
        {!st!.diag.saved && <button className="lnk xs" id="mkDiag" onClick={() => nav('diag')}>还没做账号诊断？先看看你该讲什么 →</button>}
      </div>
    </div>

    {draft && !draft.rendered && (draft.mats.length > 0 || draft.copy || draft.step > 1) && <>
      <p className="lb" style={{ marginTop: 34 }}>上次未完成</p>
      <div className="resume" id="mkResume">
        <Thumb mat={draft.mats[0]} k={draft.shots[0]?.k ?? 'live'} />
        <div><b>{draft.title || splitLines(draft.copy)[0]?.slice(0, 20) || '未命名的一条'}</b><span className="xs m3">{['', '素材还没传完', 'AI 建议还没看完', '分镜还没确认', '还没加入发布队列'][draft.step]} · {ago(draft.updatedAt)} · 已备 {draft.cost} 点</span></div>
        <button className="btn g" onClick={() => nav({ view: 'make', sub: 'flow' })}>继续 →</button>
      </div>
    </>}

    <div className="row" style={{ justifyContent: 'space-between', marginTop: 34, alignItems: 'baseline' }}>
      <p className="lb" style={{ margin: 0 }}>成品长这样</p>
      <span className="xs m3">创意模板不定期上新</span>
    </div>
    <div className="cats" id="mkCats">{SAMPLE_CATS.map(c => <button key={c} className="pill sm" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}{c === 'TVC 大片' && <span className="xs m3"> · 可定制</span>}</button>)}</div>
    <div className="samples" id="mkSamples">{list.map(s => <button key={s.id} className="smp" data-smp={s.id} onClick={() => preview(s)}>
      <div className="smp-v"><div className="smp-anim">{s.scenes.slice(0, 3).map((k, i) => <Thumb key={i} k={k === 'person' ? undefined : k} avatar={k === 'person' ? 'lin' : null} />)}</div><span className="smp-play">▶</span><span className="smp-dur">{s.dur}</span>{s.custom && <span className="smp-tag">可定制</span>}{s.soon && <span className="smp-tag">样片制作中</span>}</div>
      <span className="smp-cat">{s.cat}</span>
      <b>{s.t}</b>
      <span className="xs m3">{s.d}{s.play ? ` · 播放${s.play} 询盘${s.ask}` : ''}</span>
    </button>)}</div>
  </div></section>;
}

/* ---------- 四步 ---------- */
function Flow() {
  const { nav } = useApp();
  const { st, save } = useStudio();
  const [d, setD] = useState<MakeDraft>(st!.draft!);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const set = (p: Partial<MakeDraft>) => setD(x => ({ ...x, ...p, updatedAt: nowIso() }));
  // 改了就存（半秒防抖），换设备、刷新都能接着做
  useEffect(() => { clearTimeout(timer.current); timer.current = setTimeout(() => void save({ draft: d }), 1200); return () => clearTimeout(timer.current); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (step: MakeDraft['step'], p: Partial<MakeDraft> = {}) => { set({ ...p, step }); window.scrollTo(0, 0); };
  return <section className="view on" id="v-flow"><div className="vb wrap mk">
    <div className="flowhd">
      <button className="lnk s" onClick={() => nav('make')}>← 一键生成视频</button>
      <ol className="stepper" id="mkSteps">{STEPS.map((n, i) => <li key={n} className={i + 1 === d.step ? 'on' : i + 1 < d.step ? 'done' : ''}><i>{i + 1 < d.step ? '✓' : i + 1}</i>{n}</li>)}</ol>
    </div>
    {d.step === 1 && <Step1 d={d} set={set} go={go} />}
    {d.step === 2 && <Step2 d={d} set={set} go={go} />}
    {d.step === 3 && <Step3 d={d} set={set} go={go} />}
    {d.step === 4 && <Step4 d={d} set={set} go={go} />}
  </div></section>;
}
interface SP { d: MakeDraft; set: (p: Partial<MakeDraft>) => void; go: (s: MakeDraft['step'], p?: Partial<MakeDraft>) => void }

function Step1({ d, set, go }: SP) {
  const { toast, fail, sheet } = useApp();
  const { st } = useStudio();
  const [busy, setBusy] = useState('');
  const [over, setOver] = useState(false);
  const add = async (files: File[]) => { if (!files.length) return; setBusy('up'); try { const m = await uploadAll(files, toast); set({ mats: [...d.mats, ...m] }); } catch (e) { fail(e); } finally { setBusy(''); } };
  const samples = async () => {
    setBusy('smp');
    try { await api.addSamples(); const r = await api.assets(); const s = r.assets.filter(a => a.source === '示例').slice(0, 5).map(toMat); set({ mats: [...d.mats.filter(m => !s.some(x => x.id === m.id)), ...s] }); toast(`加了 ${s.length} 份示例素材`); }
    catch (e) { fail(e); } finally { setBusy(''); }
  };
  const fromLib = async () => {
    try {
      const r = await api.assets();
      if (!r.assets.length) { toast('素材库还是空的，先传几张'); return; }
      sheet({ title: '从「管理我的素材」里选', body: <LibPick list={r.assets} already={d.mats.map(m => m.id)} onDone={a => { sheet(null); set({ mats: [...d.mats, ...a.filter(x => !d.mats.some(m => m.id === x.id)).map(toMat)] }); }} /> });
    } catch (e) { fail(e); }
  };
  const aiWrite = async () => {
    setBusy('write');
    try {
      const r = await api.footage(d.mats.map(m => m.id), d.title);
      set({ copy: r.lines.join('\n') });
      toast('AI 看完素材写好了一版，可以直接改');
    } catch {
      set({ copy: buildShots({ mats: d.mats, copy: '', type: d.pick === AUTO ? 'tour' : d.pick, face: 'none' }).map(s => s.line).join('\n') });
      toast('按画面先写了一版，可以直接改');
    } finally { setBusy(''); }
  };
  const n = chars(d.copy);
  const pick = d.pick === AUTO ? null : vtype(d.pick);
  const next = () => {
    const a = advise(d), t = vtype(a.type);
    go(2, { type: a.type, face: t.face === 'avatar' ? 'avatar' : 'none', avatar: st?.avatar ?? d.avatar, cost: costOf(a.type, d.opt.dur), opt: { ...d.opt, dur: 'AI 推荐' } });
  };
  return <div className="stp" id="mkStep1">
    <div className="s1grid">
      <div className={`upbox${over ? ' over' : ''}`} id="mkUp" onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); void add([...e.dataTransfer.files]); }}>
        <p className="t2">传素材</p>
        <p className="s m">照片、视频、或数字人</p>
        {d.mats.length > 0 && <div className="matgrid">{d.mats.map(m => <div key={m.id} className="mat"><Thumb mat={m} /><button aria-label={`去掉 ${m.name}`} onClick={() => set({ mats: d.mats.filter(x => x.id !== m.id) })}>×</button><span>{m.kind === 'video' ? '视频' : '照片'}</span></div>)}</div>}
        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <button className="btn y sm" id="mkPick" disabled={!!busy} onClick={async () => add(await pickFiles(ACCEPT))}>{busy === 'up' ? '上传中…' : '选择文件'}</button>
          <button className="btn g sm" id="mkSamplesBtn" disabled={!!busy} onClick={samples}>{busy === 'smp' ? '在加…' : '添加示例素材'}</button>
          <button className="btn g sm" disabled={!!busy} onClick={fromLib}>从素材库选</button>
        </div>
      </div>
      <div className="or" aria-hidden="true">或</div>
      <div className="txtbox">
        <div className="row" style={{ justifyContent: 'space-between' }}><p className="t2">贴一段文案</p><button className="lnk xs" id="mkSampleCopy" onClick={() => set({ copy: SAMPLE_COPY })}>粘贴示例文案</button></div>
        <textarea className="fld" id="mkCopy" rows={7} value={d.copy} onChange={e => set({ copy: e.target.value })} placeholder="想说的话、一个观点、一段案例介绍都行。不写也可以——有画面就能做空间漫游。" />
        {n > 0 && <p className="xs ok" style={{ marginTop: 6 }}>✓ 已收到文案 · 约 {n} 字</p>}
        {d.mats.length > 0 && !n && <div className="nocopy" id="mkNoCopy">
          <span className="s">没有文案？</span>
          <button className="btn g sm" id="mkAiWrite" disabled={!!busy} onClick={aiWrite}>{busy === 'write' ? 'AI 在看素材…' : '让 AI 看素材写一段'}</button>
          <a className="lnk xs" href={`${DAZHEIP_URL}/`} target={DAZHEIP_URL ? '_blank' : undefined} rel="noopener">点这里去「开始创作文案」写 ↗</a>
        </div>}
      </div>
    </div>
    <div className="typepick">
      <label className="t2" htmlFor="mkType">成片类型（可选）</label>
      <p className="s m">不确定就交给 AI，它会按你的素材挑最合适的；你已经想清楚了就自己定。</p>
      <select className="fld big" id="mkType" value={d.pick} onChange={e => set({ pick: e.target.value as VType | typeof AUTO })}>
        <option value={AUTO}>✓ 交给 AI 决定（推荐）</option>
        {VTYPES.map(t => <option key={t.id} value={t.id}>{t.n} · {t.pts} 点{t.tag ? ` · ${t.tag}` : ''}</option>)}
      </select>
      {pick && <p className="xs m3" style={{ marginTop: 6 }}>{pick.d}。要准备：{pick.need}</p>}
    </div>
    <div className="stfoot">
      <span className="xs m3">{!d.mats.length && !n ? '先放素材或者文案，至少一样' : `${d.mats.length} 份素材 · ${n ? `${n} 字文案` : '没有文案'}`}</span>
      <button className="btn k" id="mkNext1" disabled={!d.mats.length && !n} onClick={next}>下一步 · 让 AI 看看 →</button>
    </div>
  </div>;
}

function LibPick({ list, already, onDone }: { list: Asset[]; already: string[]; onDone: (a: Asset[]) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  return <>
    <div className="pk">{list.map(a => <button key={a.id} aria-pressed={sel.includes(a.id)} onClick={() => setSel(s => s.includes(a.id) ? s.filter(x => x !== a.id) : [...s, a.id])}><Thumb mat={toMat(a)} /><span>{a.name}{already.includes(a.id) ? ' · 已在用' : ''}</span></button>)}</div>
    <div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}><button className="btn y" disabled={!sel.length} onClick={() => onDone(list.filter(a => sel.includes(a.id)))}>{sel.length ? `用这 ${sel.length} 份` : '先点选'}</button></div>
  </>;
}

function Opt({ id, label, value, options, auto, note, onChange }: { id: string; label: string; value: string; options: readonly string[]; auto: string; note?: string; onChange: (v: string) => void }) {
  return <label className="opt" htmlFor={id}><span className="xs m3">{label}</span>
    <select className="fld" id={id} value={value} onChange={e => onChange(e.target.value)}>
      <option value="AI 推荐">AI 推荐 · {auto}</option>
      {options.filter(o => o !== 'AI 推荐').map(o => <option key={o} value={o}>{o}</option>)}
    </select>
    {note && <span className="xs m3">{note}</span>}
  </label>;
}

function Step2({ d, set, go }: SP) {
  const { sheet, session } = useApp();
  const { save, st } = useStudio();
  const a = useMemo(() => advise({ ...d, pick: d.pick }), [d.mats, d.copy, d.pick]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = vtype(d.type);
  const av = avatarOf(d.avatar);
  const built = !av.mine || session!.workspace.avatars?.[av.id === 'me-photo' ? 'photo' : 'clone'] === 'ready';
  const mine = d.pick !== AUTO && d.pick === d.type;
  const autoSecs = t.secs, autoVoice = d.face === 'avatar' ? `数字人·${av.n}` : t.face === 'none' ? '只放音乐' : 'AI 配音·沉稳男声';
  const cost = costOf(d.type, d.opt.dur);
  const target = d.opt.dur === 'AI 推荐' ? autoSecs : parseInt(d.opt.dur) || autoSecs;
  useEffect(() => { if (cost !== d.cost) set({ cost }); }, [cost]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (id: VType) => { const x = vtype(id); set({ type: id, face: x.face === 'avatar' ? 'avatar' : d.face, cost: costOf(id, d.opt.dur) }); };
  const pickAvatar = () => sheet({
    title: '换数字人', wide: true,
    body: <>
      <p className="s m" style={{ marginBottom: 12 }}>自己的形象在「管理我的素材 → 数字人与声音」里建，建一次以后每条都能用。没有的话先用系统形象，或者选「不露脸」用 AI 配音。</p>
      <div className="avgrid">{AVATARS.map(x => <button key={x.id} className="avc" data-av={x.id} aria-pressed={d.avatar === x.id} onClick={() => { set({ avatar: x.id, face: 'avatar' }); void save({ avatar: x.id }); sheet(null); }}>
        <AvatarArt look={x} /><b>{x.n}{x.mine && <span className="tag">我的</span>}</b><span className="xs m3">{x.d}</span></button>)}</div>
    </>,
  });
  void st;
  return <div className="stp" id="mkStep2">
    <div className="aimsg"><span className="aiav">AI</span><p>{a.why}</p></div>
    <div className="chips">{a.chips.map(([k, v]) => <span key={k} className="chip"><b>{k}</b>·{k === '声音' ? (d.face === 'avatar' ? '数字人' : t.face === 'none' ? '只放音乐' : 'AI 配音') : v}</span>)}</div>

    <div className="facecols" role="radiogroup" aria-label="出镜方式">
      <button role="radio" aria-checked={d.face === 'avatar'} id="mkFaceAv" className="facec" onClick={() => set({ face: 'avatar' })}><b>数字人口播</b><span className="xs m3">数字人出镜照着文案说，中间插画面</span></button>
      <button role="radio" aria-checked={d.face === 'none'} id="mkFaceNone" className="facec" onClick={() => set({ face: 'none' })}><b>不露脸</b><span className="xs m3">AI 配音或只放音乐，画面全是空间</span></button>
    </div>
    {d.face === 'avatar' ? <div className="avrow" id="mkAvatar">
      <AvatarArt look={av} />
      <div><b>数字人·{av.n} {built ? <span className="ok">已就绪</span> : <span className="xs m3">还没建 · 先用示意形象演示</span>}</b><span className="xs m3">{av.mine ? (built ? '来自「管理我的素材」，不用每次重建。' : '去「管理我的素材 → 数字人与声音」拍 1 分钟视频就能建好。') : '系统形象，可以直接出镜。'}没有数字人可先用 AI 配音，不露脸也能出片。</span></div>
      <button className="btn g sm" id="mkAvSwap" onClick={pickAvatar}>换数字人</button>
    </div> : <div className="avrow none"><span className="aiav">♪</span><div><b>不露脸出片</b><span className="xs m3">{t.face === 'none' ? '这一类本来就不说话：配音乐和一句句字幕。' : '用 AI 配音念文案，画面全是空间。'}想出镜随时切回「数字人口播」。</span></div></div>}

    <p className={`fit ${a.fit}`} id="mkFit">{mine ? '你指定了' : 'AI 推荐'} <b>{t.n}</b> · {cost} 点 · {d.pick !== AUTO && d.pick !== d.type ? '你换了类型 · ' : ''}{a.fitText}</p>

    <div className="reco" id="mkReco">
      <div className="reco-hd"><div><p className="t1">{t.n}<span className="xs m3">（{mine ? '你指定的' : d.type === a.type ? 'AI 推荐' : '你换的'}）</span></p><p className="s m">{t.d}。</p></div><div className="reco-pts"><b>{cost}<small>点</small></b><span className="xs m3">约 {d.opt.dur === 'AI 推荐' ? autoSecs : parseInt(d.opt.dur)} 秒</span></div></div>
      <Schema type={d.type} face={d.face} avatar={d.avatar} />
    </div>

    <p className="lb" style={{ marginTop: 26 }}>这条怎么出</p>
    <div className="mkopts">
      <Opt id="mkDur" label="时长" value={d.opt.dur} options={OPT.dur} auto={`${autoSecs}秒`} onChange={v => set({ opt: { ...d.opt, dur: v } })} />
      <Opt id="mkRatio" label="画面比例" value={d.opt.ratio} options={OPT.ratio} auto="9:16竖屏" onChange={v => set({ opt: { ...d.opt, ratio: v } })} />
      <Opt id="mkFont" label="字体" value={d.opt.font} options={OPT.font} auto="思源黑体" note={`${FONT_NOTE[d.opt.font === 'AI 推荐' ? '思源黑体' : d.opt.font] ?? ''} · 授权上线前再核一遍`} onChange={v => set({ opt: { ...d.opt, font: v } })} />
      <Opt id="mkBgm" label="背景音乐" value={d.opt.bgm} options={OPT.bgm} auto={t.bgm} onChange={v => set({ opt: { ...d.opt, bgm: v } })} />
      <Opt id="mkVoice" label="声音" value={d.opt.voice} options={VOICES} auto={autoVoice} onChange={v => set({ opt: { ...d.opt, voice: v } })} />
    </div>

    <p className="lb" style={{ marginTop: 26 }}>不想做这个？换一类——</p>
    <div className="pills" id="mkSwap">{VTYPES.map(x => <button key={x.id} className="pill" data-ty={x.id} aria-pressed={d.type === x.id} onClick={() => change(x.id)}>{x.n} <span className="xs m3">{costOf(x.id, d.opt.dur)}点</span></button>)}</div>

    <div className="stfoot">
      <button className="btn g" onClick={() => go(1)}>← 上一步</button>
      <span className="s">预计消耗 <b>{cost}</b> 点</span>
      <button className="btn k" id="mkNext2" onClick={() => go(3, { shots: buildShots(d, target), cost })}>下一步 · 生成分镜 →</button>
    </div>
  </div>;
}

function Step3({ d, set, go }: SP) {
  const { sheet, toast, fail, session, reloadSession } = useApp();
  const [edit, setEdit] = useState<string | null>(null);
  const [rendering, setRendering] = useState(-1);
  const t = vtype(d.type);
  const shots = d.shots.length ? d.shots : buildShots(d, vtype(d.type).secs);
  const ready = shots.filter(shotReady).length, missing = shots.length - ready;
  const setShot = (id: string, p: Partial<Shot>) => set({ shots: shots.map(s => s.id === id ? { ...s, ...p } : s) });
  const addMedia = async (s: Shot) => {
    const list = (await api.assets().catch(() => ({ assets: [] as Asset[] }))).assets;
    sheet({
      title: `给「${s.title}」配画面`,
      body: <>
        <p className="s m">{s.tip}</p>
        <div className="row" style={{ gap: 8, margin: '14px 0' }}>
          <button className="btn y sm" id="shUp" onClick={async () => { const f = await pickFiles(ACCEPT, false); if (!f.length) return; const m = await uploadAll(f, toast); if (m[0]) { setShot(s.id, { mat: m[0] }); sheet(null); toast('换上了'); } }}>拍一张 / 上传</button>
          {d.face === 'avatar' && <button className="btn g sm" onClick={() => { setShot(s.id, { avatar: true, mat: null }); sheet(null); }}>这一镜数字人出镜</button>}
          {(s.mat || s.avatar) && <button className="btn g sm" onClick={() => { setShot(s.id, { mat: null, avatar: false }); sheet(null); }}>去掉，交给 AI 生成</button>}
        </div>
        {list.length > 0 && <><p className="lb">或者从素材里挑</p><div className="pk">{[...d.mats, ...list.map(toMat).filter(m => !d.mats.some(x => x.id === m.id))].map(m => <button key={m.id} onClick={() => { setShot(s.id, { mat: m, avatar: false }); sheet(null); }}><Thumb mat={m} /><span>{m.name}</span></button>)}</div></>}
      </>,
    });
  };
  const confirm = () => sheet({
    title: '确认扣点',
    body: <div id="mkCostSheet">
      <p className="t2">本次消耗 {d.cost} 点</p>
      <p className="s m" style={{ marginTop: 8 }}>{t.n} · {shots.length} 个镜头 · 约 {totalSecs(shots)} 秒{missing ? ` · ${missing} 个镜头用 AI 生成补上` : ''}</p>
      <p className="s" style={{ marginTop: 12 }}>余额 {Math.round(session!.workspace.balance).toLocaleString()} → <b>{Math.round(session!.workspace.balance - d.cost).toLocaleString()}</b> 点</p>
      <p className="xs m3" style={{ marginTop: 8 }}>1 点 ≈ 1 秒成片。生成失败自动退点。</p>
    </div>,
    foot: <><button className="btn g" onClick={() => sheet(null)}>再看看</button><button className="btn k" id="mkPay" onClick={render}>确认，扣 {d.cost} 点生成</button></>,
  });
  const render = async () => {
    sheet(null);
    try {
      await api.render(d.title || shots[0]?.line.slice(0, 20) || t.n, d.cost);
      void reloadSession();
      for (let i = 0; i < 4; i++) { setRendering(i); await new Promise(r => setTimeout(r, 650)); }
      const p = pack({ ...d, shots });
      go(4, { shots, rendered: true, title: d.title || p.title, caption: p.caption, tags: p.tags.flatMap(([, l]) => l).filter((_, i) => [0, 1, 3, 7].includes(i)) });
    } catch (e) { fail(e); } finally { setRendering(-1); }
  };
  let at = 0;
  return <div className="stp" id="mkStep3">
    <div className="s3hd">
      <div><p className="t1">AI 按「{t.n}」排了 {shots.length} 个镜头，{chars(d.copy) ? '文案写好了' : '旁白先写了一版'}</p>
        <p className="s m" style={{ marginTop: 6 }}>每一镜都要一张画面，优先用你的真实案例照——AI 生成的只能补位，撑不起信任。</p></div>
      <span className="rdy" id="mkReady"><b>{ready}/{shots.length}</b> 已有你的素材</span>
    </div>
    <div className="outline" id="mkOutline"><b>故事梗概</b><span>开头 —— {shots[0]?.line}</span><span>中间 —— {shots.slice(1, -1).map(s => s.title.split('·')[0]).join(' → ') || '一镜到底'}</span><span>结尾 —— {shots[shots.length - 1]?.line}</span></div>
    <ol className="shots" id="mkShots">{shots.map(s => {
      const from = at; at += s.secs;
      const ed = edit === s.id;
      return <li key={s.id} className={shotReady(s) ? 'has' : ''} data-shot={s.id}>
        <span className="tm">{mmss(from)}–{mmss(at)}</span>
        {shotReady(s) ? <button className="shth" aria-label="换画面" onClick={() => addMedia(s)}><Thumb mat={s.mat} avatar={s.avatar ? d.avatar : null} k={s.k} /></button>
          : <button className="shth add" data-add={s.id} onClick={() => addMedia(s)}><span>＋</span>添加</button>}
        <div className="shb">
          {ed ? <>
            <input className="fld sm" value={s.title} onChange={e => setShot(s.id, { title: e.target.value })} aria-label="镜头名" />
            <textarea className="fld" rows={2} value={s.line} onChange={e => setShot(s.id, { line: e.target.value, secs: Math.max(3, Math.round(chars(e.target.value) / 4.5)) })} aria-label="这一镜的台词" style={{ marginTop: 6 }} />
          </> : <>
            <b>{s.title}</b>
            <q>{s.line}</q>
            <span className={`xs ${shotReady(s) ? 'ok' : 'm3'}`}>{s.avatar ? `已就绪·来自「管理我的素材」` : s.mat ? `已用你的 1 ${s.mat.kind === 'video' ? '段' : '张'} · ${d.opt.ratio === 'AI 推荐' ? '竖屏9:16' : d.opt.ratio}` : `建议：${s.tip}`}</span>
          </>}
        </div>
        <button className="lnk xs" data-edit={s.id} onClick={() => setEdit(ed ? null : s.id)}>{ed ? '好了' : '改'}</button>
      </li>;
    })}</ol>
    {rendering >= 0 && <div className="rendering" id="mkRendering" role="status">{['写分镜和字幕', '生成画面', '配音和音乐', '合成成片'].map((x, i) => <span key={x} className={i < rendering ? 'done' : i === rendering ? 'on' : ''}>{i < rendering ? '✓' : i === rendering ? '…' : '·'} {x}</span>)}</div>}
    <div className="stfoot">
      <button className="btn g" onClick={() => go(2)}>← 上一步</button>
      <span className="s">{missing ? `还有 ${missing} 个镜头没配图，会用 AI 生成补上 · ` : '画面都齐了 · '}消耗 <b>{d.cost}</b> 点</span>
      <button className="btn k" id="mkGen" disabled={rendering >= 0} onClick={() => { if (!d.shots.length) set({ shots }); confirm(); }}>确认并生成</button>
    </div>
  </div>;
}

function Step4({ d, set, go }: SP) {
  const { sheet, toast, nav, session } = useApp();
  const { st, save } = useStudio();
  const t = vtype(d.type);
  const p = useMemo(() => pack(d), [d.shots]); // eslint-disable-line react-hooks/exhaustive-deps
  const [voiceOn, setVoiceOn] = useState(false);
  const allTags = p.tags.flatMap(([, l]) => l);
  const okTitle = !!d.title.trim() && d.title.length <= 30, okCap = !!d.caption.trim(), okTags = d.tags.length >= 3 && d.tags.length <= 5;
  const checks: [string, boolean][] = [['视频', true], ['封面', true], ['标题', okTitle], ['文案', okCap], ['话题', okTags]];
  const n = checks.filter(c => c[1]).length;
  const ratio = d.opt.ratio === 'AI 推荐' ? '9:16 竖屏' : d.opt.ratio, font = d.opt.font === 'AI 推荐' ? '思源黑体' : d.opt.font;
  const first = d.shots.find(s => s.mat)?.mat ?? null, firstK = d.shots[0]?.k ?? 'live';
  const toggleTag = (x: string) => set({ tags: d.tags.includes(x) ? d.tags.filter(y => y !== x) : [...d.tags, x] });
  useEffect(() => () => { try { speechSynthesis.cancel(); } catch { /* */ } }, []);
  const queue = () => sheet({ title: '加入发布队列', body: <Queue d={d} plan={st!.plan} cols={st!.diag.result?.columns.map(c => c.n) ?? []} today={session!.today} onDone={(item, msg) => {
    const plan = d.planId && st!.plan.some(x => x.id === d.planId) ? st!.plan.map(x => x.id === d.planId ? { ...x, ...item, id: x.id, from: x.from } : x) : [...st!.plan, item];
    void save({ plan, draft: null });
    sheet(null); toast(msg); nav({ view: 'sched', id: item.id });
  }} /> });
  return <div className="stp" id="mkStep4">
    <div className="s4grid">
      <div className="s4l">
        <div className="vcard2">
          <Player shots={d.shots} ratio={ratio} font={font} title={d.title} avatar={d.avatar} />
          <div className="vmeta">
            <b>{d.title || p.title}</b><span className="xs m3">{t.n} · {mmss(totalSecs(d.shots))}</span>
            <dl className="vstats"><div><dt>类型</dt><dd>{t.n}</dd></div><div><dt>时长</dt><dd>{totalSecs(d.shots)}秒</dd></div><div><dt>消耗</dt><dd>{d.cost}点</dd></div><div><dt>余额</dt><dd>{Math.round(session!.workspace.balance).toLocaleString()}点</dd></div></dl>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn y sm" id="mkDl" onClick={() => toast('演示版：接上视频服务后这里下载 MP4 成片')}>下载成片</button>
              <button className="btn g sm" onClick={() => { setVoiceOn(v => !v); if (!voiceOn) speak(d.shots.map(s => s.line).join('。')); else try { speechSynthesis.cancel(); } catch { /* */ } }}>{voiceOn ? '停止试听' : '试听配音'}</button>
              <button className="lnk xs" onClick={() => go(3)}>← 回分镜改</button>
            </div>
            <p className="xs m3">比例 {d.opt.ratio === 'AI 推荐' ? 'AI推荐·9:16竖屏' : ratio} · 字幕 {d.opt.font === 'AI 推荐' ? 'AI推荐·思源黑体' : font} · 音乐 {d.opt.bgm === 'AI 推荐' ? `AI推荐·${t.bgm}` : d.opt.bgm} · 声音 {d.opt.voice === 'AI 推荐' ? 'AI推荐' : d.opt.voice}</p>
          </div>
        </div>
      </div>
      <div className="s4r">
        <div className="pubhd"><div><p className="t2">发布清单</p><p className="xs m3">能发出去的一条作品＝视频＋封面＋标题＋文案＋话题，都齐了再进队列。</p></div><span className={`rdy ${n === 5 ? 'ok' : ''}`} id="mkPub">{n}/5 已就绪</span></div>
        <ul className="checks">{checks.map(([k, ok]) => <li key={k} className={ok ? 'ok' : ''}>{ok ? '✓' : '·'} {k}</li>)}</ul>

        <div className="pubsec"><div className="row" style={{ justifyContent: 'space-between' }}><b>封面</b><span className="xs m3">封面文案决定点击率，用大字说人话</span></div>
          <div className="covers" id="mkCovers">{(['A', 'B', 'C'] as const).map(v => <button key={v} aria-pressed={d.cover === v} aria-label={`封面 ${v}`} onClick={() => set({ cover: v })}><CoverArt v={v} title={d.title || p.title} mat={first} k={firstK} /><span>{v}</span></button>)}</div>
          <a className="lnk xs" id="mkCoverTool" href={`${DAZHEIP_URL}/covers`} target={DAZHEIP_URL ? '_blank' : undefined} rel="noopener">去封面工具精修 →</a>
        </div>
        <div className="pubsec"><div className="row" style={{ justifyContent: 'space-between' }}><b>标题</b><span className={`xs ${d.title.length > 30 ? 'err' : 'm3'}`}>{d.title.length}/30 · 建议≤30字</span></div>
          <input className="fld" id="mkTitle" value={d.title} onChange={e => set({ title: e.target.value })} placeholder={p.title} />
        </div>
        <div className="pubsec"><div className="row" style={{ justifyContent: 'space-between' }}><b>发布文案</b><span className="xs m3">把选题自然地讲进正文，带钩子</span></div>
          <textarea className="fld" id="mkCaption" rows={4} value={d.caption} onChange={e => set({ caption: e.target.value })} />
        </div>
        <div className="pubsec"><div className="row" style={{ justifyContent: 'space-between' }}><b>话题</b><span className={`xs ${okTags ? 'm3' : 'err'}`}>{allTags.length} 个候选，选 3–5 个最佳，多了被判堆砌 · 已选 {d.tags.length}</span></div>
          {p.tags.map(([g, l]) => <div key={g} className="taggrp"><span className="xs m3">{g}</span>{l.map(x => <button key={x} className="pill sm" aria-pressed={d.tags.includes(x)} onClick={() => toggleTag(x)}>{x}</button>)}</div>)}
        </div>
        <div className="stfoot" style={{ marginTop: 18 }}>
          <span className="xs m3">{n === 5 ? '齐了，可以进队列。发布计划会自动按栏目排期。' : `还差：${checks.filter(c => !c[1]).map(c => c[0]).join('、')}`}</span>
          <button className="btn k" id="mkQueue" disabled={n < 5} onClick={queue}>加入发布队列 →</button>
        </div>
      </div>
    </div>
  </div>;
}

/** 加入发布队列：发哪个号、哪个栏目、什么时候（AI 先挑好空档） */
function Queue({ d, plan, cols, today, onDone }: { d: MakeDraft; plan: PlanItem[]; cols: string[]; today: string; onDone: (item: PlanItem, msg: string) => void }) {
  const from = d.planId ? plan.find(x => x.id === d.planId) : null;
  const accounts = [...new Set([...plan.map(x => x.account), ...ACCOUNTS])];
  const columns = [...new Set([...(from ? [from.column] : []), ...cols, '案例', '观点', '人设'])];
  const [acc, setAcc] = useState(from?.account ?? accounts[0]);
  const [col, setCol] = useState(from?.column ?? (d.type === 'talk' || d.type === 'explain' ? (cols[0] ?? '观点') : cols[0] ?? '案例'));
  const free = useMemo(() => {
    const out: string[] = [];
    if (from && from.when.slice(0, 10) >= today) out.push(from.when);
    for (let i = 1; out.length < 4 && i < 30; i++) { const w = `${addDays(today, i)}T19:00`; if (!plan.some(x => x.account === acc && x.when.slice(0, 10) === w.slice(0, 10) && x.id !== from?.id)) out.push(w); }
    return out;
  }, [acc]); // eslint-disable-line react-hooks/exhaustive-deps
  const [when, setWhen] = useState(free[0]);
  useEffect(() => { if (!free.includes(when)) setWhen(free[0]); }, [free]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = vtype(d.type);
  return <div id="mkQueueSheet">
    <p className="s m" style={{ marginBottom: 14 }}>「{d.title}」{from ? `（发布计划里的这一条）` : ''}</p>
    <p className="lb">发哪个号</p>
    <div className="pills" style={{ marginBottom: 14 }}>{accounts.map(a => <button key={a} className="pill sm" aria-pressed={acc === a} onClick={() => setAcc(a)}>{a}</button>)}</div>
    <p className="lb">放进哪个栏目</p>
    <div className="pills" style={{ marginBottom: 14 }}>{columns.map(c => <button key={c} className="pill sm" aria-pressed={col === c} onClick={() => setCol(c)}>{c}</button>)}</div>
    <p className="lb">什么时候发 <span className="xs m3">AI 挑了这个号的空档</span></p>
    <div className="pills">{free.map((w, i) => <button key={w} className="pill sm" data-when={w} aria-pressed={when === w} onClick={() => setWhen(w)}>{whenLabel(w, today)}{i === 0 ? ' · 推荐' : ''}</button>)}</div>
    <div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}>
      <button className="btn k" id="mkQueueOk" onClick={() => onDone({ id: from?.id ?? `v${Date.now().toString(36)}`, title: d.title, type: t.n, account: acc, column: col, when, status: '已排期', from: 'video' }, `已加入发布队列：${whenLabel(when, today)} 发「${acc}」`)}>放进 {whenLabel(when, today)}</button>
    </div>
  </div>;
}
