// 合成整条视频：各镜统一尺寸和帧率、烧上字幕，拼成一条；再把配音、背景音乐、素材原声混进去（说话时音乐自动压低）。
// 依赖系统里的 ffmpeg / ffprobe；字体需要支持中文（Docker 镜像里装了 Noto CJK）。
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const FONT_CANDIDATES = [
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc', '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc',
  '/System/Library/Fonts/PingFang.ttc', 'C:\\Windows\\Fonts\\msyh.ttc',
];
export const findFont = (pref?: string) => [pref, ...FONT_CANDIDATES].find((f): f is string => !!f && existsSync(f)) ?? null;

let ffmpegOk: boolean | null = null;
export function hasFfmpeg(): boolean {
  if (ffmpegOk === null) ffmpegOk = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 && spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
  return ffmpegOk;
}

/** 比例 + 清晰度 → 像素尺寸（短边按清晰度） */
export function frameSize(ratio: string, res: string): [number, number] {
  const short = res === '480p' ? 480 : res === '720p' ? 720 : 1080;
  const [a, b] = ratio.split(':').map(Number);
  const even = (n: number) => Math.round(n / 2) * 2;
  return a >= b ? [even((short * a) / b), short] : [short, even((short * b) / a)];
}

/** 中文按字数折行，避免字幕超出画面 */
export function wrapLine(s: string, per: number): string {
  const chars = [...s.replace(/\s+/g, ' ').trim()];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += per) out.push(chars.slice(i, i + per).join(''));
  return out.slice(0, 3).join('\n');
}

function run(args: string[]): Promise<void> {
  return new Promise((ok, bad) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => (code === 0 ? ok() : bad(new Error(`ffmpeg 失败：${err.slice(-300)}`))));
    p.on('error', bad);
  });
}

/** 读媒体信息：时长（秒）、宽高、有没有声音。读不出来返回 null */
export function probeMedia(file: string): { dur: number | null; width: number | null; height: number | null; hasAudio: boolean } | null {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  try {
    const j = JSON.parse(r.stdout) as { format?: { duration?: string }; streams?: { codec_type?: string; width?: number; height?: number }[] };
    const v = j.streams?.find(s => s.codec_type === 'video');
    const dur = Number(j.format?.duration);
    return { dur: Number.isFinite(dur) && dur > 0 ? Math.round(dur * 10) / 10 : null, width: v?.width ?? null, height: v?.height ?? null, hasAudio: !!j.streams?.some(s => s.codec_type === 'audio') };
  } catch { return null; }
}

/** 按给定的秒数截几张 JPEG（缩到 512 宽），给看图模型用 */
export async function extractFrames(file: string, times: number[]): Promise<{ jpg: Buffer; at: number }[]> {
  const dir = mkdtempSync(join(tmpdir(), 'findai-frames-'));
  try {
    const out: { jpg: Buffer; at: number }[] = [];
    for (const [i, at] of times.entries()) {
      const f = join(dir, `f${i}.jpg`);
      await run(['-ss', String(Math.max(0, at)), '-i', file, '-frames:v', '1', '-vf', "scale='min(512,iw)':-2", '-q:v', '5', f]).catch(() => {});
      if (existsSync(f)) out.push({ jpg: readFileSync(f), at });
    }
    return out;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export interface ComposeInput {
  urls: string[]; lines: string[];
  /** 每镜保留的秒数（生成时向上取整，合成时裁掉多余的；素材不够长时定格最后一帧补足） */ durs?: number[];
  /** 素材原片从第几秒开始用 */ starts?: number[];
  ratio: string; res: string; outFile: string; font?: string | null; subtitles?: boolean; fetch?: typeof fetch;
  /** 每镜配音（本机文件），null = 这一镜不说话。配音比画面长时，画面定格补到说完 */ voices?: (string | null)[];
  /** 背景音乐（本机文件），说话时自动压低 */ music?: string | null; musicVol?: number;
  /** 哪几镜保留素材原声（现场声），以及原声音量 */ keepOrig?: boolean[]; origVol?: number;
}

export async function composeVideo(o: ComposeInput): Promise<{ secs: number; durs: number[] }> {
  if (!o.urls.length) throw new Error('没有可合成的镜头');
  const dir = mkdtempSync(join(tmpdir(), 'findai-compose-'));
  const f = o.fetch ?? fetch;
  try {
    const [w, h] = frameSize(o.ratio, o.res);
    const font = o.subtitles === false ? null : findFont(o.font ?? undefined);
    const fontSize = Math.round(Math.min(w, h) * 0.05);
    const segs: string[] = [], lens: number[] = [];
    for (let i = 0; i < o.urls.length; i++) {
      // 输入可以是网址（中转站的视频链接）或本机文件路径（已转存的片段）
      let src = o.urls[i];
      if (/^https?:\/\//.test(src)) {
        const res = await f(src);
        if (!res.ok) throw new Error(`下载第 ${i + 1} 镜失败（${res.status}）`);
        src = join(dir, `src${i}.mp4`);
        writeFileSync(src, Buffer.from(await res.arrayBuffer()));
      }
      const info = probeMedia(src);
      const start = Math.max(0, o.starts?.[i] ?? 0);
      const voice = o.voices?.[i] ?? null;
      const vlen = voice ? probeMedia(voice)?.dur ?? 0 : 0;
      // 这一镜的长度：计划时长；配音更长就延到说完（多 0.25 秒呼吸）
      const want = o.durs?.[i] ?? (info?.dur ? Math.max(1, info.dur - start) : 5);
      const len = Math.round(Math.max(want, vlen ? vlen + 0.25 : 0) * 100) / 100;
      lens.push(len);
      const vf = [`scale=${w}:${h}:force_original_aspect_ratio=decrease`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`, 'setsar=1', 'fps=30', `tpad=stop_mode=clone:stop_duration=${Math.ceil(len) + 1}`];
      const line = (o.lines[i] ?? '').trim();
      if (font && line) {
        const txt = join(dir, `t${i}.txt`);
        writeFileSync(txt, wrapLine(line, Math.max(8, Math.floor((w * 0.86) / fontSize))));
        const esc = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
        vf.push(`drawtext=fontfile='${esc(font)}':textfile='${esc(txt)}':fontsize=${fontSize}:fontcolor=white:line_spacing=${Math.round(fontSize * 0.3)}:borderw=${Math.max(2, Math.round(fontSize / 12))}:bordercolor=black@0.85:x=(w-text_w)/2:y=h-text_h-${Math.round(h * 0.12)}`);
      }
      // 每段都带一条立体声音轨（原声或静音），后面才能直接拼接、再统一混音
      const keep = !!o.keepOrig?.[i] && !!info?.hasAudio;
      const seg = join(dir, `seg${i}.mp4`);
      await run([
        ...(start ? ['-ss', String(start)] : []), '-i', src,
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
        '-filter_complex', `[0:v]${vf.join(',')}[v];${keep ? '[0:a]aresample=44100,aformat=channel_layouts=stereo,apad[a]' : '[1:a]anull[a]'}`,
        '-map', '[v]', '-map', '[a]', '-t', String(len),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2', seg,
      ]);
      segs.push(seg);
    }
    const list = join(dir, 'list.txt');
    writeFileSync(list, segs.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'));
    mkdirSync(dirname(o.outFile), { recursive: true });
    const total = Math.round(lens.reduce((a, b) => a + b, 0) * 100) / 100;
    const voices = (o.voices ?? []).map((v, i) => (v ? { v, at: lens.slice(0, i).reduce((a, b) => a + b, 0) + 0.12 } : null)).filter((x): x is { v: string; at: number } => !!x);
    const music = o.music && existsSync(o.music) ? o.music : null;
    if (!voices.length && !music) {
      await run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', o.outFile]);
      return { secs: total, durs: lens };
    }
    const joined = join(dir, 'joined.mp4');
    await run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
    // 混音：配音（按每镜开始时间放）+ 背景音乐（循环、说话时压低）+ 原声
    const args = ['-i', joined, ...voices.flatMap(x => ['-i', x.v]), ...(music ? ['-stream_loop', '-1', '-i', music] : [])];
    const st = 'aresample=44100,aformat=channel_layouts=stereo';
    const parts: string[] = [`[0:a]volume=${o.origVol ?? 0.25}[og]`];
    voices.forEach((x, i) => { const ms = Math.round(x.at * 1000); parts.push(`[${i + 1}:a]${st},adelay=${ms}|${ms}[v${i}]`); });
    const mixIn: string[] = [];
    if (voices.length) {
      parts.push(voices.length === 1 ? '[v0]anull[vo]' : `${voices.map((_, i) => `[v${i}]`).join('')}amix=inputs=${voices.length}:normalize=0:dropout_transition=0[vo]`);
      if (music) parts.push('[vo]asplit=2[vo1][vosc]');
      mixIn.push(music ? '[vo1]' : '[vo]');
    }
    if (music) {
      parts.push(`[${voices.length + 1}:a]${st},volume=${o.musicVol ?? 0.2},atrim=0:${total}[bgraw]`);
      parts.push(voices.length ? '[bgraw][vosc]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=350[bg]' : '[bgraw]anull[bg]');
      mixIn.push('[bg]');
    }
    mixIn.push('[og]');
    parts.push(`${mixIn.join('')}amix=inputs=${mixIn.length}:normalize=0:dropout_transition=0,atrim=0:${total}[mix]`);
    await run([...args, '-filter_complex', parts.join(';'), '-map', '0:v', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', String(total), '-movflags', '+faststart', o.outFile]);
    return { secs: total, durs: lens };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 首帧图片内联成 Base64 时的大小上限；超过就先用 ffmpeg 缩到 1280 宽的 JPEG */
export const FRAME_INLINE_LIMIT = 4 * 1024 * 1024;
export async function shrinkImage(buf: Buffer): Promise<Buffer | null> {
  if (!hasFfmpeg()) return null;
  const dir = mkdtempSync(join(tmpdir(), 'findai-img-'));
  try {
    const src = join(dir, 'in'), out = join(dir, 'out.jpg');
    writeFileSync(src, buf);
    await run(['-i', src, '-vf', "scale='min(1280,iw)':-2", '-q:v', '4', '-frames:v', '1', out]);
    const r = readFileSync(out);
    return r.length <= FRAME_INLINE_LIMIT ? r : null;
  } catch { return null; } finally { rmSync(dir, { recursive: true, force: true }); }
}
