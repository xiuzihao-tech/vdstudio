// 存储层：AWS 官方 SigV4 测试向量、本机存储、S3 兼容存储（假 S3 服务器）、路径安全。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { makeSigner } from '../../src/server/storage/s3.ts';
import { makeStorage, safeKey } from '../../src/server/storage/index.ts';

const AWS = { endpoint: 'https://s3.amazonaws.com', region: 'us-east-1', bucket: 'examplebucket', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
const AT = new Date('2013-05-24T00:00:00Z');

test('SigV4 签名链接与 AWS 文档示例一致', () => {
  const url = makeSigner(AWS).presign('test.txt', 86400, AT);
  assert.equal(new URL(url).searchParams.get('X-Amz-Signature'), 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
  assert.equal(new URL(url).host, 'examplebucket.s3.amazonaws.com');
});

test('SigV4 请求头签名与 AWS 文档示例一致（GET 带 Range）', () => {
  const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const { headers } = makeSigner(AWS).signHeaders('GET', 'test.txt', EMPTY, { range: 'bytes=0-9' }, AT);
  assert.match(headers.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
});

test('路径安全：不能跳出存储目录', () => {
  assert.equal(safeKey('/ws_1/a.mp4'), 'ws_1/a.mp4');
  for (const bad of ['../x', 'ws/../../x', '', 'a//b', './a']) assert.throws(() => safeKey(bad), /非法/);
});

const dirs: string[] = [];
after(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })));

test('本机存储：写、读、本地路径、删', async () => {
  const d = mkdtempSync(join(tmpdir(), 'st-')); dirs.push(d);
  const s = makeStorage({}, d);
  assert.equal(s.kind, 'local');
  await s.put('ws_1/a.mp4', Buffer.from('abc'), 'video/mp4');
  assert.equal((await s.get('ws_1/a.mp4'))!.toString(), 'abc');
  assert.ok(s.localPath!('ws_1/a.mp4')!.endsWith('ws_1/a.mp4'));
  await s.delete('ws_1/a.mp4');
  assert.equal(await s.get('ws_1/a.mp4'), null);
  assert.equal(s.localPath!('ws_1/a.mp4'), null);
});

test('S3 兼容存储：路径风格（MinIO）读写删、签名链接、CDN 地址、缺配置报错', async () => {
  const store = new Map<string, Buffer>();
  const auths: string[] = [];
  const srv = createServer((q, s) => {
    auths.push(String(q.headers.authorization ?? ''));
    const chunks: Buffer[] = [];
    q.on('data', c => chunks.push(c));
    q.on('end', () => {
      if (!/^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/oss-cn-hangzhou\/s3\/aws4_request, SignedHeaders=/.test(String(q.headers.authorization))) { s.writeHead(403).end('no sig'); return; }
      const k = q.url!;
      if (q.method === 'PUT') { store.set(k, Buffer.concat(chunks)); s.writeHead(200).end(); return; }
      if (q.method === 'GET') { const b = store.get(k); if (!b) { s.writeHead(404).end(); return; } s.writeHead(200).end(b); return; }
      if (q.method === 'DELETE') { store.delete(k); s.writeHead(204).end(); return; }
      s.writeHead(405).end();
    });
  });
  await new Promise<void>(r => srv.listen(0, r));
  try {
    const endpoint = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const env = { STORAGE: 's3', S3_ENDPOINT: endpoint, S3_REGION: 'oss-cn-hangzhou', S3_BUCKET: 'findai', S3_ACCESS_KEY_ID: 'AK', S3_SECRET_ACCESS_KEY: 'SK', S3_FORCE_PATH_STYLE: '1', S3_PREFIX: 'prod' };
    const s = makeStorage(env, '/nonexistent');
    assert.equal(s.kind, 's3');
    await s.put('ws_1/片段 1.mp4', Buffer.from('video'), 'video/mp4');
    assert.ok(store.has('/findai/prod/ws_1/%E7%89%87%E6%AE%B5%201.mp4'), [...store.keys()].join());
    assert.equal((await s.get('ws_1/片段 1.mp4'))!.toString(), 'video');
    assert.equal(await s.get('ws_1/none.mp4'), null);
    await s.delete('ws_1/片段 1.mp4');
    assert.equal(store.size, 0);
    const u = new URL(s.directUrl!('ws_1/a.mp4', 600));
    assert.equal(u.pathname, '/findai/prod/ws_1/a.mp4'); assert.equal(u.searchParams.get('X-Amz-Expires'), '600'); assert.ok(u.searchParams.get('X-Amz-Signature'));
    const cdn = makeStorage({ ...env, S3_PUBLIC_BASE_URL: 'https://cdn.example.com/' }, '/x');
    assert.equal(cdn.directUrl!('ws_1/a.mp4'), 'https://cdn.example.com/prod/ws_1/a.mp4');
    assert.throws(() => makeStorage({ STORAGE: 's3', S3_ENDPOINT: endpoint }, '/x'), /缺少：S3_BUCKET、S3_ACCESS_KEY_ID、S3_SECRET_ACCESS_KEY/);
  } finally { srv.close(); }
});
