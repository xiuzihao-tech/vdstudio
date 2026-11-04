// 管理我的素材：素材 / 数字人与声音 / 品牌资料（原知识库）。原来单独的「数字人与品牌」页并到这里，不再单独一级。
import { api } from '../../api.ts';
import { useApp, useData } from '../../store.tsx';
import { Src, pickFiles } from '../../ui/kit.tsx';
import { ACCEPT } from '../../ui/pickers.tsx';
import { useMods } from '../../ui/mods.tsx';
import { AvatarCard, Kb } from '../Me.tsx';
import { StorageBar } from '../Library.tsx';
import { useCloneVoice } from '../ip/More.tsx';
import { AvatarArt, Thumb, useStudio } from './common.tsx';
import { AVATARS, newDraft, type Mat } from '../../../shared/studio.ts';
import type { Asset } from '../../../shared/types.ts';

type Tab = 'files' | 'avatar' | 'brand';
const TABS: [Tab, string][] = [['files', '素材'], ['avatar', '数字人与声音'], ['brand', '品牌资料']];
const toMat = (a: Asset): Mat => ({ id: a.id, name: a.name, kind: a.type === '视频' || a.mime?.startsWith('video/') ? 'video' : 'photo', k: a.k, url: a.url, mime: a.mime });

export function MatPage() {
  const { route, nav } = useApp();
  const tab: Tab = TABS.some(([k]) => k === route.sub) ? route.sub as Tab : 'files';
  return <section className="view on" id="v-mat"><div className="vb wrap sch">
    <div className="hero tight" style={{ padding: '40px 0 0' }}>
      <p className="eyebrow">管理我的素材</p>
      <h1 className="d2">素材、数字人、品牌资料，<em>放一处</em>。</h1>
      <p className="s m" style={{ marginTop: 8 }}>出片时直接从这里拿：照片视频配分镜，数字人出镜，品牌资料让文案像你写的。</p>
      <div className="seg" role="tablist" id="matTabs" style={{ marginTop: 18 }}>{TABS.map(([k, n]) => <button key={k} role="tab" aria-pressed={tab === k} aria-selected={tab === k} onClick={() => nav({ view: 'mat', sub: k }, true)}>{n}</button>)}</div>
    </div>
    {tab === 'files' ? <Files /> : tab === 'avatar' ? <Avatars /> : <div style={{ marginTop: 18 }}><Kb /></div>}
  </div></section>;
}

function Files() {
  const { fail, toast, nav } = useApp();
  const mods = useMods();
  const { save } = useStudio();
  const d = useData(() => api.assets(), []);
  const list = d.data?.assets ?? [];
  const up = async () => { const fs = await pickFiles(ACCEPT); if (!fs.length) return; try { for (const f of fs) await api.upload(f, '素材库'); d.reload(); toast(`传好了 ${fs.length} 份`); } catch (e) { fail(e); } };
  const use = (a: Asset[]) => { void save({ draft: { ...newDraft(new Date().toISOString()), mats: a.map(toMat) } }); nav({ view: 'make', sub: 'flow' }); };
  return <>
    {mods.on('retention') && <StorageBar />}
    <div className="row" style={{ gap: 8, margin: '18px 0' }}>
      <button className="btn y" id="matUp" onClick={up}>上传照片 / 视频</button>
      <button className="btn g" onClick={async () => { try { const r = await api.addSamples(); d.reload(); toast(`加了 ${r.added} 份示例素材`); } catch (e) { fail(e); } }}>添加示例素材</button>
      {list.length > 0 && <button className="btn k" onClick={() => use(list.slice(0, 8))}>用最近 {Math.min(8, list.length)} 份出片 →</button>}
    </div>
    {!list.length ? <p className="s m">还没有素材。工地、案例、门店随手拍的都可以传上来，出片时直接用。</p>
      : <div className="matlib" id="matLib">{list.map(a => <div key={a.id} className="mli">
        <Thumb mat={toMat(a)} />
        <div className="mli-b"><b className="ellip">{a.name}</b><span className="xs m3 ellip">{a.note || a.type}</span>
          <div className="row" style={{ gap: 10, marginTop: 6 }}><button className="lnk xs" onClick={() => use([a])}>用它出片</button><button className="lnk xs" onClick={async () => { try { await api.deleteAsset(a.id); d.reload(); toast('删掉了'); } catch (e) { fail(e); } }}>删除</button></div></div>
      </div>)}</div>}
  </>;
}

function Avatars() {
  const { session, toast } = useApp();
  const { st, save } = useStudio();
  const mods = useMods();
  const clone = useCloneVoice();
  const ws = session!.workspace, av = ws.avatars ?? { clone: 'none', photo: 'none' };
  const def = st?.avatar ?? 'me-clone';
  return <>
    <p className="lb" style={{ marginTop: 22 }}>我的形象和声音</p>
    <p className="s m" style={{ marginBottom: 12 }}>建一次，以后每条视频都能出镜，不用每次重建。只能用本人的，要本人授权。</p>
    <div className="mecards">
      {mods.on('voiceClone') && <div className="card" id="matVoice">
        <div className="row" style={{ justifyContent: 'space-between' }}><p className="t2">我的声音</p><Src k={ws.voiceClone === 'ready' ? 'real' : ''}>{ws.voiceClone === 'ready' ? '可用' : ws.voiceClone === 'busy' ? '处理中' : '还没录'}</Src></div>
        <p className="s m" style={{ marginTop: 8 }}>安静的地方录 30 秒，像平时讲解一样说。数字人和「不露脸」配音都能用这个声音。</p>
        <div className="row" style={{ gap: 8, marginTop: 14 }}><button className="btn y sm" onClick={clone}>{ws.voiceClone === 'ready' ? '重新录' : '录 30 秒'}</button></div>
      </div>}
      {mods.on('avatars') && <>
        <AvatarCard kind="clone" state={av.clone} onTry={() => { void save({ avatar: 'me-clone' }); toast('出片时默认用真人分身'); }} />
        <AvatarCard kind="photo" state={av.photo} onTry={() => { void save({ avatar: 'me-photo' }); toast('出片时默认用照片形象'); }} />
      </>}
    </div>
    <p className="lb" style={{ marginTop: 28 }}>系统数字人 <span className="xs m3">还没建自己的，先用这些出镜</span></p>
    <div className="avgrid" id="matAvatars">{AVATARS.map(x => <button key={x.id} className="avc" aria-pressed={def === x.id} onClick={() => { void save({ avatar: x.id }); toast(`出片时默认用「${x.n}」`); }}>
      <AvatarArt look={x} /><b>{x.n}{x.mine && <span className="tag">我的</span>}{def === x.id && <span className="tag hot">默认</span>}</b><span className="xs m3">{x.d}</span>
    </button>)}</div>
    <p className="note">在「一键生成视频」第 2 步可以换。选「不露脸」就用 AI 配音或只放音乐。</p>
  </>;
}
