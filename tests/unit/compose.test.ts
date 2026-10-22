// 合成整条视频：用 ffmpeg 现场造两段不同尺寸的测试视频，经本地 HTTP 下载、统一尺寸、烧字幕、拼接。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { composeVideo, frameSize, hasFfmpeg, wrapLine } from '../../src/server/compose.ts';

const dir = mkdtempSync(join(tmpdir(), 'findai-cmp-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('尺寸换算与字幕折行', () => {
  assert.deepEqual(frameSize('9:16', '1080p'), [1080, 1920]);
  assert.deepEqual(frameSize('16:9', '720p'), [1280, 720]);
  assert.deepEqual(frameSize('3:4', '480p'), [480, 640]);
  assert.deepEqual(frameSize('1:1', '1080p'), [1080, 1080]);
  assert.equal(wrapLine('一二三四五六七', 3), '一二三\n四五六\n七');
  assert.equal(wrapLine('a'.repeat(100), 10).split('\n').length, 3, '最多三行');
});

test('下载两镜 → 统一成 9:16 480p → 烧字幕 → 拼成一条', { skip: !hasFfmpeg() && '没有 ffmpeg' }, async () => {
  const mk = (name: string, size: string, sec: number) => {
    const f = join(dir, name);
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=25:duration=${sec}`, '-pix_fmt', 'yuv420p', f]);
    assert.equal(r.status, 0, String(r.stderr));
    return f;
  };
  const files = [mk('a.mp4', '640x360', 1), mk('b.mp4', '360x640', 2)];
  const srv = createServer((q, s) => { const i = Number(q.url!.slice(1)); if (!files[i]) { s.writeHead(404).end(); return; } s.writeHead(200, { 'content-type': 'video/mp4' }).end(readFileSync(files[i])); });
  await new Promise<void>(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    const out = join(dir, 'out', 'final.mp4');
    await composeVideo({ urls: [`${base}/0`, `${base}/1`], lines: ['第一镜：玄关十秒归位', '第二镜：岩板台面'], ratio: '9:16', res: '480p', outFile: out });
    assert.ok(existsSync(out));
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', out]);
    const info = JSON.parse(String(probe.stdout));
    assert.equal(info.streams[0].width, 480); assert.equal(info.streams[0].height, 854);
    assert.ok(Math.abs(Number(info.format.duration) - 3) < 0.3, `时长 ${info.format.duration}`);
    await assert.rejects(composeVideo({ urls: [`${base}/9`], lines: [''], ratio: '9:16', res: '480p', outFile: join(dir, 'x.mp4') }), /下载第 1 镜失败/);
  } finally { srv.close(); }
});
