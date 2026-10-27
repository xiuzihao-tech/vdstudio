// 合成整条视频：把各镜视频下载下来，统一尺寸和帧率，烧上字幕，拼成一条 mp4 存到自己的存储。
// 依赖系统里的 ffmpeg；字体需要支持中文（Docker 镜像里装了 Noto CJK）。音频（配音、配乐）留到 TTS 接入后再混。
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
  if (ffmpegOk === null) ffmpegOk = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
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

export interface ComposeInput { urls: string[]; lines: string[]; /** 每镜保留的秒数（生成时向上取整，合成时裁掉多余的） */ durs?: number[]; ratio: string; res: string; outFile: string; font?: string | null; subtitles?: boolean; fetch?: typeof fetch }

export async function composeVideo(o: ComposeInput): Promise<void> {
  if (!o.urls.length) throw new Error('没有可合成的镜头');
  const dir = mkdtempSync(join(tmpdir(), 'findai-compose-'));
  const f = o.fetch ?? fetch;
  try {
    const [w, h] = frameSize(o.ratio, o.res);
    const font = o.subtitles === false ? null : findFont(o.font ?? undefined);
    const fontSize = Math.round(Math.min(w, h) * 0.05);
    const segs: string[] = [];
    for (let i = 0; i < o.urls.length; i++) {
      // 输入可以是网址（中转站的视频链接）或本机文件路径（已转存的片段）
      let src = o.urls[i];
      if (/^https?:\/\//.test(src)) {
        const res = await f(src);
        if (!res.ok) throw new Error(`下载第 ${i + 1} 镜失败（${res.status}）`);
        src = join(dir, `src${i}.mp4`);
        writeFileSync(src, Buffer.from(await res.arrayBuffer()));
      }
      const vf = [`scale=${w}:${h}:force_original_aspect_ratio=decrease`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`, 'setsar=1', 'fps=30'];
      const line = (o.lines[i] ?? '').trim();
      if (font && line) {
        const txt = join(dir, `t${i}.txt`);
        writeFileSync(txt, wrapLine(line, Math.max(8, Math.floor((w * 0.86) / fontSize))));
        const esc = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
        vf.push(`drawtext=fontfile='${esc(font)}':textfile='${esc(txt)}':fontsize=${fontSize}:fontcolor=white:line_spacing=${Math.round(fontSize * 0.3)}:borderw=${Math.max(2, Math.round(fontSize / 12))}:bordercolor=black@0.85:x=(w-text_w)/2:y=h-text_h-${Math.round(h * 0.12)}`);
      }
      const seg = join(dir, `seg${i}.mp4`);
      await run(['-i', src, ...(o.durs?.[i] ? ['-t', String(o.durs[i])] : []), '-vf', vf.join(','), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', seg]);
      segs.push(seg);
    }
    const list = join(dir, 'list.txt');
    writeFileSync(list, segs.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'));
    mkdirSync(dirname(o.outFile), { recursive: true });
    await run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', o.outFile]);
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
