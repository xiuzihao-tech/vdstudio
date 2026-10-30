// 生成视频：三步出片——选类型 → 放内容 → 确认分镜。制作台不单独上线，它能调的参数都在这里，而且每一项都真的传到模型。
// 冲突在前端实时提示，提交时后端用同一份规则再算一遍（以后端为准）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.ts';
import { useApp, useData } from '../store.tsx';
import { Ph, Pills, Seg, Src, Toggle, pickFiles, usePay } from '../ui/kit.tsx';
import { ACCEPT, uploadFiles, useAssetPicker, useScheduleTopic } from '../ui/pickers.tsx';
import { useCloneVoice } from './ip/More.tsx';
import { BGMS, EMOTIONS, RATIOS, STYLES, VOICES } from '../../shared/catalog.ts';
import { clampRes, draftResOf, genIssues, isDraft, modelOf, trimCopyToLen, videoModels } from '../../shared/gen.ts';
import { useMods, useModOpen } from '../ui/mods.tsx';
import { SUBTYPES, MOVES, SIZES, SOURCE_NAME, TRANSITIONS, VIDEO_TYPES, buildStoryboard, chars, costLines, costTotal, relock, splitSentences, suggestType, typeOf, voiceSecs, type ShotSource, type ShotSpec, type SubType, type VideoType } from '../../shared/video.ts';
import { copyText, smartTitle } from '../../shared/copy.ts';
import type { Asset, GenSettings, Job, VideoOutput } from '../../shared/types.ts';
import { fileUrl } from '../config.ts';

const KEY_BASE = 'findai.gen2';
// 默认「实拍出片」：最省钱、最真实，也不需要数字人（以前默认真人口播，新用户还没有形象）
const DEFAULT: GenSettings = { copy: '', prompt: '', title: '', topicId: null, assetIds: [], model: 'wan', len: 45, ratio: '9:16', res: '720p', draft: false, voice: 'p1', speed: 1, bgm: '城市律动', subs: true, ambience: true, cover: false, style: 'AI 推荐', type: 'real', sub: 'case-walk', avatar: 'none', emotion: '自动', pause: 0.3, bgmVol: 0.2, seed: false, shots: [] };

/** 实拍镜头的时长：跟着这句配音（多 0.3 秒），不受视频模型最短时长限制；不超过素材从起点往后剩下的长度 */
export function clipDur(line: string, speed: number, avail: number | null | undefined): number {
  const v = Math.ceil(voiceSecs(line, speed) + 0.3);
  const cap = Math.max(1, Math.floor(Math.min(15, avail ?? 15)));
  return Math.max(1, Math.min(cap, Math.max(2, v)));
}
const load = (KEY: string): { g: GenSettings; step: 1 | 2 | 3 } => { try { const x = JSON.parse(sessionStorage.getItem(KEY) ?? '{}'); return { g: { ...DEFAULT, ...(x.g ?? {}) }, step: x.step ?? 1 }; } catch { return { g: DEFAULT, step: 1 }; } };

/** 浏览器自带朗读：接上配音服务前用来试听节奏（真实音色以成片为准） */
export function speak(text: string, speed = 1) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; u.rate = speed;
    speechSynthesis.speak(u);
  } catch { /* 不支持就算了 */ }
}

export function GenPage() {
  const { session, genSeed, setGenSeed, nav, toast, fail, sheet, bumpJobs, route } = useApp();
  const KEY = `${KEY_BASE}.${session!.workspace.id}`;
  const pay = usePay();
  const pickAssets = useAssetPicker();
  const clone = useCloneVoice();
  const schedule = useScheduleTopic();
  const init = useMemo(() => {
    const base = load(KEY);
    if (!genSeed) return base;
    // 从 dazheip / AI 运营 / 素材库带过来：文案直接填好，跳到第 2 步
    const g = { ...base.g, prompt: '', title: '', topicId: null, shots: [], ...genSeed, assetIds: genSeed.assetIds ?? base.g.assetIds };
    if (genSeed.copy && !genSeed.type) g.type = suggestType(genSeed.copy);
    // 带了类型（形象页试生成、AI 运营）直接到第 3 步，分镜进来后自动拆好
    return { g, step: genSeed.shots?.length || (genSeed.copy && genSeed.type) ? 3 as const : genSeed.copy || genSeed.assetIds ? 2 as const : base.step };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [g, setG] = useState<GenSettings>(init.g);
  const [step, setStepRaw] = useState<1 | 2 | 3>(init.step);
  /** 换步骤都回到页面顶部（手机上以前停在中间，看不到这一步的开头） */
  const setStep = (n: 1 | 2 | 3) => { setStepRaw(n); window.scrollTo(0, 0); };
  // /gen/job/<id>：从作品、AI 运营打开某一条的作品详情
  const [jobId, setJobId] = useState<string | null>(() => (route.sub === 'job' && route.id ? route.id : sessionStorage.getItem(`${KEY}.job`)));
  const [job, setJob] = useState<Job | null>(null);
  const assets = useData(() => api.assets(), []);
  const topics = useData(() => api.allTopics(), []);

  useEffect(() => { if (genSeed) setGenSeed(null); }, [genSeed, setGenSeed]);
  useEffect(() => { const r = clampRes(g.model, g.res); if (r !== g.res) setG(x => ({ ...x, res: r })); }, [g.model, g.res]);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify({ g, step })); } catch { /* 隐私模式 */ } }, [g, step]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!jobId) return;
    let live = true, h: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const j = await api.job(jobId); if (!live) return; setJob(j);
        if (j.status === 'queued' || j.status === 'running') h = setTimeout(tick, 800);
        else { bumpJobs(); if (j.status === 'done') toast((j.output as VideoOutput)?.partial ? '出片了，有几镜没成功，点数已退回，可以单独重做' : j.kind === 'video_final' ? '成片好了，可以下载' : '视频好了'); if (j.status === 'failed') toast(`生成失败：${j.error}，点数已退回`); }
      } catch { sessionStorage.removeItem(`${KEY}.job`); setJobId(null); }
    };
    void tick();
    return () => { live = false; clearTimeout(h); };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (p: Partial<GenSettings>) => setG(x => ({ ...x, ...p }));
  // 直接进第 3 步但还没有分镜：素材加载好后按文案拆一次
  useEffect(() => { if (step === 3 && !g.shots?.length && g.copy.trim() && assets.data) rebuild(); }, [assets.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // 刚上传 / 刚从素材库选的素材先放这里，不用等素材列表重新加载（以前在第 2 步上传后显示「0 段素材」）
  const [extra, setExtra] = useState<Asset[]>([]);
  const A = useMemo(() => { const base = assets.data?.assets ?? []; return [...extra.filter(x => !base.some(b => b.id === x.id)), ...base]; }, [assets.data, extra]);
  const used = g.assetIds.map(id => A.find(a => a.id === id)).filter((a): a is Asset => !!a);
  const addAssets = (l: Asset[]) => { if (!l.length) return; setExtra(e => [...l, ...e]); setG(x => ({ ...x, assetIds: [...new Set([...x.assetIds, ...l.map(a => a.id)])], shots: x.type === 'real' ? [] : x.shots })); };
  const [upBusy, setUpBusy] = useState<string | null>(null);
  const uploadNow = async () => { const files = await pickFiles(ACCEPT); await uploadList(files); };
  const uploadList = async (files: File[]) => {
    if (!files.length) return;
    setUpBusy(`上传中 0/${files.length}`);
    try { const l = await uploadFiles(files, '上传', n => setUpBusy(`上传中 ${n}/${files.length}`)); addAssets(l); assets.reload(); toast(`传好了 ${l.length} 段，也存进了素材库`); }
    catch (e) { fail(e); } finally { setUpBusy(null); }
  };
  const t = typeOf(g.type);
  const m = modelOf(g.model);
  const vc = session!.workspace.voiceClone;
  const av = session!.workspace.avatars ?? { clone: 'none', photo: 'none' };
  const topic = g.topicId ? topics.data?.topics.find(x => x.id === g.topicId) : null;
  const sentences = useMemo(() => splitSentences(g.copy), [g.copy]);
  const estSecs = Math.round(sentences.reduce((a, s) => a + voiceSecs(s, g.speed) + (g.pause ?? 0.3), 0));
  const shots = g.shots ?? [];
  const avatarOn = g.avatar !== 'none' && t.avatar !== 'none';

  /** 按文案（重新）拆分镜 */
  const rebuild = (over: Partial<GenSettings> = {}) => {
    const x = { ...g, ...over }, tt = typeOf(x.type);
    const s = buildStoryboard(splitSentences(x.copy), { type: tt.id, model: modelOf(x.model), assets: used.map(a => ({ id: a.id, type: a.type, dur: a.dur, best: a.best })), avatar: x.avatar !== 'none' && tt.avatar !== 'none', speed: x.speed });
    set({ ...over, shots: s, len: s.reduce((a, y) => a + y.dur, 0) });
    return s;
  };
  const pickType = (id: VideoType) => {
    const tt = typeOf(id);
    const avatar = tt.avatar === 'none' ? 'none' : av.clone === 'ready' ? 'clone' : av.photo === 'ready' ? 'photo' : g.avatar ?? 'none';
    set({ type: id, sub: SUBTYPES[id][0]?.id, model: tt.model, bgm: tt.bgm, avatar, draft: modelOf(tt.model).draft, shots: [] });
  };
  const sub = SUBTYPES[t.id].find(x => x.id === g.sub) ?? SUBTYPES[t.id][0];
  /** 知识库写文案 / 实拍看素材写文案 */
  const [idea, setIdea] = useState('');
  const [useKb, setUseKb] = useState(true);
  // 模块开关：实拍 / 口播 / AI 做画面三类入口，样片、声音复刻、数字人、高级参数各自能关
  const mods = useMods();
  const typeMod = (id: string) => id === 'real' ? 'real' : id === 'talk' ? 'talk' : 'aiVideo';
  const types = VIDEO_TYPES.filter(x => mods.on(typeMod(x.id)));
  useModOpen(typeMod(g.type ?? 'real'));
  // 关掉的类型不能选；数字人、样片模块关了就不带这些设置去生成
  useEffect(() => {
    if (types.length && !types.some(x => x.id === g.type)) pickType(types[0].id);
    else if (!mods.on('avatarShot') && g.avatar && g.avatar !== 'none') set({ avatar: 'none' });
    else if (!mods.on('draft') && g.draft) set({ draft: false });
  }, [types.map(x => x.id).join(), g.type, g.avatar, g.draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const [writing, setWriting] = useState(false);
  const [usedKb, setUsedKb] = useState<{ kind: string; text: string }[]>([]);
  const aiWrite = async () => {
    setWriting(true);
    try {
      const r = await api.writeCopy({ idea: idea || `${t.n}${sub ? ` · ${sub.n}` : ''}`, len: ([30, 45, 60, 90].find(x => x >= g.len) ?? 45), kb: useKb });
      set({ copy: copyText(r.draft), title: r.draft.title, topicId: r.draft.topicId, shots: [] }); setUsedKb(r.used);
      toast(r.used.length ? `写好了，用了知识库里的 ${r.used.length} 条素材` : '写好了。知识库还是空的，补几条会更像你');
    } catch (e) { fail(e); } finally { setWriting(false); }
  };
  const media = used.filter(a => a.type === '视频' || a.type === '照片');
  const aiFootage = async () => {
    if (!media.length) { toast('先放几段实拍视频或照片'); return; }
    setWriting(true);
    try {
      const r = await api.footage(media.map(a => a.id), idea);
      const m0 = modelOf(g.model);
      // 每段素材一镜：视频用原片（从看图模型推荐的那一段开始），照片做首帧；台词就是 AI 按这段素材写的那句
      const shotsNew: ShotSpec[] = r.lines.map((line, i) => {
        const a = media[i], info = r.assets[i], video = a.type === '视频';
        const start = video ? Math.max(0, Math.floor(info?.best?.[0] ?? 0)) : 0;
        const dur = video ? clipDur(line, g.speed, (info?.dur ?? a.dur ?? 15) - start) : Math.min(Math.min(m0.max, 15), Math.max(m0.min, Math.ceil(voiceSecs(line, g.speed) + 0.3)));
        return { id: `s${i + 1}`, line, dur, lock: true, source: video ? 'clip' : 'frame', assetId: a.id, lastId: null, refIds: [], prompt: info?.note ?? '', size: '全景', move: video ? '固定' : '推近', model: '', trans: '硬切', ...(start ? { start } : {}) };
      });
      set({ copy: r.lines.join('\n'), title: r.title, shots: shotsNew, len: shotsNew.reduce((x, y) => x + y.dur, 0) }); setUsedKb(r.used);
      setStep(3); toast(`看完了 ${media.length} 段素材，每段配了一句`);
    } catch (e) { fail(e); } finally { setWriting(false); }
  };
  const toStep3 = () => {
    if (!g.copy.trim()) { toast('先放一段文案'); return; }
    // 文案、类型、模型变了就重拆；没变保留用户改过的分镜
    const flat = (x: string) => x.replace(/\s/g, '');
    const same = shots.length > 0 && flat(shots.map(s => s.line).join('')) === flat(sentences.join(''));
    if (!same) rebuild();
    setStep(3); window.scrollTo(0, 0);
  };

  const issues = useMemo(() => genIssues({ ...g, assetIds: used.map(a => a.id), shots: step === 3 ? shots : undefined }, vc, { firstFrame: session!.ai.firstFrame, avatars: av }), [g, used.length, vc, step, av]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocked = issues.some(i => i.blocking);
  const running = job && (job.status === 'queued' || job.status === 'running');
  /** 没接配音服务时（视频是真实服务）：成片不带配音，也不收配音费 */
  const ttsOn = session!.ai.tts !== 'none';
  const lines = costLines(shots, { model: modelOf, base: g.model, draft: isDraft(g), type: t.id, voice: ttsOn && g.voice !== 'none' });

  const fix = async (id: string) => {
    const at = id.indexOf(':'), k = at < 0 ? id : id.slice(0, at), v = at < 0 ? '' : id.slice(at + 1);
    if (k === 'ratio') set({ ratio: v as GenSettings['ratio'] });
    if (k === 'model') set({ model: v, draft: modelOf(v).draft });
    if (k === 'res') set({ res: v as GenSettings['res'] });
    if (k === 'len') set({ len: Number(v) });
    if (k === 'voice') set({ voice: v as GenSettings['voice'] });
    if (k === 'avatar') { set({ avatar: 'none' }); if (step === 3) rebuild({ avatar: 'none' }); }
    if (k === 'trim') { const c = trimCopyToLen(g.copy, g.len); set({ copy: c }); if (step === 3) rebuild({ copy: c }); }
    if (k === 'clone') clone();
    if (k === 'pick') { if (g.type === 'real') void uploadNow(); else pickAssets(addAssets, { already: g.assetIds }); }
    if (k === 'goto') nav(v === 'me' ? 'me' : 'gen');
    if (k === 'ai') {
      try {
        const tp = topics.data?.topics[0]; if (!tp) return;
        const r = await api.genCopy(tp.id, { len: ([30, 45, 60, 90].find(x => x >= g.len) ?? 90) });
        const d = await api.saveDraft(r.draft);
        set({ copy: copyText(d), title: d.title, topicId: d.topicId }); toast('AI 先写了一版，可以直接改');
      } catch (e) { fail(e); }
    }
  };

  const run = (settings: GenSettings, final: boolean, title: string, label: string, note?: string) => {
    const l = costLines(settings.shots ?? [], { model: modelOf, base: settings.model, draft: !final && isDraft(settings), type: typeOf(settings.type).id, voice: ttsOn && settings.voice !== 'none' && settings.remix !== 'music', reuse: settings.reuse?.map(Boolean) });
    pay({
      title: label, lines: l.length ? l.map(x => [x.label, x.pts] as [string, number]) : [['重新合成', 0]], ok: final ? '出成片' : '生成', note,
      then: async () => {
        try { const j = await api.generate(settings, final, title); setJob(j); setJobId(j.id); sessionStorage.setItem(`${KEY}.job`, j.id); bumpJobs(); setTimeout(() => document.getElementById('gOut')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60); }
        catch (e) { fail(e); }
      },
    });
  };
  const title = g.title || smartTitle(g.copy) || '未命名';
  const submit = (final: boolean) => run({ ...g, assetIds: used.map(a => a.id), len: shots.reduce((a, s) => a + s.dur, 0) || g.len }, final, title,
    final ? '出成片' : `生成视频${isDraft(g) ? ' · 样片' : ''}`, !final && isDraft(g) ? `样片 ${draftResOf(g.model)}，满意后一键出成片，沿用同样的分镜。` : undefined);

  /** 作品详情里的重做：只重做指定的镜头，其余沿用上一版 */
  const redo = (o: VideoOutput, input: GenSettings, keep: (i: number) => boolean, label: string, over: Partial<GenSettings> = {}) => {
    const reuse = o.shots.map((s, i) => (keep(i) ? s.videoUrl ?? (session!.ai.video === 'mock' ? `mock:${i}` : null) : null));
    run({ ...input, remix: undefined, ...over, shots: input.shots, reuse }, !o.draft, o.title, label);
  };
  const redub = (o: VideoOutput, input: GenSettings) => sheet({ title: '换配音', body: <Redub g={input} onOk={p => { sheet(null); redo(o, input, () => true, '换配音 · 画面不重做', p); }} /> });

  const draftPicker = () => sheet({ title: '导入文案', body: <DraftPicker onPick={(copy, ttl, topicId, len) => { set({ copy, title: ttl, topicId, len, shots: [] }); sheet(null); toast('已导入'); }} /> });

  return <section className="view on" id="v-gen"><div className="vb">
    <div className={`hero tight${step > 1 ? ' slim' : ''}`}>
      {step === 1 && <><p className="eyebrow">生成视频</p>
      <h1 className="d2">拍了什么都能<em>做成片。</em></h1></>}
      <div className="steps" aria-label="生成步骤">{(['选类型', '放内容', '确认分镜'] as const).map((n, i) => <span key={n} style={{ display: 'contents' }}>
        {i > 0 && <i />}<button type="button" data-gs={i + 1} className={step > i + 1 ? 'done' : ''} aria-current={step === i + 1 ? 'step' : undefined} onClick={() => (i + 1 === 3 ? toStep3() : setStep((i + 1) as 1 | 2))}><b>{step > i + 1 ? '✓' : i + 1}</b>{n}</button></span>)}</div>
    </div>
    <div className="wrap gw">
      {session!.limits.genPaused && <div className="gwarn" style={{ marginTop: 20 }}><div><span>生成功能暂时关闭，管理员打开后就能用</span></div></div>}

      {step === 1 && <>
        <div className="tcards" id="gTypes">{types.map((x, i) => {
          const rec = g.copy.trim() && suggestType(g.copy) === x.id;
          return <button key={x.id} data-ty={x.id} aria-pressed={g.type === x.id} onClick={() => pickType(x.id)}>
            <span className="row" style={{ justifyContent: 'space-between' }}><span className="tno">{g.type === x.id ? '✓ 已选' : String(i + 1).padStart(2, '0')}</span>{x.id === 'real' ? <Src k="real">推荐 · 最省钱</Src> : rec ? <Src k="real">推荐</Src> : null}</span>
            <b>{x.n}</b><span className="s">{x.d}</span><span className="xs m3">{x.how}</span>
            <span className="xs tmeta">{x.voice} · {x.avatar === 'all' ? '数字人全程出镜' : x.avatar === 'some' ? '可本人出镜' : '不出镜'}</span>
          </button>;
        })}</div>
        {mods.on('subtypes') && <div className="subpick card" id="gSub">
          <div style={{ flex: 1, minWidth: 260 }}>
            <p className="eyebrow">{t.n} · 选一个小类</p>
            <div className="pills" style={{ marginTop: 10 }}>{SUBTYPES[t.id].map(x => <button key={x.id} className="pill" data-sub={x.id} aria-pressed={sub?.id === x.id} onClick={() => set({ sub: x.id, shots: [] })}>{x.n}</button>)}</div>
          </div>
          {sub && <div className="shotlist"><p className="lb">去现场拍这些</p><ol>{sub.shots.map(x => <li key={x}>{x}</li>)}</ol></div>}
        </div>}
        <div className="ctabar"><button className="btn cta" id="gToStep2" onClick={() => setStep(2)}>下一步：放内容 <span aria-hidden="true">→</span></button></div>
      </>}

      {step === 2 && <>
        <div className="gsrc" id="gSrc">{topic
          ? <><Src k="real">文案已导入</Src><span>来自选题 <b>{g.title || topic.title}</b></span><span className="sp" /><button className="btn g sm" onClick={draftPicker}>换一条</button></>
          : <><span className="m">类型：<b>{t.n}</b> · 文案可以直接贴，也可以从 dazheip 带过来或导入草稿。</span><span className="sp" /><button className="btn g sm" onClick={() => setStep(1)}>换类型</button><button className="btn g sm" id="gPickD" onClick={draftPicker}>从草稿箱导入</button></>}</div>
        {t.id === 'real' && <RealDrop sub={sub} media={media} busy={upBusy} onFiles={uploadList} onPick={() => pickAssets(addAssets, { already: g.assetIds })} onRemove={id => set({ assetIds: g.assetIds.filter(x => x !== id), shots: [] })} />}
        <div className="aiwrite" id="gAi">
          <div style={{ flex: 1, minWidth: 240 }}>
            <p className="t2">{t.id === 'real' ? 'AI 看素材写文案' : 'AI 按你的知识库写文案'}</p>
            <p className="xs m3" style={{ marginTop: 4 }}>{t.id === 'real' ? (session!.ai.vision === 'none' ? 'AI 按每段素材的文件名和时长各写一句，直接排好分镜。文件名起得具体（如「柜门封边特写」）写得更准。' : 'AI 看懂每段拍了什么，各写一句，直接排好分镜。') : '系统从知识库挑 1–3 条最相关、最近没用过的素材交给 AI，不会每条都说同一个卖点。'}</p>
            <input className="fld" id="gIdea" value={idea} onChange={e => setIdea(e.target.value)} placeholder={t.id === 'real' ? '这条想讲什么（可不填），比如：水电验收看哪 5 个点' : '这条想讲什么，比如：玄关为什么总是乱'} style={{ marginTop: 10 }} />
            {usedKb.length > 0 && <div className="row" style={{ gap: 6, marginTop: 10 }}><span className="xs m3">这条用了：</span>{usedKb.map((u, i) => <span key={i} className="tag" title={u.text}>{u.kind} · {u.text.slice(0, 14)}{u.text.length > 14 ? '…' : ''}</span>)}</div>}
          </div>
          <div className="aiact">
            {t.id !== 'real' && mods.on('copyKb') && <Toggle checked={useKb} onChange={setUseKb} label="用我的知识库" />}
            <button className="btn cta" id="gAiGo" disabled={writing || (t.id === 'real' && !media.length)} onClick={t.id === 'real' ? aiFootage : aiWrite}>{writing ? 'AI 在写…' : t.id === 'real' ? `看 ${media.length} 段素材写文案 →` : 'AI 写一版 →'}</button>
          </div>
        </div>
        <div className="gcard">
          <div className="gtop"><b className="s">{t.voice === '口播' ? '口播文案' : '画外音文案'}</b><span className="sp" /><span className="xs m3" id="gCount">{chars(g.copy)} 字 · {sentences.length} 句 · 配音约 {estSecs} 秒</span></div>
          <textarea id="gCopy" aria-label="文案" value={g.copy} onChange={e => set({ copy: e.target.value })} rows={t.id === 'real' ? 3 : undefined} className={t.id === 'real' ? 'short' : ''} placeholder={t.id === 'real' ? '可以不写：AI 看完素材会写好；也可以自己写，一句配一段素材。' : '贴一段文案。按句拆镜头，每句配音多长，那一镜就多长。'} />
          {t.id !== 'real' && <div className="att" id="gAtt" aria-label="素材">
            {used.map(a => <button key={a.id} className="th" aria-label={`移除素材 ${a.name}`} title={`${a.note ?? a.name} · 点一下移除`} onClick={() => set({ assetIds: g.assetIds.filter(x => x !== a.id) })}><Ph k={a.k} asset={a} /></button>)}
            <button className="add" id="gAdd" aria-label="导入素材" onClick={() => pickAssets(addAssets, { already: g.assetIds })}>+</button>
            <span className="xs m3" style={{ alignSelf: 'center', whiteSpace: 'nowrap', paddingLeft: 4 }}>{used.length ? `${used.length} 份素材 · 第 3 步分到每一镜` : '照片做首帧，视频可以直接用原片'}</span>
          </div>}
        </div>
        {issues.filter(i => i.code !== 'avatar_missing' && i.code !== 'avatar_busy').length > 0 && <Warn issues={issues.filter(i => !i.code.startsWith('avatar'))} fix={fix} />}

        <div className="gctl" id="gCtl">
          <div className="gbox"><div className="hd">时长<span>按配音算</span></div>
            <div className="lenv ro">{estSecs}<small>秒</small></div>
            <p className="xs m3" style={{ marginTop: 8 }}>想要固定时长：</p>
            <Pills value={estSecs > g.len + 3 ? g.len : 0} options={[15, 30, 45, 60, 90].map(v => [v, `${v} 秒`] as [number, string])} onChange={v => { set({ len: v }); if (estSecs > v + 3) set({ len: v, copy: trimCopyToLen(g.copy, v) }); toast(estSecs > v + 3 ? `文案缩到 ${v} 秒以内了` : `${v} 秒够用，文案不用改`); }} /></div>
          <div className="gbox"><div className="hd">画面</div>
            <p className="lb">比例</p><Pills value={g.ratio} options={RATIOS} disabled={v => !!m.ratios && !m.ratios.includes(v)} onChange={v => set({ ratio: v })} />
            {t.id === 'real' ? <p className="xs m3" style={{ marginTop: 12 }}>实拍原片直接用，不生成画面，不用先出样片。</p> : <>
            {mods.on('draft') && <><p className="lb" style={{ marginTop: 12 }}>画质</p><Seg value={g.draft && m.draft ? 'draft' : 'final'} options={['draft', 'final'] as const} render={v => v === 'draft' ? '先出样片' : '直接成片'} onChange={v => set({ draft: v === 'draft' })} />
            <p className="xs m3" style={{ marginTop: 6 }}>{g.draft && m.draft ? `样片 ${draftResOf(g.model)}、便宜很多，满意再出成片` : `${g.res} 成片`}</p></>}</>}</div>
          <div className="gbox"><div className="hd">字幕和音乐</div>
            <Toggle checked={g.subs} onChange={v => set({ subs: v })} label="字幕" hint="按句出，跟着说话的节奏" />
            <p className="lb" style={{ marginTop: 12 }}>背景音乐</p><Pills value={g.bgm} options={BGMS} onChange={v => set({ bgm: v })} /></div>
          <div className="gbox"><div className="hd">声音{mods.on('voiceClone') && <button className="lnk xs" id="gClone" onClick={clone}>{vc === 'ready' ? '重新复刻' : '复刻我的声音'}</button>}</div>
            {!ttsOn && <p className="xs" style={{ color: 'var(--warn)', marginBottom: 8 }}>配音服务还没接：成片暂时没有配音，字幕照常，也不收配音费。</p>}
            <div className="vlist">{VOICES.filter(v => v.id !== 'me' || mods.on('voiceClone')).map(v => <button key={v.id} data-gk="voice" data-v={v.id} aria-pressed={g.voice === v.id} onClick={() => set({ voice: v.id })}>
              <span className="av">{v.k ? <Ph k={v.k} /> : '—'}</span><span><b>{v.n}</b><span>{v.id === 'me' ? (vc === 'ready' ? '复刻 · 已授权' : vc === 'busy' ? '复刻中…' : '还没复刻') : v.d}</span></span></button>)}</div></div>
          {mods.on('avatarShot') && <div className="gbox w2"><div className="hd">数字人出镜<button className="lnk xs" onClick={() => nav('me')}>管理形象</button></div>
            {t.avatar === 'none' ? <p className="s m">{t.n}默认不出镜。</p> : <div className="vlist">
              {([['none', '不出镜', '只用画面和配音'], ['clone', '真人分身', av.clone === 'ready' ? '可用 · 只改嘴型，最真实' : av.clone === 'busy' ? '审核中…' : '还没建：拍 1 分钟正脸视频'], ['photo', '照片形象', av.photo === 'ready' ? '可用 · 一张照片驱动' : av.photo === 'busy' ? '审核中…' : '还没建：传一张照片']] as const).map(([id, n, d]) =>
                <button key={id} data-av={id} aria-pressed={(g.avatar ?? 'none') === id} onClick={() => set({ avatar: id, shots: [] })}><span className="av">{id === 'none' ? '—' : <Ph k="person" />}</span><span><b>{n}</b><span>{d}</span></span></button>)}
              <p className="xs m3">{t.avatar === 'all' ? '全程出镜：整条配音一次驱动数字人，插入画面盖在上面，口型始终对得上。' : '模板里「本人出镜」的那几镜用数字人。'}</p>
            </div>}</div>}
        </div>

        {mods.on('proMode') && <details className="gshots adv" id="gAdv">
          <summary>高级参数 <span className="xs m3">模型、清晰度、语速、情绪、停顿、音量、环境声、风格、画面要求、随机种子</span></summary>
          <div className="advg">
            <div className="w2"><p className="lb">视频模型</p><div className="gm">{videoModels().map(x => <button key={x.id} data-gk="model" data-v={x.id} aria-pressed={g.model === x.id} aria-disabled={x.off || undefined} onClick={() => x.off ? toast('这个模型还没接入') : set({ model: x.id, draft: x.draft && g.draft })}>
              <span className="row" style={{ justifyContent: 'space-between', gap: 6 }}><b>{x.n}</b><i>{x.off ? '待接入' : `${x.pf} 点/秒`}</i></span><span>{x.d}</span></button>)}</div></div>
            <div><p className="lb">清晰度</p><Pills value={g.res} options={m.res as GenSettings['res'][]} onChange={v => set({ res: v })} />
              <p className="lb" style={{ marginTop: 14 }}>语速 <b className="ro">{g.speed.toFixed(1)}×</b></p><input type="range" className="rg" min={0.8} max={1.3} step={0.1} value={g.speed} onChange={e => set({ speed: Number(e.target.value) })} aria-label="语速" />
              <p className="lb">句间停顿 <b className="ro">{(g.pause ?? 0.3).toFixed(1)} 秒</b></p><input type="range" className="rg" min={0} max={1} step={0.1} value={g.pause ?? 0.3} onChange={e => set({ pause: Number(e.target.value) })} aria-label="句间停顿" /></div>
            <div><p className="lb">情绪</p><Pills value={g.emotion ?? '自动'} options={EMOTIONS} onChange={v => set({ emotion: v })} />
              <p className="lb" style={{ marginTop: 14 }}>音乐音量 <b className="ro">{Math.round((g.bgmVol ?? 0.2) * 100)}%</b>（说话时自动压低）</p><input type="range" className="rg" min={0} max={1} step={0.05} value={g.bgmVol ?? 0.2} onChange={e => set({ bgmVol: Number(e.target.value) })} aria-label="音乐音量" />
              <Toggle checked={g.ambience} onChange={v => set({ ambience: v })} label="画面环境声" hint="插入画面带环境声，数字人镜头不带" /></div>
            <div><p className="lb">风格</p><select className="fld" value={g.style} onChange={e => set({ style: e.target.value })} aria-label="风格"><option>AI 推荐</option>{STYLES.map(s => <option key={s[0]} value={s[0]}>{s[0]} · {s[2]}</option>)}</select>
              <Toggle checked={!!g.seed} onChange={v => set({ seed: v })} label="固定随机种子" hint="重做时画面更接近上一版" /></div>
            <div className="w2"><p className="lb">全片画面要求（加到每一镜的描述后面）</p><textarea className="fld" rows={2} value={g.prompt} onChange={e => set({ prompt: e.target.value })} placeholder={`比如：${session!.persona.proj}，${session!.persona.read[1][1]}，真实自然光`} /></div>
          </div>
        </details>}

        <div className="gfoot"><div><p className="t2">{t.n} · {t.id === 'real' ? `${media.length} 段素材` : `${sentences.length} 句 · 约 ${estSecs} 秒`}</p><p className="xs m3">{VOICES.find(v => v.id === g.voice)?.n} · {avatarOn ? (g.avatar === 'clone' ? '真人分身出镜' : '照片形象出镜') : '不出镜'} · {t.id === 'real' ? '实拍原片，不生成画面' : m.n}</p></div><span className="sp" />
          <button className="btn g" onClick={() => setStep(1)}>上一步</button>{t.id === 'real' && !g.copy.trim()
            ? <button className="btn cta" id="gNext" disabled={writing || !media.length} onClick={aiFootage}>{writing ? 'AI 在看素材…' : media.length ? `看 ${media.length} 段素材写文案 →` : '先放素材'}</button>
            : <button className="btn cta" id="gNext" disabled={!g.copy.trim()} onClick={toStep3}>下一步：确认分镜 <span aria-hidden="true">→</span></button>}</div>
      </>}

      {step === 3 && <>
        <div className="row" style={{ marginTop: 26, alignItems: 'flex-end' }}><div style={{ flex: 1 }}><h2 className="t1">确认分镜</h2><p className="s m" style={{ marginTop: 4 }}>{shots.length} 镜 · 共 {shots.reduce((a, s) => a + s.dur, 0)} 秒。时长默认跟着这句配音，解锁后可以手动改。</p></div>
          <button className="btn g sm" onClick={() => speak(shots.map(s => s.line).join('。'), g.speed)}>试听全部</button><button className="btn g sm" id="gRebuild" onClick={() => { rebuild(); toast('按文案重新拆好了'); }}>按文案重拆</button></div>
        <div className="sboard" id="gBoard">{shots.map((s, i) => <ShotRow key={s.id} i={i} s={s} n={shots.length} assets={A} model={m} speed={g.speed}
          onChange={p => set({ shots: shots.map(x => {
            if (x.id !== s.id) return x;
            const y = { ...x, ...p };
            if (!y.lock || (p.line === undefined && p.start === undefined && p.source === undefined && p.lock === undefined)) return y;
            // 素材原片跟着配音和素材长度走；生成的镜头按模型的时长范围
            const a = y.assetId ? A.find(q => q.id === y.assetId) : null;
            return { ...y, dur: y.source === 'clip' ? clipDur(y.line, g.speed, (a?.dur ?? 15) - (y.start ?? 0)) : relock([y], modelOf(y.model || g.model), g.speed)[0].dur };
          }) })}
          onMove={d => { const L = [...shots], j = i + d; if (j < 0 || j >= L.length) return; [L[i], L[j]] = [L[j], L[i]]; set({ shots: L }); }}
          onDel={() => set({ shots: shots.filter(x => x.id !== s.id) })}
          onAdd={() => { const L = [...shots]; L.splice(i + 1, 0, { ...s, id: `s${Date.now()}`, line: '', lock: false, dur: m.min, source: 'ai', assetId: null, prompt: '' }); set({ shots: L }); }}
          pick={cb => pickAssets(l => { addAssets([]); setExtra(e => [...l, ...e]); cb(l[0]); }, { title: '选这一镜的素材' })} />)}</div>
        {issues.length > 0 && <Warn issues={issues} fix={fix} />}
        <div className="gbox" style={{ marginTop: 12 }}><div className="hd">费用明细<span>按实际结算，失败的镜头自动退点</span></div>
          <div className="list">{lines.map(l => <div key={l.k}><span>{l.label}</span><span className="v">{l.pts} 点</span></div>)}<div className="tot"><span>预计</span><span>{costTotal(lines)} 点</span></div></div></div>
        <div className="gfoot" id="gFoot">
          <div><p className="t2">{shots.length} 镜 · {shots.reduce((a, s) => a + s.dur, 0)} 秒 · {g.ratio} · {isDraft(g) ? `样片 ${draftResOf(g.model)}` : g.res}</p>
            <p className="xs m3">余额 {Math.round(session!.workspace.balance).toLocaleString()} 点{session!.limits.dailyJobs ? ` · 今天还能生成 ${Math.max(0, session!.limits.dailyJobs - session!.limits.jobsToday)} 次` : ''}</p>
</div>
          <span className="sp" />
          <button className="btn g" onClick={() => setStep(2)}>上一步</button>
          <button className="btn cta" id="gGo" disabled={blocked || !!running || !shots.length || session!.limits.genPaused} onClick={() => submit(false)}>{running ? '生成中…' : `生成视频 · ${costTotal(lines)} 点`}</button>
        </div>
      </>}

      <div id="gOut" aria-live="polite"><JobView job={job}
        onFinal={() => { if (!job) return; const input = job.input as GenSettings; run({ ...input, draft: false, reuse: undefined }, true, (job.output as VideoOutput).title, '出成片'); }}
        onRedo={i => { if (!job) return; redo(job.output as VideoOutput, job.input as GenSettings, k => k !== i, `重做第 ${i + 1} 镜`); }}
        onRedub={() => job && redub(job.output as VideoOutput, job.input as GenSettings)}
        onMusic={bgm => { if (!job) return; redo(job.output as VideoOutput, job.input as GenSettings, () => true, `换音乐：${bgm}`, { bgm, remix: 'music' }); }}
        onSch={async () => { try { const tp = topic ?? await api.addTopic({ title: (job?.output as VideoOutput | null)?.title ?? title, hook: sentences[0] ?? '', source: 'mat', why: '从生成视频来' }); if (!topic) set({ topicId: tp.id }); schedule(tp); } catch (e) { fail(e); } }} /></div>
    </div>
  </div></section>;
}

function Warn({ issues, fix }: { issues: ReturnType<typeof genIssues>; fix: (id: string) => void }) {
  return <div className="gwarn" id="gWarn">{issues.map(i => <div key={i.code}><span>{i.text}</span>{i.fixes.map(f => <button key={f.id} className="btn g sm" data-gf={f.id} onClick={() => fix(f.id)}>{f.label}</button>)}</div>)}</div>;
}

const SOURCES: ShotSource[] = ['avatar', 'frame', 'clip', 'ai'];
function ShotRow({ i, s, n, assets, model, speed, onChange, onMove, onDel, onAdd, pick }: {
  i: number; s: ShotSpec; n: number; assets: Asset[]; model: ReturnType<typeof modelOf>; speed: number;
  onChange: (p: Partial<ShotSpec>) => void; onMove: (d: number) => void; onDel: () => void; onAdd: () => void; pick: (cb: (a: Asset) => void) => void;
}) {
  const { sheet } = useApp();
  const a = s.assetId ? assets.find(x => x.id === s.assetId) ?? null : null;
  const vs = voiceSecs(s.line, speed);
  const clip = s.source === 'clip';
  const start = s.start ?? 0;
  // 素材原片：时长受素材长度限制，不受视频模型最短时长限制
  const avail = clip ? Math.max(1, Math.min(15, (a?.dur ?? 15) - start)) : Math.min(model.max, 15);
  const lo = clip ? 1 : model.min, cap = clip ? Math.floor(avail) : avail;
  const preview = () => a?.url && sheet({ title: `第 ${i + 1} 镜 · 原片第 ${start} 秒起 ${s.dur} 秒`, body: <video src={`${fileUrl(a.url)}#t=${start},${start + s.dur}`} controls playsInline autoPlay style={{ width: '100%', maxHeight: '60vh', background: '#000', borderRadius: 12 }} /> });
  return <div className="sbrow" data-shot={i}>
    <div className="sbl"><span className="xs m3">{i + 1}</span>
      <div className="sbth"><Ph k={s.source === 'avatar' ? 'person' : a?.k ?? 'live'} asset={s.source === 'avatar' ? null : a} tag={s.source === 'avatar' ? undefined : a ? 'real' : 'gen'} /></div>
      <select className="fld sm" aria-label="画面来源" value={s.source} onChange={e => onChange({ source: e.target.value as ShotSource })}>{SOURCES.map(x => <option key={x} value={x}>{SOURCE_NAME[x]}</option>)}</select>
      {(s.source === 'frame' || clip) && <button className="lnk xs" onClick={() => pick(x => onChange({ assetId: x.id, start: 0 }))}>{a ? '换素材' : '选素材'}</button>}
    </div>
    <div className="sbm">
      <textarea className="fld" rows={2} aria-label="台词" value={s.line} onChange={e => onChange({ line: e.target.value })} placeholder="这一镜说什么；留空就是空镜" />
      {clip ? <>
        <p className="xs m3 cliptxt">{a ? `${a.note ?? a.name}${a.noteSrc === 'name' ? '（按文件名）' : ''}` : '还没选素材'}</p>
        <div className="sbp clipctl">
          <label className="xs">从第 <input className="fld sm ro" type="number" aria-label="从第几秒开始" min={0} max={Math.max(0, Math.floor((a?.dur ?? 15) - 1))} step={1} value={start} onChange={e => onChange({ start: Math.max(0, Math.min(Math.floor((a?.dur ?? 15) - 1), Number(e.target.value) || 0)) })} style={{ width: 64 }} /> 秒开始用</label>
          <span className="xs m3">{a?.dur ? `原片 ${a.dur} 秒` : '原片时长未知'}</span>
          {a?.url && <button className="lnk xs" onClick={preview}>预览这一段</button>}
          <select className="fld sm" aria-label="转场" value={s.trans} onChange={e => onChange({ trans: e.target.value })}>{TRANSITIONS.map(x => <option key={x}>{x}</option>)}</select>
        </div>
      </> : <>
        <input className="fld sm" aria-label="画面描述" value={s.prompt} onChange={e => onChange({ prompt: e.target.value })} placeholder="画面描述：画面里有什么、光线、动作" />
        <div className="sbp">
          <select className="fld sm" aria-label="景别" value={s.size} onChange={e => onChange({ size: e.target.value })}>{SIZES.map(x => <option key={x}>{x}</option>)}</select>
          <select className="fld sm" aria-label="运镜" value={s.move} onChange={e => onChange({ move: e.target.value })}>{MOVES.map(x => <option key={x}>{x}</option>)}</select>
          <select className="fld sm" aria-label="单镜模型" value={s.model} onChange={e => onChange({ model: e.target.value })}><option value="">跟全片模型</option>{videoModels().filter(x => !x.off).map(x => <option key={x.id} value={x.id}>{x.n}</option>)}</select>
          <select className="fld sm" aria-label="转场" value={s.trans} onChange={e => onChange({ trans: e.target.value })}>{TRANSITIONS.map(x => <option key={x}>{x}</option>)}</select>
        </div>
      </>}
    </div>
    <div className="sbr">
      <label className="xs"><input type="checkbox" checked={s.lock} onChange={e => onChange({ lock: e.target.checked })} /> 跟随配音</label>
      <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><input className="fld sm ro" type="number" aria-label="时长（秒）" min={lo} max={cap} value={s.dur} disabled={s.lock} onChange={e => onChange({ dur: Math.min(cap, Math.max(lo, Number(e.target.value) || lo)) })} style={{ width: 64 }} /><span className="xs m3">秒</span></div>
      <span className="xs m3">配音约 {vs} 秒{vs > s.dur + 0.5 ? <span style={{ color: 'var(--warn)' }}>{clip ? ` · 素材不够长，最后定格 ${Math.ceil(vs + 0.3 - s.dur)} 秒，或把这句改短` : ' · 说不完'}</span> : ''}</span>
      <div className="row" style={{ gap: 4 }}>
        <button className="btn g sm" aria-label="试听这句" onClick={() => speak(s.line, speed)}>▶</button>
        <button className="btn g sm" aria-label="上移" disabled={i === 0} onClick={() => onMove(-1)}>↑</button>
        <button className="btn g sm" aria-label="下移" disabled={i === n - 1} onClick={() => onMove(1)}>↓</button>
        <button className="btn g sm" aria-label="在后面加一镜" onClick={onAdd}>＋</button>
        {n > 1 && <button className="btn g sm" aria-label="删除这一镜" onClick={onDel}>×</button>}
      </div>
    </div>
  </div>;
}

/** 实拍出片的第 2 步主角：大的上传区，小类的拍摄清单变成格子，传一段填一格 */
function RealDrop({ sub, media, busy, onFiles, onPick, onRemove }: { sub: SubType | undefined; media: Asset[]; busy: string | null; onFiles: (f: File[]) => void; onPick: () => void; onRemove: (id: string) => void }) {
  const slots = sub?.shots ?? [];
  const n = Math.max(slots.length, media.length);
  const [over, setOver] = useState(false);
  // 输入框放在页面里（不临时创建），手机相册多选、电脑拖进来都走这里
  const input = useRef<HTMLInputElement | null>(null);
  const take = (l: FileList | null) => { const f = [...(l ?? [])].filter(x => /^(image|video)\//.test(x.type)); if (f.length) onFiles(f); };
  return <div className={`realdrop card${over ? ' over' : ''}`} id="gDrop" onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}>
    <input ref={input} type="file" id="gUploadInput" accept={ACCEPT} multiple hidden onChange={e => { take(e.target.files); e.target.value = ''; }} />
    <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <p className="t2">放你拍的素材{sub ? ` · ${sub.n}` : ''}</p>
        <p className="s m" style={{ marginTop: 4 }}>按下面的顺序拍，传一段填一格；顺序就是成片的顺序。视频每段 3–15 秒最好用，照片也行。电脑上可以直接把文件拖进这个框。</p>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn y" id="gUpload" disabled={!!busy} onClick={() => input.current?.click()}>{busy ?? (media.length ? '再传几段' : '上传视频或照片')}</button>
        <button className="btn g" id="gPickLib" onClick={onPick}>从素材库选</button>
      </div>
    </div>
    <ol className="slots">{Array.from({ length: n }, (_, i) => {
      const a = media[i];
      return <li key={i} className={a ? 'on' : ''}>
        <div className="slth">{a ? <Ph k={a.k} asset={a} tag="real" /> : <span className="num">{i + 1}</span>}</div>
        <div className="slb"><p className="xs m3">第 {i + 1} 段{slots[i] ? '' : ' · 补充'}</p><p className="s">{slots[i] ?? (a?.note ?? a?.name ?? '')}</p>
          {a && <p className="xs m3 ellip">{a.name}{a.dur ? ` · ${a.dur} 秒` : ''}</p>}</div>
        {a && <button className="lnk xs" aria-label={`移除第 ${i + 1} 段`} onClick={() => onRemove(a.id)}>移除</button>}
      </li>;
    })}</ol>
  </div>;
}

function Redub({ g, onOk }: { g: GenSettings; onOk: (p: Partial<GenSettings>) => void }) {
  const [voice, setVoice] = useState<GenSettings['voice']>(g.voice === 'none' ? 'p1' : g.voice);
  const [speed, setSpeed] = useState(g.speed);
  const shots = g.shots ?? [];
  const over = shots.filter(s => voiceSecs(s.line, speed) > s.dur * 1.1);
  return <>
    <p className="s m" style={{ marginBottom: 12 }}>画面不重新生成，只重新配音和合成。新配音和画面差 10% 以内会自动微调；超出的镜头会提示。</p>
    <p className="lb">声音</p><Pills value={voice} options={VOICES.filter(v => v.id !== 'none').map(v => [v.id, v.n] as [GenSettings['voice'], string])} onChange={v => setVoice(v)} />
    <p className="lb" style={{ marginTop: 14 }}>语速 <b className="ro">{speed.toFixed(1)}×</b></p><input type="range" className="rg" min={0.8} max={1.3} step={0.1} value={speed} onChange={e => setSpeed(Number(e.target.value))} aria-label="语速" />
    {over.length > 0 && <p className="xs" style={{ color: 'var(--warn)' }}>{over.length} 镜配音会比画面长：会先把这几句语速提到最多 1.15 倍；还不够可以在分镜里单独重做那一镜。</p>}
    <p className="note">自己录音：成片后逐句录或整段上传，接上配音服务后开放。数字人出镜的部分会按新配音重做口型（按秒计费）。</p>
    <div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}><button className="btn y" id="redubOk" onClick={() => onOk({ voice, speed })}>换配音</button></div>
  </>;
}

function JobView({ job, onFinal, onRedo, onRedub, onMusic, onSch }: { job: Job | null; onFinal: () => void; onRedo: (i: number) => void; onRedub: () => void; onMusic: (bgm: string) => void; onSch: () => void }) {
  const { toast, sheet } = useApp();
  if (!job) return null;
  if (job.status === 'queued' || job.status === 'running') {
    return <div className="gout" style={{ gridTemplateColumns: '1fr' }}><div>
      <p className="t1">正在生成</p><div className="gprog"><i style={{ width: `${((job.step + 0.5) / job.steps.length) * 100}%` }} /></div>
      <div className="gsteps">{job.steps.map((s, i) => <span key={s} className={i < job.step ? 'ok' : i === job.step ? 'on' : ''}>{s}</span>)}</div>
      <p className="xs m3" style={{ marginTop: 12 }}>离开页面不会中断，右上角「任务」里能看到进度。</p></div></div>;
  }
  if (job.status === 'failed') return <div className="gout" style={{ gridTemplateColumns: '1fr' }}><div><p className="t1">没生成成功</p><p className="s m" style={{ marginTop: 6 }}>{job.error}。点数已退回。</p></div></div>;
  const o = job.output as VideoOutput, first = o.shots[0], input = job.input as GenSettings;
  const total = o.shots.reduce((a, s) => a + s.dur, 0) || 1;
  return <div className="gout" id="gResult">
    <div className={`pv ${o.ratio === '16:9' ? 'h' : ''}`}>{o.videoUrl
      ? <video src={fileUrl(o.videoUrl)} controls playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: '#000' }} />
      : first?.videoUrl && !first.videoUrl.startsWith('mock:') ? <ShotPlayer urls={o.shots.map(s => fileUrl(s.videoUrl) ?? null)} />
      : <><Ph k={first?.k ?? 'live'} tag="gen" /><p className="cap2">{first?.line}</p></>}</div>
    <div style={{ minWidth: 0 }}>
      <p className="xs m3">{o.draft ? `样片 · ${o.res}` : `成片 · ${o.res}`} · AI 生成内容已标识</p><h2 className="d3" style={{ marginTop: 6 }}>{o.title}</h2>
      {o.audioNote && <p className="xs" style={{ color: 'var(--warn)', marginTop: 6 }} id="gAudioNote">{o.audioNote}</p>}
      {o.partial && <p className="s" style={{ color: 'var(--warn)', marginTop: 6 }}>{o.shots.filter(s => s.failed).length} 镜没生成成功，点数已退回。点下面标红的镜头单独重做。</p>}
      <div className="track" aria-label="轨道">
        <div className="tr"><span>画面</span><div>{o.shots.map((s, i) => <button key={i} style={{ flex: s.dur / total }} className={s.failed ? 'bad' : s.source === 'avatar' ? 'avt' : ''} title={`第 ${i + 1} 镜 · ${s.dur} 秒 · ${s.source ? SOURCE_NAME[s.source] : ''}${s.failed ? ` · 失败：${s.failed}` : ''}`}
          onClick={() => sheet({ title: `第 ${i + 1} 镜`, body: <><p className="s">{s.line || '（空镜）'}</p><p className="xs m3" style={{ marginTop: 8 }}>{s.dur} 秒 · {s.source ? SOURCE_NAME[s.source] : 'AI 生成'}{s.size ? ` · ${s.size} · ${s.move}` : ''}{s.reused ? ' · 沿用上一版' : ''}</p>{s.failed && <p className="xs" style={{ color: 'var(--err)', marginTop: 8 }}>失败原因：{s.failed}</p>}</>, foot: <><button className="btn g" onClick={() => sheet(null)}>关闭</button><button className="btn y" disabled={!input.shots?.length} onClick={() => { sheet(null); onRedo(i); }}>只重做这一镜</button></> })}>{i + 1}</button>)}</div></div>
        <div className="tr"><span>配音</span><div>{o.shots.map((s, i) => <i key={i} style={{ flex: s.dur / total }} className={input.voice === 'none' ? 'off' : ''} />)}</div></div>
        <div className="tr"><span>字幕</span><div>{o.shots.map((s, i) => <i key={i} style={{ flex: s.dur / total }} className={input.subs ? '' : 'off'} />)}</div></div>
        <div className="tr"><span>音乐</span><div><i style={{ flex: 1 }} className={input.bgm === '不要' ? 'off' : ''}>{input.bgm}</i></div></div>
      </div>
      <div className="row" style={{ marginTop: 16, gap: 8 }}>
        {o.draft ? <button className="btn y" id="goFinal" onClick={onFinal}>出成片</button> : o.videoUrl ? <a className="btn y" href={fileUrl(o.videoUrl)} download={`${o.title}.mp4`} onClick={() => void api.track('download')}>下载</a> : <button className="btn y" onClick={() => toast('开发版（Mock）没有真实视频可下载')}>下载</button>}
        <button className="btn g" id="goRedub" disabled={!input.shots?.length} onClick={onRedub}>换配音</button>
        <button className="btn g" id="goMusic" disabled={!input.shots?.length} onClick={() => sheet({ title: '换音乐', body: <><p className="s m" style={{ marginBottom: 12 }}>只重新合成，画面和配音都不动。</p><div className="list">{BGMS.map(b => <button key={b} onClick={() => { sheet(null); onMusic(b); }}><span>{b}</span><span className="v">{b === input.bgm ? '当前' : '›'}</span></button>)}</div></> })}>换音乐</button>
        <button className="btn g" id="goSch" onClick={onSch}>放进 AI 运营</button>
      </div>
      <p className="xs m3" style={{ marginTop: 10 }}>{o.len} 秒 · {o.shots.length} 镜 · {modelOf(o.model).n} · {VOICES.find(v => v.id === o.voice)?.n ?? '—'} · 花费 {job.cost} 点 · 点轨道上的某一镜可以单独重做</p>
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
  const d = useData(() => api.drafts(), []);
  if (!d.data) return null;
  if (!d.data.drafts.length) return <p className="s m">草稿箱还是空的。在 dazheip 写好文案点「做成视频」，或者直接把文案贴进来。</p>;
  return <div className="list">{d.data.drafts.map(c => <button key={c.id} data-dp={c.topicId} onClick={() => onPick(copyText(c), c.title, c.topicId, c.len)}><span>{c.title}<br /><span className="xs m3">{c.kind} · {c.len} 秒 · 约 {Math.round(chars(copyText(c)) / 4.5)} 秒口播</span></span><span className="v">导入 ›</span></button>)}</div>;
}
