// 简易生成：文案 + 素材 → 模型、时长、画面、声音、音乐字幕 → 出片。冲突在前端实时提示，提交时后端再校验一次。
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.ts';
import { useApp, useData } from '../store.tsx';
import { Ph, Pills, Seg, Src, Steps, Toggle, usePay } from '../ui/kit.tsx';
import { useAssetPicker, useScheduleTopic } from '../ui/pickers.tsx';
import { useCloneVoice } from './ip/More.tsx';
import { BGMS, STYLES, VOICES } from '../../shared/catalog.ts';
import { clampRes, genCost, genIssues, genLines, isDraft, modelOf, planShots, trimCopyToLen, videoModels } from '../../shared/gen.ts';
import { copyText, secs } from '../../shared/copy.ts';
import type { Asset, GenSettings, Job, VideoOutput } from '../../shared/types.ts';

const KEY_BASE = 'findai.gen';
const DEFAULT: GenSettings = { copy: '', prompt: '', title: '', topicId: null, assetIds: [], model: 's25', len: 45, ratio: '9:16', res: '1080p', draft: true, voice: 'p1', speed: 1, bgm: '温暖钢琴', subs: true, ambience: true, cover: true, style: 'AI 推荐' };
const load = (KEY: string): GenSettings => { try { return { ...DEFAULT, ...JSON.parse(sessionStorage.getItem(KEY) ?? '{}') }; } catch { return DEFAULT; } };

export function GenPage() {
  const { session, genSeed, setGenSeed, nav, toast, fail, sheet, setWbSeed, bumpJobs } = useApp();
  // 按工作区分开保存，切换身份后不会带上另一个工作区的任务
  const KEY = `${KEY_BASE}.${session!.workspace.id}`;
  const pay = usePay();
  const pickAssets = useAssetPicker();
  const clone = useCloneVoice();
  const schedule = useScheduleTopic();
  const [g, setG] = useState<GenSettings>(() => {
    const base = load(KEY);
    if (!genSeed) return base;
    return { ...base, prompt: '', title: '', topicId: null, ...genSeed, assetIds: genSeed.assetIds ?? base.assetIds };
  });
  const [tab, setTab] = useState<'copy' | 'prompt'>('copy');
  const [jobId, setJobId] = useState<string | null>(() => sessionStorage.getItem(`${KEY}.job`));
  const [job, setJob] = useState<Job | null>(null);
  const assets = useData(() => api.assets(), []);
  const topics = useData(() => api.allTopics(), []);

  useEffect(() => { if (genSeed) setGenSeed(null); /* 交接数据只用一次 */ }, [genSeed, setGenSeed]);
  // 换了档位（或中转站的档位最高只到 720p）时，清晰度自动退到这个档位支持的最高一档
  useEffect(() => { const r = clampRes(g.model, g.res); if (r !== g.res) setG(x => ({ ...x, res: r })); }, [g.model, g.res]);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(g)); } catch { /* 隐私模式 */ } }, [g]);
  // 第一次进来、还没放素材：默认带上项目素材（不含人物）
  useEffect(() => { if (assets.data && !g.assetIds.length && !sessionStorage.getItem(`${KEY}.touched`)) setG(x => ({ ...x, assetIds: assets.data!.assets.filter(a => a.type !== '人物').slice(0, 4).map(a => a.id) })); }, [assets.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // 轮询任务
  useEffect(() => {
    if (!jobId) return;
    let live = true, h: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const j = await api.job(jobId); if (!live) return; setJob(j);
        if (j.status === 'queued' || j.status === 'running') h = setTimeout(tick, 700);
        else { bumpJobs(); if (j.status === 'done') toast(j.kind === 'video_final' ? '成片好了，可以下载' : '视频好了'); if (j.status === 'failed') toast(`生成失败：${j.error}，点数已退回`); }
      } catch { sessionStorage.removeItem(`${KEY}.job`); setJobId(null); }
    };
    void tick();
    return () => { live = false; clearTimeout(h); };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (p: Partial<GenSettings>) => { sessionStorage.setItem(`${KEY}.touched`, '1'); setG(x => ({ ...x, ...p })); };
  const allAssets = assets.data?.assets ?? [];
  const used = g.assetIds.map(id => allAssets.find(a => a.id === id)).filter((a): a is Asset => !!a);
  const m = modelOf(g.model);
  const vc = session!.workspace.voiceClone;
  const issues = useMemo(() => genIssues({ ...g, assetIds: used.map(a => a.id) }, vc), [g, used.length, vc]); // eslint-disable-line react-hooks/exhaustive-deps
  const shots = useMemo(() => planShots(g, used.map(a => a.k), session!.persona.att), [g, used, session]);
  const cost = genCost(g);
  const blocked = issues.some(i => i.blocking);
  const running = job && (job.status === 'queued' || job.status === 'running');
  const topic = g.topicId ? topics.data?.topics.find(t => t.id === g.topicId) : null;
  const lines = genLines(g.copy);

  const fix = async (id: string) => {
    const [k, v] = id.split(':');
    if (k === 'model') set({ model: v, draft: modelOf(v).draft });
    if (k === 'res') set({ res: v as GenSettings['res'] });
    if (k === 'len') set({ len: Number(v) });
    if (k === 'voice') set({ voice: v as GenSettings['voice'] });
    if (k === 'trim') set({ copy: trimCopyToLen(g.copy, g.len) });
    if (k === 'clone') clone();
    if (k === 'pick') pickAssets(l => set({ assetIds: [...new Set([...g.assetIds, ...l.map(a => a.id)])] }), { already: g.assetIds });
    if (k === 'goto') nav({ view: 'ip', sub: 'find' });
    if (k === 'ai') {
      try {
        const t = topics.data?.topics[0]; if (!t) return;
        const r = await api.genCopy(t.id, { len: ([30, 45, 60, 90].find(x => x >= g.len) ?? 90) });
        const d = await api.saveDraft(r.draft);
        set({ copy: copyText(d), title: d.title, topicId: d.topicId }); toast('AI 先写了一版，可以直接改');
      } catch (e) { fail(e); }
    }
  };

  const submit = (final: boolean) => {
    const title = g.title || lines[0]?.slice(0, 20) || '未命名';
    const c = final ? genCost(g, true) : cost;
    pay({
      title: final ? '转成片' : `生成视频${isDraft(g) ? ' · 样片' : ''}`,
      lines: final ? [[`${shots.length} 镜 · ${g.res} · ${g.len} 秒`, c]] : [[`${shots.length} 镜 · ${g.len} 秒 · ${m.n} · ${isDraft(g) ? '480p' : g.res}`, c - (g.cover ? 4 : 0)], [`配音 · ${VOICES.find(v => v.id === g.voice)!.n}`, 0], ['音乐、字幕、混音与剪辑', 0], ...(g.cover ? [['封面', 4] as [string, number]] : [])],
      note: !final && isDraft(g) ? '样片满意后一键转成片，沿用同样的文案、素材和设置。' : undefined,
      ok: final ? '转成片' : '生成',
      then: async () => {
        try { const j = await api.generate({ ...g, assetIds: used.map(a => a.id) }, final, title); setJob(j); setJobId(j.id); sessionStorage.setItem(`${KEY}.job`, j.id); bumpJobs(); setTimeout(() => document.getElementById('gOut')?.scrollIntoView({ block: 'center' }), 60); }
        catch (e) { fail(e); }
      },
    });
  };

  const toWb = () => {
    if (!lines.length) { toast('先写文案，或从选题导入'); return; }
    setWbSeed({ title: g.title || lines[0].slice(0, 16), lines, assetIds: used.map(a => a.id), topicId: g.topicId, settings: g }); nav('wb');
  };
  const draftPicker = () => sheet({ title: '导入文案', body: <DraftPicker onPick={(copy, title, topicId, len) => { set({ copy, title, topicId, len }); sheet(null); toast('已导入'); }} /> });

  return <section className="view on" id="v-gen"><div className="vb">
    <div className="hero" style={{ paddingTop: 52 }}>
      <h1 className="d2">文案和素材放进来，<em>直接出片。</em></h1>
      <p className="sub">选模型、定时长、挑声音就够了。想逐镜调整景别和运镜，再去制作台。</p>
      <Steps cur="gen" />
    </div>
    <div className="wrap gw">
      <div className="gsrc" id="gSrc">{topic
        ? <><Src k="real">文案已导入</Src><span>来自选题 <b>{g.title || topic.title}</b></span><span className="sp" /><button className="btn g sm" onClick={() => nav({ view: 'ip', sub: 'copy', id: topic.id })}>回去改文案</button><button className="btn g sm" onClick={draftPicker}>换一条</button></>
        : <><span className="m">没有关联选题。可以直接写，也可以导入写好的文案。</span><span className="sp" /><button className="btn g sm" id="gPickD" onClick={draftPicker}>从草稿箱导入</button><button className="btn k sm" onClick={() => nav({ view: 'ip', sub: 'find' })}>去选题写文案</button></>}</div>

      <div className="gcard">
        <div className="gtop"><Seg value={tab} options={['copy', 'prompt'] as const} render={v => v === 'copy' ? '口播文案' : '画面提示词'} onChange={setTab} /><span className="sp" />
          <span className="xs m3" id="gCount">{tab === 'copy' ? `${g.copy.replace(/\s/g, '').length} 字 · 约 ${secs(g.copy)} 秒口播 · ${lines.length} 行` : `${g.prompt.length} 字 · 提示词会和文案一起送给模型`}</span></div>
        {tab === 'copy'
          ? <textarea id="gCopy" aria-label="口播文案" value={g.copy} onChange={e => set({ copy: e.target.value })} placeholder="贴一段文案，或者从“选题文案”送过来。每一行大致是一个镜头。" />
          : <textarea id="gPrompt" aria-label="画面提示词" value={g.prompt} onChange={e => set({ prompt: e.target.value })} placeholder={`可不写。写画面里要有什么、光线和氛围，比如：${session!.persona.proj}，${session!.persona.read[1][1]}，真实自然光，镜头缓慢推进`} />}
        <div className="att" id="gAtt" aria-label="素材">
          {used.map(a => <button key={a.id} className="th" data-gx={a.id} aria-label={`移除素材 ${a.name}`} title="点一下移除" onClick={() => set({ assetIds: g.assetIds.filter(x => x !== a.id) })}><Ph k={a.k} asset={a} /></button>)}
          <button className="add" id="gAdd" aria-label="导入素材" onClick={() => pickAssets(l => set({ assetIds: [...new Set([...g.assetIds, ...l.map(a => a.id)])] }), { already: g.assetIds })}>+</button>
          <span className="xs m3" style={{ alignSelf: 'center', whiteSpace: 'nowrap', paddingLeft: 4 }}>{used.length ? `${used.length} 份素材 · 按顺序用作每一镜的首帧` : '从素材库导入，或上传'}</span>
        </div>
      </div>

      {issues.length > 0 && <div className="gwarn" id="gWarn">{issues.map(i => <div key={i.code}><span>{i.text}</span>{i.fixes.map(f => <button key={f.id} className="btn g sm" data-gf={f.id} onClick={() => fix(f.id)}>{f.label}</button>)}</div>)}</div>}

      <div className="gctl" id="gCtl">
        <div className="gbox w2"><div className="hd">模型<span>价格为示意，以实际接入为准</span></div>
          <div className="gm">{videoModels().map(x => <button key={x.id} data-gk="model" data-v={x.id} aria-pressed={g.model === x.id} aria-disabled={x.off || undefined} onClick={() => x.off ? toast('这个模型还没接入') : set({ model: x.id, draft: x.draft })}>
            <span className="row" style={{ justifyContent: 'space-between', gap: 6 }}><b>{x.n}</b><i>{x.off ? '待接入' : `${x.draft ? `样片 ${x.pd} · ` : ''}${x.pf} 点/秒`}</i></span><span>{x.d}</span></button>)}</div></div>
        <div className="gbox"><div className="hd">时长<span>{m.min}–{m.max} 秒一镜，自动拆</span></div>
          <div className="lenv ro" id="gLenV">{g.len}<small>秒</small></div>
          <input type="range" className="rg" id="gLen" aria-label="视频时长" min={10} max={120} step={5} value={g.len} onChange={e => set({ len: Number(e.target.value) })} />
          <Pills value={g.len} options={[15, 30, 45, 60, 90].map(v => [v, `${v} 秒`] as [number, string])} onChange={v => set({ len: v })} /></div>
        <div className="gbox"><div className="hd">画面</div>
          <p className="lb">比例</p><Pills value={g.ratio} options={['9:16', '16:9', '1:1', '3:4'] as const} onChange={v => set({ ratio: v })} />
          <p className="lb" style={{ marginTop: 12 }}>成片清晰度</p><Pills value={g.res} options={['720p', '1080p', '4K'] as const} disabled={v => !m.res.includes(v)} onChange={v => m.res.includes(v) ? set({ res: v }) : toast('当前模型不支持，换个模型或清晰度')} />
          <Toggle checked={g.draft && m.draft} disabled={!m.draft} onChange={v => set({ draft: v })} label="样片模式" hint={m.draft ? '先出 480p 看效果，约正式价 6 折' : '这个模型没有样片模式'} /></div>
        <div className="gbox"><div className="hd">声音<button className="lnk xs" id="gClone" onClick={clone}>{vc === 'ready' ? '重新克隆' : '克隆我的声音'}</button></div>
          <div className="vlist">{VOICES.map(v => <button key={v.id} data-gk="voice" data-v={v.id} aria-pressed={g.voice === v.id} onClick={() => set({ voice: v.id })}>
            <span className="av">{v.k ? <Ph k={v.k} /> : '—'}</span><span><b>{v.n}</b><span>{v.id === 'me' ? (vc === 'ready' ? '克隆 · 已授权' : vc === 'busy' ? '克隆中…' : '还没克隆') : v.d}</span></span></button>)}</div>
          {g.voice !== 'none' && <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'nowrap' }}><label className="xs m" htmlFor="gSpd" style={{ whiteSpace: 'nowrap' }}>语速 <b className="ro">{g.speed.toFixed(1)}×</b></label><input type="range" className="rg" id="gSpd" min={0.8} max={1.3} step={0.1} value={g.speed} onChange={e => set({ speed: Number(e.target.value) })} style={{ margin: 0, flex: 1 }} /></div>}</div>
        <div className="gbox"><div className="hd">音乐、字幕与风格</div>
          <p className="lb">背景音乐</p><Pills value={g.bgm} options={BGMS} onChange={v => set({ bgm: v })} />
          <Toggle checked={g.subs} onChange={v => set({ subs: v })} label="自动字幕" />
          <Toggle checked={g.ambience} onChange={v => set({ ambience: v })} label="按画面配环境声" />
          <Toggle checked={g.cover} onChange={v => set({ cover: v })} label="同时出封面" hint="+4 点" />
          <p className="lb" style={{ marginTop: 12 }}>风格</p><select className="fld" value={g.style} onChange={e => set({ style: e.target.value })} aria-label="风格"><option>AI 推荐</option>{STYLES.map(s => <option key={s[0]} value={s[0]}>{s[0]} · {s[2]}</option>)}</select></div>
      </div>

      <details className="gshots" id="gShots">
        <summary>AI 会拆成 {shots.length} 个镜头 <span className="xs m3">每镜 {shots[0]?.dur} 秒左右 · {m.n} 单镜 {m.min}–{m.max} 秒</span></summary>
        {shots.map((s, i) => <div className="gshot" key={i}><span className="xs m3">{i + 1}</span><Ph k={s.k} tag={s.generated ? 'gen' : undefined} asset={used[i % Math.max(1, used.length)]} /><span>{s.line || <span className="m3">（无台词，空镜）</span>}</span><span className="xs m3 ro">{s.dur}s</span></div>)}
        <div className="gshot" style={{ gridTemplateColumns: '1fr auto' }}><span className="s m">某一镜想换景别、运镜或单独重拍？</span><button className="btn g sm" onClick={toWb}>进制作台逐镜调整</button></div>
      </details>

      <div className="gfoot" id="gFoot">
        <div><p className="t2">{shots.length} 镜 · {g.len} 秒 · {g.ratio} · {isDraft(g) ? '样片 480p' : g.res}</p><p className="xs m3">{m.n} · {VOICES.find(v => v.id === g.voice)!.n} · 余额 {Math.round(session!.workspace.balance).toLocaleString()} 点{session!.limits.dailyJobs ? ` · 今天还能生成 ${Math.max(0, session!.limits.dailyJobs - session!.limits.jobsToday)} 次` : ''}</p>
          {session!.limits.genPaused && <p className="xs" style={{ color: 'var(--err)' }}>生成功能暂时关闭，管理员打开后就能用</p>}</div>
        <span className="sp" />
        <button className="btn g" onClick={toWb}>进制作台</button>
        <button className="btn y" id="gGo" disabled={blocked || !!running || session!.limits.genPaused} onClick={() => submit(false)}>{running ? '生成中…' : `生成视频 · ${cost} 点`}</button>
      </div>

      <div id="gOut" aria-live="polite"><JobView job={job} onFinal={() => job && submit(true)} onAgain={() => submit(false)} onWb={toWb} onSch={async () => { try { const t = topic ?? await api.addTopic({ title: (job?.output as VideoOutput | null)?.title ?? (g.title || '未命名'), hook: lines[0] ?? '', source: 'mat', why: '从生成视频来' }); if (!topic) set({ topicId: t.id }); schedule(t); } catch (e) { fail(e); } }} /></div>
    </div>
  </div></section>;
}

function JobView({ job, onFinal, onAgain, onWb, onSch }: { job: Job | null; onFinal: () => void; onAgain: () => void; onWb: () => void; onSch: () => void }) {
  const { toast } = useApp();
  if (!job) return null;
  if (job.status === 'queued' || job.status === 'running') {
    return <div className="gout" style={{ gridTemplateColumns: '1fr' }}><div>
      <p className="t1">正在生成</p><div className="gprog"><i style={{ width: `${((job.step + 0.5) / job.steps.length) * 100}%` }} /></div>
      <div className="gsteps">{job.steps.map((s, i) => <span key={s} className={i < job.step ? 'ok' : i === job.step ? 'on' : ''}>{s}</span>)}</div>
      <p className="xs m3" style={{ marginTop: 12 }}>离开页面不会中断，右上角“任务”里能看到进度。</p></div></div>;
  }
  if (job.status === 'failed') return <div className="gout" style={{ gridTemplateColumns: '1fr' }}><div><p className="t1">没生成成功</p><p className="s m" style={{ marginTop: 6 }}>{job.error}。点数已退回。</p><button className="btn y" style={{ marginTop: 12 }} onClick={onAgain}>再试一次</button></div></div>;
  const o = job.output as VideoOutput, first = o.shots[0];
  return <div className="gout">
    <div className={`pv ${o.ratio === '16:9' ? 'h' : ''}`}>{o.videoUrl
      ? <video src={o.videoUrl} controls playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: '#000' }} />
      : first.videoUrl
      ? <ShotPlayer urls={o.shots.map(s => s.videoUrl ?? null)} />
      : <><Ph k={first.k} tag="gen" /><p className="cap2">{first.line}</p></>}</div>
    <div>
      <p className="xs m3">{o.draft ? '样片 · 480p' : `成片 · ${o.res}`} · AI 生成内容已标识</p><h2 className="d3" style={{ marginTop: 6 }}>{o.title}</h2>
      <div className="list" style={{ marginTop: 14 }}><div><span>规格</span><span className="v">{o.ratio} · {o.len} 秒 · {o.shots.length} 镜</span></div><div><span>声音</span><span className="v">{VOICES.find(v => v.id === o.voice)?.n}</span></div><div><span>模型</span><span className="v">{modelOf(o.model).n}</span></div><div><span>花费</span><span className="v">{job.cost} 点</span></div></div>
      <div className="row" style={{ marginTop: 16, gap: 8 }}>
        {o.draft ? <button className="btn y" id="goFinal" onClick={onFinal}>转成片</button> : o.videoUrl ? <a className="btn y" href={o.videoUrl} download={`${o.title}.mp4`} onClick={() => void api.track('download')}>下载</a> : <button className="btn y" onClick={() => toast('Mock 模式没有真实视频可下载')}>下载</button>}
        <button className="btn g" onClick={onWb}>进制作台精修</button>
        <button className="btn g" id="goSch" onClick={onSch}>放进排期</button>
      </div>
      <div className="row" style={{ marginTop: 10, gap: 14 }}><button className="lnk s" onClick={onAgain}>换一版</button><button className="lnk s" onClick={() => toast(`已生成剪映草稿：${o.title}.zip（示意）`)}>导出剪映草稿</button></div>
    </div>
  </div>;
}

/** 逐镜连播：真实视频服务返回的是每镜一段，合成整条之前先按顺序播 */
function ShotPlayer({ urls }: { urls: (string | null)[] }) {
  const list = urls.filter((u): u is string => !!u);
  const [i, setI] = useState(0);
  return <video key={list[i]} src={list[i]} autoPlay={i > 0} controls playsInline onEnded={() => setI(x => (x + 1 < list.length ? x + 1 : x))}
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: '#000' }} />;
}

function DraftPicker({ onPick }: { onPick: (copy: string, title: string, topicId: string, len: number) => void }) {
  const { nav } = useApp();
  const d = useData(() => api.drafts(), []);
  if (!d.data) return null;
  if (!d.data.drafts.length) return <><p className="s m">草稿箱还是空的。去“选题文案”写一条，写完点“送去生成视频”。</p><div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}><button className="btn k" onClick={() => nav({ view: 'ip', sub: 'find' })}>去写文案</button></div></>;
  return <div className="list">{d.data.drafts.map(c => <button key={c.id} data-dp={c.topicId} onClick={() => onPick(copyText(c), c.title, c.topicId, c.len)}><span>{c.title}<br /><span className="xs m3">{c.kind} · {c.len} 秒 · 约 {secs(copyText(c))} 秒口播</span></span><span className="v">导入 ›</span></button>)}</div>;
}
