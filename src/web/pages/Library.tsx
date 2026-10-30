// 我的作品：作品（生成结果，点开进作品详情）、素材（上传 / 多选 / 送去生成 / 删除）。
import { useMods, useModOpen } from '../ui/mods.tsx';
import { useState } from 'react';
import { api } from '../api.ts';
import { useApp, useData } from '../store.tsx';
import { Empty, Ph, Seg, Skel, Src, pickFiles } from '../ui/kit.tsx';
import { ACCEPT, uploadFiles } from '../ui/pickers.tsx';
import { modelOf } from '../../shared/gen.ts';
import type { Asset, VideoOutput } from '../../shared/types.ts';
import { fileUrl } from '../config.ts';

export function LibraryPage() {
  const { route, nav } = useApp();
  const mods = useMods();
  const tabs = (['works', 'assets'] as const).filter(v => mods.on(v));
  const want = route.sub === 'assets' ? 'assets' : 'works';
  const tab = tabs.includes(want) ? want : tabs[0] ?? 'works';
  useModOpen(tab);
  return <section className="view on" id="v-lib"><div className="vb wrap lib">
    <div className="row" style={{ alignItems: 'flex-end' }}><h1 className="d2" style={{ flex: 1 }}>我的作品</h1>
      {tabs.length > 1 && <div id="libTabs"><Seg value={tab} options={tabs} render={v => v === 'works' ? '作品' : '素材'} onChange={v => nav({ view: 'lib', sub: v }, true)} /></div>}</div>
    {mods.on('retention') && <StorageBar />}
    {tab === 'works' ? <Works /> : <Assets />}
  </div></section>;
}

/** 保存期限和容量：用了多少、哪些 7 天内到期（先下载） */
function StorageBar() {
  const d = useData(() => api.storage(), []);
  const x = d.data;
  if (!x || (!x.retentionDays && !x.capacityMb)) return null;
  const mb = x.usedBytes / 1048576, pct = x.capacityMb ? Math.min(100, Math.round(mb / x.capacityMb * 100)) : 0;
  return <div className="card storebar" id="storeBar">
    <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
      <span className="s" style={{ flex: 1, minWidth: 220 }}>{x.capacityMb ? <>已用 <b>{mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB</b> / {x.capacityMb} MB</> : <>已用 {mb.toFixed(1)} MB</>}{x.retentionDays ? <span className="xs m3"> · 上传的素材和生成的视频保存 {x.retentionDays} 天，到期自动删除</span> : null}</span>
      {x.capacityMb > 0 && <span className="meter" aria-label={`已用 ${pct}%`}><i style={{ width: `${pct}%` }} className={pct > 90 ? 'hi' : ''} /></span>}
    </div>
    {x.expiring.length > 0 && <div className="list" id="expList" style={{ marginTop: 12 }}>{x.expiring.slice(0, 8).map(e => <div key={e.kind + e.id}>
      <span>{e.name}<br /><span className="xs m3">{e.kind === 'video' ? '成片' : '素材'} · {e.daysLeft ? `${e.daysLeft} 天后到期` : '今天到期'}</span></span>
      {e.url && <a className="btn g sm" href={fileUrl(e.url)} download>下载</a>}</div>)}</div>}
  </div>;
}

function Works() {
  const { nav, toast } = useApp();
  const d = useData(() => api.jobs(), []);
  if (!d.data) return <Skel h={200} />;
  const done = d.data.jobs.filter(j => j.status === 'done');
  if (!done.length) return <Empty title="还没有作品" action={<button className="btn y" onClick={() => nav('gen')}>去生成第一条</button>}>在「生成视频」里出片后，会出现在这里。</Empty>;
  return <div className="wgrid" id="works" style={{ marginTop: 24 }}>{done.map(j => {
    const o = j.output as VideoOutput;
    return <div className="wk" key={j.id}>{o.videoUrl ? <div className="ph" data-k="img"><video src={fileUrl(o.videoUrl)} controls playsInline preload="metadata" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: '#000' }} /></div> : <Ph k={o.shots[0]?.k ?? 'live'} tag="gen" />}
      <div className="b"><p className="s" style={{ fontWeight: 500 }}>{o.title}</p><p className="xs m3">{o.draft ? `样片 ${o.res}` : `成片 ${o.res}`} · {o.len} 秒 · {modelOf(o.model).n} · {new Date(j.createdAt).toLocaleDateString()}</p>
        <div className="row" style={{ gap: 6, marginTop: 8 }}>{o.draft ? <Src k="warn">样片</Src> : <Src k="real">成片</Src>}{o.partial && <Src k="warn">部分镜头失败</Src>}<button className="lnk xs" data-open={j.id} onClick={() => nav({ view: 'gen', sub: 'job', id: j.id })}>打开</button>{(o as { expired?: boolean }).expired ? <span className="xs m3">已过保存期限，文件已删除</span> : o.videoUrl ? <a className="lnk xs" href={fileUrl(o.videoUrl)} download={`${o.title}.mp4`}>下载</a> : <button className="lnk xs" onClick={() => toast('Mock 模式没有真实视频可下载')}>下载</button>}</div></div></div>;
  })}</div>;
}

function Assets() {
  const { fail, toast, nav, sheet, setGenSeed, setWbSeed, setMatSeed } = useApp();
  const d = useData(() => api.assets(), []);
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const A = d.data?.assets ?? [];
  const toggle = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const send = (to: 'gen' | 'wb' | 'ip', list: Asset[]) => {
    const ids = list.map(a => a.id);
    if (to === 'gen') { setGenSeed({ assetIds: ids }); nav('gen'); toast(`已放进生成视频 · ${ids.length} 份素材`); }
    if (to === 'wb') { setWbSeed({ title: '素材成片', lines: list.map(() => ''), assetIds: ids }); nav('wb'); }
    if (to === 'ip') { setMatSeed(ids); nav({ view: 'ip', sub: 'find' }); toast('在“我有素材，帮我创作文案”里，素材已选好'); }
    setSel([]);
  };
  const upload = async () => {
    const files = await pickFiles(ACCEPT); if (!files.length) return;
    setBusy(`上传中 0/${files.length}`);
    try {
      const list = await uploadFiles(files, '上传', n => setBusy(`上传中 ${n}/${files.length}`));
      d.reload();
      sheet({
        title: `导入了 ${list.length} 份，接下来？`,
        body: <>
          <div className="row" style={{ gap: 6, marginBottom: 14 }}>{list.slice(0, 8).map(a => <div key={a.id} style={{ width: 52, height: 52, borderRadius: 10, overflow: 'hidden', position: 'relative' }}><Ph k={a.k} asset={a} /></div>)}</div>
          <div className="list">
            <button data-af="gen" onClick={() => { sheet(null); send('gen', list); }}><span>送去生成视频<br /><span className="xs m3">配上文案，第 3 步分到每一镜</span></span><span className="v">›</span></button>
            <button data-af="stay" onClick={() => { sheet(null); setSel(list.map(a => a.id)); }}><span>先留在素材库</span><span className="v">›</span></button>
          </div>
        </>,
      });
    } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const del = () => sheet({
    title: `删除 ${sel.length} 份素材？`, body: <p className="s">删除后不能恢复。已经生成的作品不受影响。</p>,
    foot: <><button className="btn g" onClick={() => sheet(null)}>取消</button><button className="btn k" onClick={async () => { try { for (const id of sel) await api.deleteAsset(id); setSel([]); d.reload(); sheet(null); toast('已删除'); } catch (e) { fail(e); } }}>删除</button></>,
  });

  return <>
    <div className="row" style={{ marginTop: 24 }}><p className="s m" style={{ flex: 1 }}>照片、视频和人物素材。照片可以做首帧，视频可以直接当某一镜的原片。</p><button className="btn y sm" id="upBtn" disabled={!!busy} onClick={upload}>{busy ?? '导入素材'}</button></div>
    <div className="row" style={{ marginTop: 28, alignItems: 'flex-end' }}><div style={{ flex: 1 }}><h2 className="t1">项目素材</h2><p className="xs m3" style={{ marginTop: 4 }}>点一下选中，可多选 · 支持 JPG、PNG、WebP、MP4、MOV，单个不超过 200MB</p></div><button className="lnk s" id="aAll" onClick={() => setSel(sel.length === A.length ? [] : A.map(a => a.id))}>{sel.length === A.length && A.length ? '取消全选' : '全选'}</button></div>
    {!d.data ? <Skel h={200} /> : !A.length ? <Empty title="素材库还是空的" action={<div className="row" style={{ gap: 8, justifyContent: 'center' }}><button className="btn y" onClick={upload}>上传素材</button><button className="btn g" id="addSamples" onClick={async () => { try { const r = await api.addSamples(); d.reload(); toast(`放了 ${r.added} 段示例素材，标着「示例」`); } catch (e) { fail(e); } }}>放几段示例素材试试</button></div>}>把工地、案例、门店拍的视频和照片传进来，生成时直接用原片。</Empty> : <div className="wgrid" id="assets" style={{ marginTop: 14 }}>{A.map(a => (
      <button key={a.id} className="wk pickable" data-as={a.id} aria-pressed={sel.includes(a.id)} aria-label={`选择 ${a.name}`} onClick={() => toggle(a.id)}>
        <Ph k={a.k} asset={a} /><span className="ck" aria-hidden="true">{sel.includes(a.id) ? '✓' : ''}</span><span className="ty">{a.type}</span>
        <div className="b"><p className="s">{a.name}</p>{a.note && <p className="xs m3 anote">{a.note}{a.noteSrc === 'ai' ? ' · AI 看过' : a.noteSrc === 'name' ? ' · 按文件名' : ''}</p>}<p className="xs" style={{ color: a.used >= 4 ? 'var(--warn)' : 'var(--tx3)' }}>{a.used >= 4 ? '已用 4 次 · 建议补拍' : `已用 ${a.used} 次`} · {a.source}{a.dur ? ` · ${a.dur} 秒` : ''}{a.size ? ` · ${(a.size / 1024 / 1024).toFixed(1)}MB` : ''}</p></div>
      </button>))}</div>}
    {sel.length > 0 && <div className="selbar" id="aSel">
      <span>已选 <b>{sel.length}</b> 份</span><span className="sp" />
      <button className="btn g sm" onClick={() => setSel([])}>清空</button><button className="btn g sm" onClick={del}>删除</button>
      <button className="btn y sm" data-snd="gen" onClick={() => send('gen', A.filter(a => sel.includes(a.id)))}>送去生成视频</button>
    </div>}
  </>;
}
