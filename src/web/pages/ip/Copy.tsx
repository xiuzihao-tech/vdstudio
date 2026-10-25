// 写文案：标题 / 钩子 / 正文 / 引导 / 话题；右侧实时检查（时长、违禁词、活人感）和下一步（送去生成 / 制作台 / 排期 / 封面）。
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { useApp, useData } from '../../store.tsx';
import { Empty, Ph, Seg, Skel, Src } from '../../ui/kit.tsx';
import { useAssetPicker, useScheduleTopic } from '../../ui/pickers.tsx';
import { checkCopy, copyLines, copyText, replaceAllBanned, replaceWord, secs, trimToLen, type Rewrite } from '../../../shared/copy.ts';
import { TOPIC_SOURCE_NAME, TOPIC_TYPES } from '../../../shared/catalog.ts';
import type { Asset, CopyDraft, CopyKind, CopyLen, Tone, Topic } from '../../../shared/types.ts';

export function Copy({ topicId }: { topicId?: string }) {
  const { nav } = useApp();
  const recent = useData(async () => { const [d, t] = await Promise.all([api.drafts(), api.allTopics()]); return { drafts: d.drafts, topics: t.topics }; }, []);
  if (!topicId) {
    if (!recent.data) return <Skel h={200} />;
    const { drafts, topics } = recent.data;
    const picks = [...drafts.map(d => topics.find(t => t.id === d.topicId)).filter((t): t is Topic => !!t), ...topics.filter(t => t.fav || t.source !== 'hot')].filter((t, i, a) => a.findIndex(x => x.id === t.id) === i).slice(0, 5);
    return <Empty title="先选一个选题" action={<>
      <div className="list" style={{ textAlign: 'left', marginBottom: 20 }}>{picks.map(t => <button key={t.id} onClick={() => nav({ view: 'ip', sub: 'copy', id: t.id })}><span>{t.title}<br /><span className="xs m3">{drafts.some(d => d.topicId === t.id) ? '有草稿 · ' : ''}{TOPIC_SOURCE_NAME[t.source]} · {t.dir}</span></span><span className="v">写 ›</span></button>)}</div>
      <button className="btn y" onClick={() => nav({ view: 'ip', sub: 'find' })}>去找选题</button></>}>文案从选题来。去选题库挑一个，或者从下面这几个继续。</Empty>;
  }
  return <Editor key={topicId} topicId={topicId} />;
}

function Editor({ topicId }: { topicId: string }) {
  const { nav, fail, toast, setGenSeed, setWbSeed, matSeed, setMatSeed, session } = useApp();
  const schedule = useScheduleTopic();
  const pick = useAssetPicker();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [sched, setSched] = useState<string | undefined>();
  const [d, setD] = useState<CopyDraft | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busy, setBusy] = useState<string | null>('load');
  const [quality, setQuality] = useState<'fast' | 'fine'>('fast');
  const [dirty, setDirty] = useState(false);
  const edited = useRef(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [all, ex, as] = await Promise.all([api.allTopics(), api.draft(topicId), api.assets()]);
        const t = all.topics.find(x => x.id === topicId);
        if (!t) { toast('这个选题不存在了'); nav({ view: 'ip', sub: 'find' }, true); return; }
        let draft = ex.draft;
        if (!draft) {
          const len = (parseInt(session!.persona.biz[0].len) || 45) as CopyLen;
          draft = (await api.genCopy(t.id, { len: ([30, 45, 60, 90].includes(len) ? len : 45) })).draft;
          if (matSeed?.length) { draft = { ...draft, assetIds: matSeed }; setMatSeed(null); }
        }
        if (!live) return;
        setTopic(t); setSched(all.scheduled[t.id]); setD(draft); setAssets(as.assets); setBusy(null);
      } catch (e) { if (live) { fail(e); setBusy(null); } }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId]);

  if (!d || !topic) return busy ? <div className="cpg"><div className="cpm"><Skel h={30} w="50%" /><div style={{ height: 16 }} /><Skel h={120} /></div><div className="cpside"><Skel h={160} /></div></div> : null;

  const ck = checkCopy(d);
  const upd = (p: Partial<CopyDraft>) => { setD({ ...d, ...p }); setDirty(true); edited.current = true; };
  const regen = async (o: { kind?: CopyKind; len?: CopyLen; tone?: Tone; version?: number; quality?: 'fast' | 'fine' }, keepTitle = true) => {
    setBusy('regen'); if (o.quality) setQuality(o.quality);
    try {
      const r = await api.genCopy(topic.id, { kind: o.kind ?? d.kind, len: o.len ?? d.len, tone: o.tone ?? d.tone, version: o.version ?? d.version, quality: o.quality ?? quality });
      const keep = keepTitle ? { title: d.title, hook: d.hook } : {};
      const body = o.kind && edited.current ? { body: d.body, cta: d.cta } : {};
      setD({ ...r.draft, ...keep, ...body, assetIds: d.assetIds }); setDirty(true);
    } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const rewrite = async (how: Rewrite) => {
    setBusy(how);
    try { const r = await api.rewrite(d, how); setD(r.draft); setDirty(true); toast(r.changed ? ({ live: `活人感优化：改了 ${r.changed} 处说法`, short: '每段更短了', long: '加了一段', alt: '换了个说法' })[how] : '没有需要改的地方'); } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const save = async (quiet = false) => { try { const s = await api.saveDraft(d); setD(s); setDirty(false); if (!quiet) toast('已存草稿，在“我的资产”里'); return s; } catch (e) { fail(e); return null; } };
  const usedAssets = d.assetIds.map(id => assets.find(a => a.id === id)).filter((a): a is Asset => !!a);

  const toGen = async () => { const s = await save(true); if (!s) return; setGenSeed({ copy: copyText(s), title: s.title, topicId: s.topicId, len: s.len, assetIds: s.assetIds }); nav('gen'); toast('文案已放进简易生成，选好模型和声音就能出片'); };
  const toWb = async () => { const s = await save(true); if (!s) return; setWbSeed({ title: s.title, lines: copyLines(s), assetIds: s.assetIds, topicId: s.topicId }); nav('wb'); };

  return <div className="cpg">
    <div className="cpm">
      <div className="cphd">
        <div style={{ flex: 1, minWidth: 220 }}>
          <p className="xs m3">选题 · {TOPIC_SOURCE_NAME[topic.source]}{topic.why ? ` · ${topic.why}` : ''}</p>
          <h2 className="d3" style={{ marginTop: 4 }}>{topic.title}</h2>
          <div className="row" style={{ gap: 6, marginTop: 8 }}><Src>{topic.dir}</Src><Src>{TOPIC_TYPES[topic.type]}</Src>{sched && <Src k="real">已排期 {sched}</Src>}{dirty && <Src k="warn">未保存</Src>}</div>
        </div>
        <div className="row" style={{ gap: 6 }}><button className="btn g sm" onClick={() => nav({ view: 'ip', sub: 'find' })}>换选题</button><button className="btn g sm" id="cpRe" disabled={!!busy} onClick={() => { void regen({ version: d.version + 1, quality: 'fast' }, false).then(() => toast(`第 ${d.version + 1} 版`)); }}>重新生成</button><button className="btn g sm" id="cpFine" disabled={!!busy} title="用更强的模型重写一版，慢一点" onClick={() => { void regen({ version: d.version + 1, quality: 'fine' }, false).then(() => toast('精写好了')); }}>{busy === 'regen' && quality === 'fine' ? '精写中…' : '✦ 精写一版'}</button></div>
      </div>
      <div className="cpset">
        <span>类型 <Seg value={d.kind} options={['口播', '图文笔记', '分镜脚本'] as const} onChange={k => regen({ kind: k })} /></span>
        <span>时长 <Seg value={d.len} options={[30, 45, 60, 90] as const} render={v => `${v} 秒`} onChange={l => regen({ len: l })} /></span>
        <span>语气 <Seg value={d.tone} options={['亲切', '专业', '犀利', '幽默'] as const} onChange={t => regen({ tone: t })} /></span>
      </div>
      <fieldset disabled={busy === 'regen'} style={{ border: 0, padding: 0, margin: 0, opacity: busy === 'regen' ? 0.5 : 1 }}>
        <div className="cps"><div className="lbl"><b>标题</b><span>选一个，或者直接改</span></div>
          <div className="opts">{d.titles.map((x, i) => <button key={i} aria-pressed={d.title === x} onClick={() => upd({ title: x })}>{x}</button>)}</div>
          <input className="fld" id="cpTitle" aria-label="标题" value={d.title} onChange={e => upd({ title: e.target.value })} /></div>
        <div className="cps"><div className="lbl"><b>开头钩子</b><span>前 3 秒决定有没有人看下去</span></div>
          <div className="opts">{d.hooks.map((x, i) => <button key={i} aria-pressed={d.hook === x} onClick={() => upd({ hook: x })}>{x}</button>)}</div>
          <Grow id="cpHook" label="开头钩子" value={d.hook} onChange={v => upd({ hook: v })} /></div>
        <div className="cps"><div className="lbl"><b>{d.kind === '图文笔记' ? '正文' : '口播正文'}</b><span>{d.kind === '分镜脚本' ? '左边是建议画面' : '每段大致对应一个镜头'}</span></div>
          {d.body.map((x, i) => <div className="para" key={i}>
            <span className="pl"><b>{d.kind === '分镜脚本' ? `镜头 ${i + 2}` : `第 ${i + 1} 段`}</b>{d.kind === '分镜脚本' ? d.shots[i] ?? '' : `${secs(x)} 秒`}</span>
            <Grow label={`第 ${i + 1} 段`} dataKey={i} value={x} onChange={v => upd({ body: d.body.map((y, j) => j === i ? v : y) })} />
          </div>)}
          <div className="row" style={{ gap: 8, marginTop: 4 }}><button className="lnk xs" onClick={() => upd({ body: [...d.body, `再补一个细节：${topic.hook}。`], shots: [...d.shots, '细节特写'] })}>＋ 加一段</button>{d.body.length > 2 && <button className="lnk xs" onClick={() => upd({ body: d.body.slice(0, -1) })}>删掉最后一段</button>}</div>
        </div>
        <div className="cps"><div className="lbl"><b>结尾引导</b><span>看完让对方做什么</span></div><Grow id="cpCta" label="结尾引导" value={d.cta} onChange={v => upd({ cta: v })} /></div>
        <div className="cps"><div className="lbl"><b>话题</b></div><input className="fld" aria-label="话题" value={d.tags.join(' ')} onChange={e => upd({ tags: e.target.value.split(/\s+/).filter(Boolean) })} /></div>
      </fieldset>
    </div>
    <aside className="cpside">
      <div className="cside" id="cpCheck" aria-live="polite">
        <div className="hd">检查<span>{ck.chars} 字 · 约 {ck.secs} 秒</span></div>
        <p className="s" style={{ color: ck.fits ? 'var(--real)' : 'var(--warn)' }}>{ck.fits ? `时长合适：目标 ${d.len} 秒` : `比目标 ${d.len} 秒长了约 ${ck.over} 秒`}</p>
        {!ck.fits && <div className="row" style={{ gap: 6, marginTop: 8 }}><button className="btn g sm" data-cf="short" onClick={() => upd(trimToLen(d))}>缩到 {d.len} 秒</button><button className="btn g sm" data-cf="len" onClick={() => upd({ len: ck.suggestLen })}>时长改为 {ck.suggestLen} 秒</button></div>}
        <p className="s" style={{ marginTop: 12 }}>违禁词 {ck.banned.length ? <b style={{ color: 'var(--err)' }}>{ck.banned.length} 处</b> : <b style={{ color: 'var(--real)' }}>没有</b>}</p>
        {ck.banned.map(([w, r]) => <div className="bad" key={w}><span><mark>{w}</mark> → {r}</span><button className="lnk xs" data-rep={w} onClick={() => { upd(replaceWord(d, w)); toast('已替换'); }}>替换</button></div>)}
        {ck.banned.length > 1 && <button className="btn g sm" style={{ marginTop: 8 }} data-repall onClick={() => { upd(replaceAllBanned(d)); toast('违禁词已全部替换'); }}>全部替换</button>}
        <p className="s" style={{ marginTop: 12 }}>活人感 <b>{d.live}</b><span className="xs m3"> / 100</span></p><div className="meter"><i style={{ width: `${d.live}%` }} /></div>
      </div>
      <div className="cside"><div className="hd">改写</div><div className="toolg">
        {([['live', '活人感优化'], ['short', '缩短一点'], ['long', '扩写一段'], ['alt', '换个说法']] as const).map(([k, n]) => <button key={k} data-cw={k} disabled={!!busy} onClick={() => rewrite(k)}>{busy === k ? '改写中…' : n}</button>)}
      </div></div>
      <div className="cside"><div className="hd">素材<span>{usedAssets.length ? `已带 ${usedAssets.length} 份` : '生成时用'}</span></div>
        <div className="row" style={{ gap: 6 }}>
          {usedAssets.slice(0, 5).map(a => <button key={a.id} title="点一下移除" style={{ width: 44, height: 44, borderRadius: 8, overflow: 'hidden', position: 'relative' }} onClick={() => upd({ assetIds: d.assetIds.filter(x => x !== a.id) })}><Ph k={a.k} asset={a} /></button>)}
          <button className="btn g sm" id="cpAss" onClick={() => pick(l => { setAssets(prev => [...l.filter(a => !prev.some(p => p.id === a.id)), ...prev]); upd({ assetIds: [...new Set([...d.assetIds, ...l.map(a => a.id)])] }); })}>从素材库选</button>
        </div>
      </div>
      <div className="cside"><div className="hd">下一步</div><div className="stack">
        <button className="btn y" id="toGen" onClick={toGen}>送去生成视频</button>
        <button className="btn g" id="toWb" onClick={toWb}>送去制作台（逐镜调整）</button>
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <button className="btn g sm" style={{ flex: 1 }} id="cpSave" onClick={() => save()}>存草稿</button>
          <button className="btn g sm" style={{ flex: 1 }} id="cpSch" onClick={async () => { await save(true); schedule(topic); }}>加入排期</button>
          <button className="btn g sm" style={{ flex: 1 }} id="cpCov" onClick={async () => { await save(true); nav({ view: 'ip', sub: 'cover', id: topic.id }); }}>做封面</button>
        </div>
        <button className="lnk xs" style={{ alignSelf: 'center', marginTop: 4 }} onClick={() => navigator.clipboard?.writeText(`${d.title}\n\n${copyText(d)}\n\n${d.tags.join(' ')}`).then(() => toast('已复制'), () => toast('复制不可用，请手动选择'))}>复制全文</button>
      </div></div>
    </aside>
  </div>;
}

/** 自动长高的文本框 */
function Grow({ value, onChange, label, id, dataKey }: { value: string; onChange: (v: string) => void; label: string; id?: string; dataKey?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const t = ref.current; if (t) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; } }, [value]);
  return <textarea ref={ref} id={id} data-bi2={dataKey} className="fld grow" rows={1} aria-label={label} value={value} onChange={e => onChange(e.target.value)} />;
}
