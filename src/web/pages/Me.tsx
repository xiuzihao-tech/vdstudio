// 形象与声音：声音复刻、真人分身（本人视频，只改嘴型）、照片形象（一张照片驱动）。都要本人授权：念一句带随机数字的授权声明。
import { useMemo, useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../store.tsx';
import { Ph, Src, pickFiles } from '../ui/kit.tsx';
import { useCloneVoice } from './ip/More.tsx';
import { speak } from './Gen.tsx';

const ST: Record<string, [string, string]> = { none: ['', '还没建'], busy: ['gen', '审核中'], ready: ['real', '可用'] };
const SAMPLE = '大家好，我是这个账号的主理人。今天用一分钟，讲清楚一个装修里最容易后悔的地方。';

export function MePage() {
  const { session, setGenSeed, nav } = useApp();
  const clone = useCloneVoice();
  const ws = session!.workspace, av = ws.avatars ?? { clone: 'none', photo: 'none' };
  const tryIt = (kind: 'clone' | 'photo') => { setGenSeed({ copy: SAMPLE, type: 'talk', avatar: kind, voice: ws.voiceClone === 'ready' ? 'me' : 'p1', draft: true }); nav('gen'); };
  return <section className="view on" id="v-me"><div className="vb wrap" style={{ maxWidth: 980, paddingTop: 44 }}>
    <h1 className="d2">形象与声音</h1>
    <p className="s m" style={{ marginTop: 8 }}>设一次，之后每条视频都能用。只能用你本人的形象和声音，每次都要本人授权。</p>

    <div className="mecards">
      <div className="card" id="meVoice">
        <div className="row" style={{ justifyContent: 'space-between' }}><p className="t2">我的声音</p><Src k={ST[ws.voiceClone][0]}>{ST[ws.voiceClone][1]}</Src></div>
        <p className="s m" style={{ marginTop: 8 }}>录 30 秒自然说话，复刻后配音就是你自己的声音。录音也会用来判断你的说话风格。</p>
        <ul className="xs m3 tips"><li>安静的房间，手机离嘴一拳</li><li>像平时讲解一样说，不用念稿</li><li>录完要确认是本人声音并同意授权</li></ul>
        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <button className="btn y sm" id="meClone" onClick={clone}>{ws.voiceClone === 'ready' ? '重新录' : '录 30 秒'}</button>
          <button className="btn g sm" onClick={() => speak(SAMPLE)}>试听示例</button>
        </div>
        <p className="xs m3" style={{ marginTop: 10 }}>配音服务（MiniMax speech-2.8-hd）接入前，复刻是示意流程，成片暂时用平台音色。</p>
      </div>
      <AvatarCard kind="clone" state={av.clone} onTry={() => tryIt('clone')} />
      <AvatarCard kind="photo" state={av.photo} onTry={() => tryIt('photo')} />
    </div>

    <div className="card" style={{ marginTop: 16 }}>
      <p className="t2">授权记录</p>
      <div className="list" style={{ marginTop: 10 }}>
        <div><span>声音复刻</span><span className="v">{ws.voiceClone === 'none' ? '未授权' : '本人录音 · 已同意'}</span></div>
        <div><span>真人分身</span><span className="v">{av.clone === 'none' ? '未授权' : '本人视频 + 授权声明'}</span></div>
        <div><span>照片形象</span><span className="v">{av.photo === 'none' ? '未授权' : '本人照片 + 授权声明'}</span></div>
      </div>
      <p className="note">删除形象后，供应商那边的资料会一起删掉。成片都会带「AI 生成」标识，不能关闭。</p>
    </div>
  </div></section>;
}

function AvatarCard({ kind, state, onTry }: { kind: 'clone' | 'photo'; state: string; onTry: () => void }) {
  const { sheet, toast, fail, reloadSession } = useApp();
  const isClone = kind === 'clone';
  const del = async () => { try { await api.deleteAvatar(kind); await reloadSession(); toast('已删除'); } catch (e) { fail(e); } };
  return <div className="card" id={isClone ? 'meClone2' : 'mePhoto'}>
    <div className="row" style={{ justifyContent: 'space-between' }}><p className="t2">{isClone ? '真人分身' : '照片形象'}</p><Src k={ST[state][0]}>{ST[state][1]}</Src></div>
    <div className="meph"><Ph k="person" tag={state === 'ready' ? 'real' : undefined} /></div>
    <p className="s m">{isClone ? '拍 1 分钟正脸视频。之后每条视频只改嘴型，身体、背景、光线都是真的，最不容易显假。' : '一张清楚的正脸照片就能用，适合没时间拍视频的时候。动作由模型生成。'}</p>
    <div className="row" style={{ gap: 8, marginTop: 14 }}>
      {state === 'none' && <button className="btn y sm" data-mk={kind} onClick={() => sheet({ title: isClone ? '建真人分身' : '建照片形象', body: <Create kind={kind} /> })}>{isClone ? '拍视频建分身' : '传照片'}</button>}
      {state === 'ready' && <><button className="btn y sm" onClick={onTry}>试生成一条口播</button><button className="btn g sm" onClick={del}>删除</button></>}
      {state === 'busy' && <span className="xs m3">审核中，一般几分钟</span>}
    </div>
  </div>;
}

function Create({ kind }: { kind: 'clone' | 'photo' }) {
  const { session, sheet, toast, fail, reloadSession } = useApp();
  const code = useMemo(() => String(1000 + Math.floor(Math.random() * 9000)), []);
  const [file, setFile] = useState<File | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const isClone = kind === 'clone';
  const name = session!.user?.name ?? session!.workspace.positioning.name;
  const go = async (demo: boolean) => {
    setBusy(true);
    try { await api.createAvatar(kind, demo ? null : file); await reloadSession(); sheet(null); toast('提交了，审核好了就能出镜'); setTimeout(() => void reloadSession(), 3500); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  return <>
    <p className="lb">1. 拍摄要求</p>
    <ul className="xs m3 tips">{isClone
      ? <><li>正对镜头，肩部以上到半身，光线均匀、背景简洁</li><li>自然说 1–2 分钟，中间闭嘴停几次</li><li>不遮嘴、不大幅转头、不戴口罩</li></>
      : <><li>正脸、五官清楚、不戴墨镜</li><li>光线均匀，背景简洁</li><li>JPG / PNG，短边不少于 300 像素</li></>}</ul>
    <p className="lb" style={{ marginTop: 14 }}>2. 本人授权</p>
    <p className="s">对着镜头念：「我是{name}，我授权 FIND AI 用我的形象和声音生成视频，校验码 <b className="ro">{code}</b>。」{isClone ? '可以放在视频开头。' : '照片形象另外录一段 5 秒的视频。'}</p>
    <label className="row s" style={{ gap: 8, marginTop: 10, flexWrap: 'nowrap' }}><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} /><span>我确认是本人，并同意形象与声音授权协议</span></label>
    <p className="lb" style={{ marginTop: 14 }}>3. 上传</p>
    <button className="btn g sm" onClick={async () => { const f = (await pickFiles(isClone ? 'video/*' : 'image/*', false))[0]; if (f) setFile(f); }}>{file ? `已选：${file.name}` : isClone ? '选视频' : '选照片'}</button>
    <div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}>
      <button className="btn g" id="avDemo" disabled={busy || !agree} onClick={() => go(true)}>用示例跑通流程</button>
      <button className="btn y" id="avGo" disabled={busy || !agree || !file} onClick={() => go(false)}>提交</button>
    </div>
  </>;
}
