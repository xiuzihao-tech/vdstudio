// 制作台（基础版）：逐镜编辑台词、时长、景别、运镜、首帧素材，排序增删，整条提交生成。
// 原型里的完整控台（机位摇杆、多版本对比、时间线）在下一轮移植，数据结构已兼容（WbShot）。
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useApp, useData, type WbSeed } from '../store.tsx';
import { Empty, Ph, Pills, usePay } from '../ui/kit.tsx';
import { useAssetPicker } from '../ui/pickers.tsx';
import { VOICES } from '../../shared/catalog.ts';
import { draftResOf, genCost, modelOf, videoModels } from '../../shared/gen.ts';
import { secs } from '../../shared/copy.ts';
import type { Asset, GenSettings, Job } from '../../shared/types.ts';

const SIZES = ['远景', '全景', '中景', '近景', '特写', '大特写'];
const MOVES = ['固定', '推近', '拉远', '横摇', '跟拍', '环绕', '升降', '手持'];
const MODES = ['首帧', '文生', '全参考'];
interface WbShot { id: string; line: string; dur: number; size: string; move: string; mode: string; assetId: string | null }
interface WbState { title: string; topicId: string | null; shots: WbShot[]; model: string; ratio: GenSettings['ratio']; res: GenSettings['res']; voice: GenSettings['voice']; bgm: string; draft: boolean }

const sid = () => Math.random().toString(36).slice(2, 9);
function fromSeed(s: WbSeed): WbState {
  const n = s.lines.length;
  return {
    title: s.title, topicId: s.topicId ?? null,
    shots: s.lines.map((line, i) => ({ id: sid(), line, dur: Math.min(15, Math.max(4, secs(line) + 1)), size: SIZES[[2, 1, 4, 2, 1, 0][i % 6]], move: MOVES[[0, 1, 3, 0, 4, 2][i % 6]], mode: '首帧', assetId: s.assetIds.length ? s.assetIds[i % s.assetIds.length] : null })).slice(0, Math.max(1, n)),
    model: s.settings?.model ?? 's25', ratio: s.settings?.ratio ?? '9:16', res: s.settings?.res ?? '1080p', voice: s.settings?.voice ?? 'p1', bgm: s.settings?.bgm ?? '温暖钢琴', draft: s.settings?.draft ?? true,
  };
}

export function Workbench() {
  const { wbSeed, setWbSeed, nav, setGenSeed, toast, fail, sheet, bumpJobs, session } = useApp();
  const KEY = `findai.wb.${session!.workspace.id}`;
  const pay = usePay();
  const pick = useAssetPicker();
  const assets = useData(() => api.assets(), []);
  const [st, setSt] = useState<WbState | null>(() => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? 'null'); } catch { return null; } });
  const [cur, setCur] = useState(0);
  const [job, setJob] = useState<Job | null>(null);

  useEffect(() => { if (wbSeed) { setSt(fromSeed(wbSeed)); setCur(0); setWbSeed(null); toast(`按文案排好了 ${wbSeed.lines.length} 个镜头`); } }, [wbSeed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(st)); } catch { /* 忽略 */ } }, [st]);
  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed') return;
    const h = setTimeout(async () => { try { const j = await api.job(job.id); setJob(j); if (j.status === 'done') { toast('整条视频好了，在“作品”里'); bumpJobs(); } } catch (e) { fail(e); } }, 700);
    return () => clearTimeout(h);
  }, [job]); // eslint-disable-line react-hooks/exhaustive-deps

  const A = assets.data?.assets ?? [];
  const aOf = (id: string | null) => (id ? A.find(a => a.id === id) ?? null : null);

  if (!st) return <section className="view on" id="v-wb"><div className="vb wrap"><Empty title="制作台还是空的" action={<div className="row" style={{ justifyContent: 'center', gap: 8 }}>
    <button className="btn g" onClick={() => nav({ view: 'ip', sub: 'mine' })}>从草稿箱选一条</button>
    <button className="btn g" onClick={() => pick(l => setSt(fromSeed({ title: '素材成片', lines: l.map(() => ''), assetIds: l.map(a => a.id) })))}>从素材开始</button>
    <button className="btn y" onClick={() => nav({ view: 'ip', sub: 'find' })}>去写文案</button></div>}>
    制作台给想逐镜调整的人用：每一镜的台词、时长、景别、运镜、首帧都能单独改。文案在“选题文案”里写好，点“送去制作台”就会排好镜头。</Empty></div></section>;

  const s = st.shots[Math.min(cur, st.shots.length - 1)];
  const total = st.shots.reduce((a, x) => a + x.dur, 0);
  const m = modelOf(st.model);
  const upd = (p: Partial<WbState>) => setSt({ ...st, ...p });
  const updShot = (p: Partial<WbShot>) => upd({ shots: st.shots.map(x => x.id === s.id ? { ...x, ...p } : x) });
  const move = (d: number) => { const i = st.shots.indexOf(s), j = i + d; if (j < 0 || j >= st.shots.length) return; const L = [...st.shots]; [L[i], L[j]] = [L[j], L[i]]; upd({ shots: L }); setCur(j); };
  const settings = (): GenSettings => ({
    copy: st.shots.map(x => x.line).filter(Boolean).join('\n'), title: st.title, topicId: st.topicId,
    prompt: st.shots.map((x, i) => `镜${i + 1}：${x.size}，${x.move}，${x.mode}，${x.dur}秒`).join('；'),
    assetIds: st.shots.map(x => x.assetId).filter((x): x is string => !!x), model: st.model, len: Math.min(120, Math.max(10, Math.round(total / 5) * 5)), ratio: st.ratio,
    res: m.res.includes(st.res) ? st.res : (m.res[m.res.length - 1] as GenSettings['res']), draft: st.draft && m.draft, voice: st.voice, speed: 1, bgm: st.bgm, subs: true, ambience: true, cover: false, style: 'AI 推荐',
  });
  const importAssets = () => pick(l => sheet({
    title: `放进制作台 · ${l.length} 份素材`,
    body: <div className="list">
      <button id="wmAdd" onClick={() => { upd({ shots: [...st.shots, ...l.map(a => ({ id: sid(), line: '', dur: 5, size: '全景', move: '推近', mode: '首帧', assetId: a.id }))] }); setCur(st.shots.length); sheet(null); toast(`加了 ${l.length} 镜`); }}><span>每份素材加一镜<br /><span className="xs m3">接在最后，用素材做首帧</span></span><span className="v">›</span></button>
      <button id="wmRep" onClick={() => { updShot({ assetId: l[0].id, mode: '首帧' }); sheet(null); toast(`第 ${cur + 1} 镜换了首帧`); }}><span>替换第 {cur + 1} 镜的首帧<br /><span className="xs m3">用第一份素材，其他设置不动</span></span><span className="v">›</span></button>
      <button id="wmNew" onClick={() => { upd({ shots: st.shots.map((x, i) => ({ ...x, assetId: l[i % l.length].id })) }); sheet(null); toast('已按素材重排'); }}><span>按这些素材重排整条片<br /><span className="xs m3">镜头结构不变，按顺序换上素材</span></span><span className="v">›</span></button>
    </div>,
  }));
  const submit = () => {
    const g = settings();
    if (!g.copy) { toast('至少一镜要有台词'); return; }
    const c = genCost(g);
    pay({ title: `生成整条 · ${st.shots.length} 镜`, lines: [[`${st.shots.length} 镜 · ${g.len} 秒 · ${m.n} · ${g.draft ? `样片 ${draftResOf(g.model)}` : g.res}`, c]], ok: '生成', then: async () => {
      try { const j = await api.generate(g, false, st.title); setJob(j); bumpJobs(); } catch (e) { fail(e); }
    } });
  };

  return <section className="view on" id="v-wb"><div className="vb wrap" style={{ paddingTop: 36 }}>
    <div className="row" style={{ alignItems: 'flex-end', gap: 10 }}>
      <div style={{ flex: 1, minWidth: 220 }}><p className="xs m3">制作台 · 基础版</p><input className="fld" aria-label="片名" style={{ fontSize: 22, fontWeight: 600, marginTop: 6 }} value={st.title} onChange={e => upd({ title: e.target.value })} /></div>
      <button className="btn g sm" id="wbAsset" onClick={importAssets}>导入素材</button>
      <button className="btn g sm" id="wbEasy" onClick={() => { const g = settings(); setGenSeed({ ...g, len: Math.min(120, Math.max(10, g.len)) }); nav('gen'); toast('简易模式：只保留模型、时长、声音这些常用设置'); }}>简易模式</button>
      <button className="btn g sm" onClick={() => sheet({ title: '清空制作台？', body: <p className="s">镜头和设置都会清掉，素材和草稿不受影响。</p>, foot: <><button className="btn g" onClick={() => sheet(null)}>取消</button><button className="btn k" onClick={() => { setSt(null); sessionStorage.removeItem(KEY); sheet(null); }}>清空</button></> })}>清空</button>
    </div>

    <div className="wbb" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,260px) minmax(0,1fr)', gap: 16, marginTop: 18 }}>
      <div className="gbox" style={{ padding: 10 }}>
        <div className="hd" style={{ padding: '4px 6px' }}>镜头<span>{st.shots.length} 镜 · {total} 秒</span></div>
        <div id="srail" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {st.shots.map((x, i) => <button key={x.id} data-si={i} aria-pressed={i === cur} onClick={() => setCur(i)} className="wbs" style={{ display: 'grid', gridTemplateColumns: '22px 56px 1fr', gap: 8, alignItems: 'center', textAlign: 'left', padding: 6, borderRadius: 10, background: i === cur ? 'color-mix(in srgb,var(--tx) 8%,transparent)' : 'none', border: i === cur ? '1px solid var(--tx)' : '1px solid transparent' }}>
            <span className="xs m3">{i + 1}</span><div style={{ width: 56, height: 40, borderRadius: 6, overflow: 'hidden', position: 'relative' }}><Ph k={aOf(x.assetId)?.k ?? 'live'} asset={aOf(x.assetId)} /></div>
            <span className="xs" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.line || <span className="m3">（空镜）</span>}<br /><span className="m3">{x.size} · {x.move} · {x.dur}s</span></span>
          </button>)}
        </div>
        <button className="lnk xs" style={{ margin: '10px 6px' }} onClick={() => { upd({ shots: [...st.shots.slice(0, cur + 1), { id: sid(), line: '', dur: 5, size: '中景', move: '固定', mode: '文生', assetId: null }, ...st.shots.slice(cur + 1)] }); setCur(cur + 1); }}>＋ 在后面加一镜</button>
      </div>

      <div className="gbox">
        <div className="hd">第 {cur + 1} 镜<span className="row" style={{ gap: 6 }}><button className="btn g sm" aria-label="上移" onClick={() => move(-1)}>↑</button><button className="btn g sm" aria-label="下移" onClick={() => move(1)}>↓</button>{st.shots.length > 1 && <button className="btn g sm" onClick={() => { upd({ shots: st.shots.filter(x => x.id !== s.id) }); setCur(Math.max(0, cur - 1)); }}>删除</button>}</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,200px) minmax(0,1fr)', gap: 16 }} className="wbshot">
          <div><div style={{ borderRadius: 12, overflow: 'hidden', position: 'relative', aspectRatio: st.ratio.replace(':', '/') }}><Ph k={aOf(s.assetId)?.k ?? 'live'} asset={aOf(s.assetId)} tag={s.assetId ? 'real' : 'gen'} className="fill" /></div>
            <button className="btn g sm" style={{ width: '100%', marginTop: 8 }} onClick={() => pick(l => updShot({ assetId: l[0].id, mode: '首帧' }), { title: '选首帧素材' })}>{s.assetId ? '换首帧' : '选首帧'}</button>
            {s.assetId && <button className="lnk xs" style={{ marginTop: 6 }} onClick={() => updShot({ assetId: null, mode: '文生' })}>不用素材，AI 生成画面</button>}</div>
          <div>
            <label className="lb" htmlFor="wbLine">台词</label><textarea className="fld" id="wbLine" rows={3} value={s.line} onChange={e => updShot({ line: e.target.value })} placeholder="这一镜说什么；留空就是空镜" />
            <p className="xs m3" style={{ marginTop: 4 }}>约 {secs(s.line)} 秒口播{secs(s.line) > s.dur ? <span style={{ color: 'var(--warn)' }}> · 比镜头长，会读不完</span> : ''}</p>
            <p className="lb" style={{ marginTop: 12 }}>时长 <b className="ro">{s.dur} 秒</b></p><input type="range" className="rg" min={m.min} max={Math.min(15, m.max)} value={s.dur} onChange={e => updShot({ dur: Number(e.target.value) })} aria-label="镜头时长" />
            <p className="lb" style={{ marginTop: 8 }}>景别</p><Pills value={s.size} options={SIZES} onChange={v => updShot({ size: v })} />
            <p className="lb" style={{ marginTop: 12 }}>运镜</p><Pills value={s.move} options={MOVES} onChange={v => updShot({ move: v })} />
            <p className="lb" style={{ marginTop: 12 }}>生成方式</p><Pills value={s.mode} options={MODES} onChange={v => updShot({ mode: v })} />
          </div>
        </div>
      </div>
    </div>

    <div className="gbox" style={{ marginTop: 16 }}>
      <div className="hd">全片设置</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 }}>
        <div><p className="lb">模型</p><Pills value={st.model} options={videoModels().filter(x => !x.off).map(x => [x.id, x.n] as [string, string])} onChange={v => upd({ model: v, draft: modelOf(v).draft })} /></div>
        <div><p className="lb">比例</p><Pills value={st.ratio} options={['9:16', '16:9', '1:1', '3:4'] as const} disabled={v => !!m.ratios && !m.ratios.includes(v)} onChange={v => (!m.ratios || m.ratios.includes(v)) && upd({ ratio: v })} /></div>
        <div><p className="lb">清晰度</p><Pills value={st.res} options={['720p', '1080p', '4K'] as const} disabled={v => !m.res.includes(v)} onChange={v => m.res.includes(v) && upd({ res: v })} /></div>
        <div><p className="lb">声音</p><Pills value={st.voice} options={VOICES.map(v => [v.id, v.n] as [GenSettings['voice'], string])} onChange={v => upd({ voice: v })} /></div>
      </div>
    </div>

    <div className="gfoot">
      <div><p className="t2">{st.shots.length} 镜 · {total} 秒 · {st.ratio}</p><p className="xs m3">{m.n}{job ? ` · ${job.status === 'done' ? '已生成' : job.status === 'failed' ? '失败' : `生成中：${job.steps[Math.min(job.step, job.steps.length - 1)]}`}` : ''}</p></div>
      <span className="sp" />
      {job?.status === 'done' && <button className="btn g" onClick={() => nav({ view: 'lib', sub: 'works' })}>去作品看</button>}
      <button className="btn y" id="wbGo" disabled={!!job && job.status !== 'done' && job.status !== 'failed'} onClick={submit}>生成整条 · {genCost(settings())} 点</button>
    </div>
  </div></section>;
}

export type { Asset };
