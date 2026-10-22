// 找选题：IP 定位卡、三个入口、选题情报库组合筛选、选题卡（深挖 / 收藏 / 排期 / 开始创作）。
import { useState } from 'react';
import { api, type TopicFilter } from '../../api.ts';
import { useApp, useData } from '../../store.tsx';
import { Ph, Skel, Src, pickFiles } from '../../ui/kit.tsx';
import { useAssetPicker, useScheduleTopic, uploadFiles, ACCEPT } from '../../ui/pickers.tsx';
import { CATS, DIRS, HEATS, PERIODS, TOPIC_SOURCE_NAME, TOPIC_TYPES } from '../../../shared/catalog.ts';
import type { Asset, Positioning, Topic } from '../../../shared/types.ts';

const REFD = ['运镜', '叙事结构', '剪辑节奏', '画面质感', '人物表达', '产品展示'];

export function Find() {
  const { session } = useApp();
  const [entry, setEntry] = useState<null | 'case' | 'bench' | 'mat'>(null);
  const [filter, setFilter] = useState<TopicFilter>(() => ({ cat: Math.max(0, session!.personas.findIndex(p => p.id === session!.persona.id)), dir: '不限', type: '不限', heat: '不限', period: '不限' }));
  const list = useData(() => api.topics(filter), [JSON.stringify(filter)]);
  const stats = useData(async () => { const [t, d, p] = await Promise.all([api.allTopics(), api.drafts(), api.plans()]); return { fav: t.topics.filter(x => x.fav).length, drafts: d.drafts.length, fixed: p.plans.reduce((a, b) => a + b.slots.filter(s => !('empty' in s) && s.date > session!.today && s.pin === 'fixed').length, 0) }; }, []);

  return <>
    <IpCard stats={stats.data} />
    <div className="entries" role="group" aria-label="从哪里开始">
      {([['case', '我有案例，帮我策划选题', '写几句项目情况、传几张图，AI 结合人设出选题'], ['bench', '我有对标，帮我复刻爆款', '贴一条爆款链接，拆开头、结构和讲法，换成你的内容'], ['mat', '我有素材，帮我创作文案', '从素材库选照片视频，直接写出能拍的口播']] as const).map(([k, t, d], i) => (
        <button key={k} className="entry" data-en={k} aria-pressed={entry === k} onClick={() => setEntry(entry === k ? null : k)}>
          <span className="n">{i + 1}</span><span><span className="t2" style={{ display: 'block' }}>{t}</span><span className="s m" style={{ display: 'block', marginTop: 4 }}>{d}</span></span>
        </button>))}
    </div>
    {entry && <div className="epanel" id="epanel">{entry === 'case' ? <CasePanel /> : entry === 'bench' ? <BenchPanel /> : <MatPanel />}</div>}

    <div className="row" style={{ marginTop: 44, alignItems: 'flex-end' }}>
      <div style={{ flex: 1 }}><h2 className="t1">今日热门选题</h2><p className="s m" style={{ marginTop: 4 }}>行业里正在被讨论的话题，按你的人设筛好了。</p></div>
      <span className="xs m3" id="hotN">{list.data ? `${list.data.topics.length} 个选题` : ''}</span>
    </div>
    <div className="flt" aria-label="组合筛选选题">
      <FRow label="品类" k="cat" value={filter.cat} opts={[['all', '不限'], ...CATS.map((c, i) => [i, c] as [number, string])]} set={v => setFilter({ ...filter, cat: v as TopicFilter['cat'] })} />
      <FRow label="选题方向" k="dir" value={filter.dir} opts={[['不限', '不限'], ...DIRS.map(d => [d, d] as [string, string])]} set={v => setFilter({ ...filter, dir: String(v) })} />
      <FRow label="选题类型" k="type" value={filter.type} opts={[['不限', '不限'], ...TOPIC_TYPES.map((d, i) => [i, d] as [number, string])]} set={v => setFilter({ ...filter, type: v as TopicFilter['type'] })} />
      <FRow label="热度等级" k="heat" value={filter.heat} opts={[['不限', '不限'], ...HEATS.map((d, i) => [i + 1, d] as [number, string])]} set={v => setFilter({ ...filter, heat: v as TopicFilter['heat'] })} />
      <FRow label="时间范围" k="period" value={filter.period} opts={[['不限', '不限'], ...PERIODS.map(([n, m]) => [m, n] as [number, string])]} set={v => setFilter({ ...filter, period: v as TopicFilter['period'] })} />
    </div>
    <div className="hot" id="hot">
      {!list.data ? [0, 1, 2].map(i => <div key={i} className="hc"><Skel w="60%" /><Skel h={22} /><Skel w="80%" /></div>)
        : list.data.topics.length ? list.data.topics.map(t => <TopicCard key={t.id} t={t} sched={list.data!.scheduled[t.id]} onChange={() => { list.reload(); stats.reload(); }} />)
          : <p className="s m" style={{ gridColumn: '1/-1', textAlign: 'center', padding: '40px 0' }}>这个组合下没有选题。放宽一个条件试试，或者用上面的“我有案例”自己生成。</p>}
    </div>
  </>;
}

function FRow({ label, k, value, opts, set }: { label: string; k: string; value: unknown; opts: [string | number, string][]; set: (v: string | number) => void }) {
  return <div className="fr"><span className="fl">{label}</span><div data-ff={k}>{opts.map(([v, t]) => <button key={String(v)} className="pill sm" data-v={String(v)} aria-pressed={String(value) === String(v)} onClick={() => set(v)}>{t}</button>)}</div></div>;
}

/* ---------- IP 定位 ---------- */
function IpCard({ stats }: { stats: { fav: number; drafts: number; fixed: number } | null }) {
  const { session, sheet } = useApp();
  const p = session!.workspace.positioning;
  return <div className="ipcard" id="ipCard">
    <div className="av"><Ph k="person" /></div>
    <div style={{ minWidth: 0 }}>
      <p className="xs m3">人设 · {session!.persona.n}</p><p className="t1" style={{ marginTop: 2 }}>{p.name}</p><p className="s m" style={{ marginTop: 2 }}>{p.line}</p>
      <div className="row" style={{ gap: 6, marginTop: 8 }}>{p.tags.map(t => <Src key={t}>{t}</Src>)}<Src k="y">语气 · {p.tone}</Src></div>
    </div>
    <div className="ipstat"><div><b>{stats?.fav ?? '–'}</b>收藏选题</div><div><b>{stats?.drafts ?? '–'}</b>草稿</div><div><b>{stats?.fixed ?? '–'}</b>已固定排期</div></div>
    <button className="btn g sm" id="posBtn" onClick={() => sheet({ title: 'IP 定位', body: <PosForm initial={p} /> })}>改 IP 定位</button>
  </div>;
}
function PosForm({ initial }: { initial: Positioning }) {
  const { session, setSession, sheet, toast, fail } = useApp();
  const [p, setP] = useState<Positioning>(initial);
  const [tags, setTags] = useState(initial.tags.join('，'));
  const per = session!.persona;
  const tog = (arr: string[], v: string) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
  const save = async () => {
    try {
      const s = await api.savePositioning({ ...p, aud: p.aud.length ? p.aud : [per.aud[0]], tags: tags.split(/[，,]/).map(x => x.trim()).filter(Boolean).slice(0, 5) });
      setSession(s); sheet(null); toast('定位已保存，选题、文案和 AI 预选题都会按这个来');
    } catch (e) { fail(e); }
  };
  return <>
    <label className="lb" htmlFor="posName">账号名</label><input className="fld" id="posName" value={p.name} onChange={e => setP({ ...p, name: e.target.value })} />
    <label className="lb" htmlFor="posLine" style={{ marginTop: 14 }}>一句话定位</label>
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><input className="fld" id="posLine" value={p.line} onChange={e => setP({ ...p, line: e.target.value })} /><button className="btn g sm" onClick={() => setP({ ...p, line: `${per.n}里最愿意讲细节的那个，只讲${per.focus.split('，')[0]}` })}>AI 写</button></div>
    <p className="lb" style={{ marginTop: 14 }}>给谁看</p><div className="pills">{per.aud.map(a => <button key={a} className="pill sm" aria-pressed={p.aud.includes(a)} onClick={() => setP({ ...p, aud: tog(p.aud, a) })}>{a}</button>)}</div>
    <p className="lb" style={{ marginTop: 14 }}>内容栏目</p><div className="pills">{per.biz.map(b => <button key={b.n} className="pill sm" aria-pressed={p.pillars.includes(b.n)} onClick={() => setP({ ...p, pillars: tog(p.pillars, b.n) })}>{b.n}</button>)}</div>
    <p className="lb" style={{ marginTop: 14 }}>语气</p><div className="pills" id="posTone">{(['亲切', '专业', '犀利', '幽默'] as const).map(t => <button key={t} className="pill sm" aria-pressed={p.tone === t} onClick={() => setP({ ...p, tone: t })}>{t}</button>)}</div>
    <label className="lb" htmlFor="posTags" style={{ marginTop: 14 }}>人设标签 <span className="m3">逗号分隔，最多 5 个</span></label><input className="fld" id="posTags" value={tags} onChange={e => setTags(e.target.value)} />
    <p className="note">栏目也是排期里“发什么”的推子。</p>
    <div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}><button className="btn g" onClick={() => sheet(null)}>取消</button><button className="btn y" id="posOk" onClick={save}>保存</button></div>
  </>;
}

/* ---------- 选题卡 ---------- */
export function TopicCard({ t, sched, onChange }: { t: Topic; sched?: string; onChange: () => void }) {
  const { nav, place, setPlace, toast, fail, sheet, bump } = useApp();
  const schedule = useScheduleTopic();
  const fav = async () => { try { await api.fav(t.id, !t.fav); toast(t.fav ? '已取消收藏' : '已收藏，在“我的资产”和排期里都能找到'); onChange(); } catch (e) { fail(e); } };
  const placeHere = async () => {
    if (!place) return;
    try { const r = await api.slot(place.planId, place.date, 'set', t.id); setPlace(null); bump(); toast(r.message); nav('plan'); } catch (e) { fail(e); }
  };
  return <article className={`hc${t.source !== 'hot' ? ' ai' : ''}`} data-tid={t.id}>
    <div className="tags"><Src>{t.dir}</Src><Src k={t.type === 2 ? 'real' : t.type === 1 ? 'gen' : ''}>{TOPIC_TYPES[t.type]}</Src>{t.source !== 'hot' && <Src k="gen">{TOPIC_SOURCE_NAME[t.source]}</Src>}<span className="heat">{HEATS[t.heat - 1].split(' ')[0]}</span></div>
    <h3>{t.title}</h3><p className="hook">{t.hook}</p>
    {sched && <p className="xs" style={{ color: 'var(--real)' }}>已排期 · {sched}</p>}
    <div className="act">
      <button className="lnk s" data-act="dig" onClick={() => sheet({ title: `深挖：${t.title}`, body: <Dig t={t} /> })}>深挖这个选题</button><span className="sp" />
      <button className="star" data-act="fav" aria-pressed={t.fav} aria-label="收藏" onClick={fav}>{t.fav ? '★' : '☆'}</button>
      {place ? <button className="btn y sm" data-act="place" onClick={placeHere}>放到 {place.label.split(' · ')[1]?.split(' ')[0] ?? '这天'}</button>
        : <><button className="btn g sm" data-act="sch" onClick={() => schedule(t)}>排期</button><button className="btn k sm" data-act="write" onClick={() => nav({ view: 'ip', sub: 'copy', id: t.id })}>开始创作</button></>}
    </div>
  </article>;
}

function Dig({ t }: { t: Topic }) {
  const { nav, sheet, fail, session } = useApp();
  const schedule = useScheduleTopic();
  const angles = useData(() => api.angles(t.id), [t.id]);
  const b = t.title.replace(/[，。？?！!]+$/, '');
  const biz = session!.persona.biz[0];
  const useAngle = async (title: string) => {
    try { const n = await api.addTopic({ title, hook: t.hook, dir: t.dir, type: t.type, heat: t.heat, k: t.k, source: 'angle', why: `从「${t.title}」深挖` }); sheet(null); nav({ view: 'ip', sub: 'copy', id: n.id }); } catch (e) { fail(e); }
  };
  return <>
    <p className="lb">换个角度讲</p>
    <div className="list">{angles.data ? angles.data.angles.map((a, i) => <button key={i} data-ang={i} onClick={() => useAngle(a.title)}><span><span className="xs m3">{a.label}</span><br />{a.title}</span><span className="v">用这个写 ›</span></button>) : <div><Skel /></div>}</div>
    <p className="lb" style={{ marginTop: 16 }}>开头钩子</p><div className="list"><div>{t.hook}</div><div>你是不是也以为，{b}很简单？</div></div>
    <div className="list" style={{ marginTop: 16 }}><div><span>给谁看</span><span className="v">{session!.workspace.positioning.aud.join('、')}</span></div><div><span>建议讲法</span><span className="v">{biz.n} · {biz.len}</span></div></div>
    <div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}>
      <button className="btn g" onClick={() => schedule(t)}>加入排期</button>
      <button className="btn y" id="dGo" onClick={() => { sheet(null); nav({ view: 'ip', sub: 'copy', id: t.id }); }}>开始创作</button>
    </div>
  </>;
}

/* ---------- 入口一：案例策划 ---------- */
function CasePanel() {
  const { session, fail, toast } = useApp();
  const [text, setText] = useState('');
  const [imgs, setImgs] = useState<Asset[]>([]);
  const [out, setOut] = useState<Topic[] | null>(null);
  const [busy, setBusy] = useState(false);
  const add = async () => { const f = await pickFiles('image/*'); if (!f.length) return; try { const a = await uploadFiles(f.slice(0, 5 - imgs.length), '案例图'); setImgs([...imgs, ...a]); } catch (e) { fail(e); } };
  const go = async () => {
    setBusy(true);
    try { const r = await api.fromCase(text, imgs.map(i => i.k)); setOut(r.topics); toast('3 个方向已放进选题库最前面'); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return <>
    <label className="lb" htmlFor="caseTx">关键词 / 案例说明</label>
    <textarea className="fld" id="caseTx" rows={3} value={text} onChange={e => setText(e.target.value)} placeholder={`例如：${session!.persona.proj}，${session!.persona.focus}`} />
    <div className="imgs">{imgs.map((a, i) => <button key={a.id} className="th" aria-label="移除这张图" onClick={() => setImgs(imgs.filter((_, j) => j !== i))}><Ph k={a.k} asset={a} /></button>)}{imgs.length < 5 && <button className="add" id="caseAdd" aria-label="添加案例图片" onClick={add}>+</button>}</div>
    <p className="xs m3" style={{ marginTop: 6 }}>已添加 {imgs.length}/5 · JPG、PNG、WebP</p>
    <div className="row" style={{ marginTop: 14 }}><span style={{ flex: 1 }} /><button className="btn y" id="caseGo" disabled={busy} onClick={go}>{busy ? '生成中…' : '结合人设生成选题'}</button></div>
    {busy && <div className="hot">{[0, 1, 2].map(i => <div key={i} className="hc"><Skel w="60%" /><Skel h={20} /></div>)}</div>}
    {out && !busy && <div className="hot" id="caseOut">{out.map(t => <TopicCard key={t.id} t={t} onChange={() => { }} />)}</div>}
  </>;
}

/* ---------- 入口二：对标复刻 ---------- */
function BenchPanel() {
  const { fail, nav } = useApp();
  const [url, setUrl] = useState('');
  const [learn, setLearn] = useState(REFD.slice(0, 3));
  const [res, setRes] = useState<Awaited<ReturnType<typeof api.benchmark>> | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const u = url.trim() || 'https://v.douyin.com/示例'; setUrl(u); setBusy(true);
    try { setRes(await api.benchmark(u, learn)); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const use = async () => { if (!res) return; try { const t = await api.addTopic({ ...res.topic, source: 'bench' }); nav({ view: 'ip', sub: 'copy', id: t.id }); } catch (e) { fail(e); } };
  return <>
    <label className="lb" htmlFor="benchIn">对标视频链接</label>
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><input className="fld" id="benchIn" value={url} onChange={e => setUrl(e.target.value)} placeholder="粘贴抖音、小红书、视频号的分享链接" /><button className="btn y" id="benchGo" disabled={busy} onClick={go}>{busy ? '拆解中…' : '拆解'}</button></div>
    <p className="lb" style={{ marginTop: 14 }}>想学它的</p>
    <div className="pills">{REFD.map(d => <button key={d} className="pill sm" aria-pressed={learn.includes(d)} onClick={() => setLearn(learn.includes(d) ? learn.filter(x => x !== d) : [...learn, d])}>{d}</button>)}</div>
    <p className="xs m3" style={{ marginTop: 8 }}>只学方法，不搬画面和原文案。</p>
    {busy && <div style={{ marginTop: 18 }}><Skel h={80} /></div>}
    {res && !busy && <>
      <div className="list" style={{ marginTop: 18 }}><div style={{ display: 'block' }}>
        <p className="row" style={{ gap: 8, marginBottom: 10 }}><b>拆解结果</b><Src>{res.platform}</Src></p>
        <dl className="anl">{res.rows.flatMap(([k, v]) => [<dt key={k + 't'}>{k}</dt>, <dd key={k + 'd'}>{v}</dd>])}</dl>
      </div></div>
      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}><button className="btn y sm" id="benchUse" onClick={use}>复刻成我的选题</button></div>
    </>}
  </>;
}

/* ---------- 入口三：素材创作 ---------- */
function MatPanel() {
  const { fail, nav, matSeed, setMatSeed } = useApp();
  const pick = useAssetPicker();
  const all = useData(() => api.assets(), []);
  const [sel, setSel] = useState<string[]>(() => matSeed ?? []);
  const [note, setNote] = useState('');
  const go = async () => {
    if (!sel.length) return;
    try { const t = await api.fromMaterials(sel, note); setMatSeed(sel); nav({ view: 'ip', sub: 'copy', id: t.id }); } catch (e) { fail(e); }
  };
  const A = all.data?.assets ?? [];
  const shown = [...A.filter(a => sel.includes(a.id)), ...A.filter(a => !sel.includes(a.id))].slice(0, 8);
  return <>
    <p className="lb">选几份素材（{sel.length} 已选）</p>
    <div className="pk">{shown.map(a => <button key={a.id} data-am={a.id} aria-pressed={sel.includes(a.id)} onClick={() => setSel(sel.includes(a.id) ? sel.filter(x => x !== a.id) : [...sel, a.id])}><Ph k={a.k} asset={a} /><span>{a.type}</span></button>)}</div>
    <div className="row" style={{ marginTop: 10 }}><button className="lnk xs" onClick={() => pick(l => { setSel([...new Set([...sel, ...l.map(a => a.id)])]); all.reload(); })}>从素材库导入更多 / 上传</button></div>
    <label className="lb" htmlFor="matTx" style={{ marginTop: 14 }}>一句话补充 <span className="m3">可选</span></label>
    <input className="fld" id="matTx" value={note} onChange={e => setNote(e.target.value)} placeholder="比如：想强调收纳，给新房业主看" />
    <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}><button className="btn y" id="matGo" disabled={!sel.length} onClick={go}>{sel.length ? '直接写文案' : '先选至少 1 份素材'}</button></div>
  </>;
}

export { ACCEPT };
