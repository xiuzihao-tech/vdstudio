// 充值和支付：微信 / 支付宝的签名、验签、回调解密；下单 → 到账只加一次点数；金额对不上不入账；诊断解锁；
// Seedance 2.5 样片模式：样片带 draft:true，成片用 draft_task 续出；一键生成视频先样片后成片、按页面价格扣点。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/server/app.ts';
import { makeWechatPay, wxDecrypt, wxEncrypt, wxSign, wxVerify } from '../../src/server/pay/wechat.ts';
import { alipayContent, alipaySign, alipayVerify, makeAlipay } from '../../src/server/pay/alipay.ts';
import { makeSeedance } from '../../src/server/providers/seedance.ts';
import { DEFAULT_BILLING, normalizeBilling, totalPoints } from '../../src/shared/billing.ts';
import { buildShots, costOf, newDraft, sampleCost, toGen } from '../../src/shared/studio.ts';
process.env.MOCK_DELAY_MS = '0';

const kp = () => generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const mch = kp(), wxPlat = kp(), aliApp = kp(), aliPlat = kp();
const V3 = randomBytes(16).toString('hex'); // 32 个字符

test('套餐：默认四档，后台改坏了会被兜住', () => {
  assert.equal(DEFAULT_BILLING.packages.length, 4);
  assert.equal(totalPoints(DEFAULT_BILLING.packages[2]), 3500);
  const n = normalizeBilling({ packages: [{ id: 'a', n: '坏', price: -1, points: 10, bonus: 0 }, { id: 'b', n: '好', price: 100, points: 10, bonus: 2 }, { id: 'b', n: '重', price: 100, points: 10, bonus: 0 }], diagPrice: 0 });
  assert.deepEqual(n.packages.map(p => p.id), ['b']);
  assert.equal(n.diagPrice, DEFAULT_BILLING.diagPrice);
});

test('微信支付：签名能验、回调能解密，改一个字就验不过', () => {
  const sig = wxSign(mch.privateKey, 'POST\n/v3/pay\n1\nabc\n{}\n');
  assert.ok(wxVerify(mch.publicKey, 'POST\n/v3/pay\n1\nabc\n{}\n', sig));
  assert.ok(!wxVerify(mch.publicKey, 'POST\n/v3/pay\n1\nabd\n{}\n', sig));
  const ct = wxEncrypt(V3, '{"a":1}', 'abcdefghijkl', 'transaction');
  assert.equal(wxDecrypt(V3, { ciphertext: ct, nonce: 'abcdefghijkl', associated_data: 'transaction' }), '{"a":1}');
  assert.throws(() => wxDecrypt(V3, { ciphertext: ct, nonce: 'abcdefghijkl', associated_data: 'refund' }));
});

test('微信支付：Native 下单带签名头、金额按分', async () => {
  let got: { url: string; init: RequestInit } | null = null;
  const wx = makeWechatPay({ mchid: 'm1', appid: 'wx1', serialNo: 'S1', privateKey: mch.privateKey, apiV3Key: V3, platformPublicKey: wxPlat.publicKey, notifyUrl: 'https://x/notify',
    fetch: (async (url: string, init: RequestInit) => { got = { url, init }; return new Response(JSON.stringify({ code_url: 'weixin://wxpay/bizpayurl?pr=abc' }), { status: 200 }); }) as typeof fetch });
  const r = await wx.create({ id: 'ord_1', amount: 9900, title: '常用包' });
  assert.equal(r.qr, 'weixin://wxpay/bizpayurl?pr=abc');
  assert.match(got!.url, /\/v3\/pay\/transactions\/native$/);
  const auth = (got!.init.headers as Record<string, string>).authorization;
  assert.match(auth, /^WECHATPAY2-SHA256-RSA2048 mchid="m1",nonce_str="\w+",signature="[^"]+",timestamp="\d+",serial_no="S1"$/);
  const body = JSON.parse(String(got!.init.body));
  assert.deepEqual(body.amount, { total: 9900, currency: 'CNY' });
  const [, nonce, , ts] = auth.match(/nonce_str="(\w+)",signature="([^"]+)",timestamp="(\d+)"/)!;
  const sig = auth.match(/signature="([^"]+)"/)![1];
  assert.ok(wxVerify(mch.publicKey, `POST\n/v3/pay/transactions/native\n${ts}\n${nonce}\n${got!.init.body}\n`, sig), '签名用商户私钥签的');
});

test('支付宝：参数排序拼接、RSA2 签名验签；当面付下单拿到二维码', async () => {
  assert.equal(alipayContent({ b: '2', a: '1', sign: 'x', e: '' }), 'a=1&b=2');
  const p = { app_id: 'A1', out_trade_no: 'ord_1', total_amount: '99.00', trade_status: 'TRADE_SUCCESS', sign_type: 'RSA2' };
  const signed = { ...p, sign: alipaySign(aliPlat.privateKey, p) };
  // 回调里 sign_type 不参与验签
  const v = { ...p, sign: createSigWithout(aliPlat.privateKey, p) };
  assert.ok(alipayVerify(aliPlat.publicKey, v));
  assert.ok(!alipayVerify(aliPlat.publicKey, { ...v, total_amount: '0.01' }));
  void signed;
  let sent = '';
  const ali = makeAlipay({ appId: 'A1', privateKey: aliApp.privateKey, alipayPublicKey: aliPlat.publicKey, notifyUrl: 'https://x/n',
    fetch: (async (_u: string, init: RequestInit) => { sent = String(init.body); return new Response(JSON.stringify({ alipay_trade_precreate_response: { code: '10000', qr_code: 'https://qr.alipay.com/abc' } })); }) as typeof fetch });
  assert.equal((await ali.create({ id: 'ord_2', amount: 1990, title: '体验包' })).qr, 'https://qr.alipay.com/abc');
  const q = Object.fromEntries(new URLSearchParams(sent));
  assert.equal(JSON.parse(q.biz_content).total_amount, '19.90');
  const { sign: qs, ...unsigned } = q;
  assert.equal(alipaySign(aliApp.privateKey, unsigned), qs, '请求用应用私钥签名（sign_type 也参与）');
});
function createSigWithout(key: string, p: Record<string, string>) { const { sign_type: _t, ...rest } = p; return alipaySign(key, rest); }

test('Seedance 2.5 样片模式：样片 draft:true + 480p；成片只带 draft_task 和 1080p', async () => {
  const bodies: any[] = [];
  const sd = makeSeedance({ apiKey: 'k', baseUrl: 'https://ark', models: { s25: 'doubao-seedance-2-5' }, pollMs: 1,
    fetch: (async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ id: `cgt-${bodies.length}` })); }
      return new Response(JSON.stringify({ status: 'succeeded', content: { video_url: `https://v/${url.split('/').pop()}.mp4` } }));
    }) as typeof fetch });
  const g = { model: 's25', draft: true, res: '1080p', ratio: '9:16', prompt: '', style: 'AI 推荐', type: 'talk' } as any;
  const shots = [{ dur: 5, line: '第一句', k: 'live', generated: true }, { dur: 6, line: '第二句', k: 'kit', generated: true }] as any;
  await sd.run({ settings: g, shots, final: false, frames: [null, null] }, () => {});
  assert.equal(bodies[0].draft, true); assert.equal(bodies[0].resolution, '480p');
  bodies.length = 0;
  await sd.run({ settings: g, shots, final: true, frames: [null, null], drafts: ['cgt-1', 'cgt-2'] }, () => {});
  assert.deepEqual(bodies[0].content, [{ type: 'draft_task', draft_task: { id: 'cgt-1' } }]);
  assert.equal(bodies[0].resolution, '1080p'); assert.equal(bodies[0].draft, undefined); assert.equal(bodies[0].duration, undefined);
  bodies.length = 0;
  await sd.run({ settings: g, shots, final: true, frames: [null, null] }, () => {});
  assert.equal(bodies[0].resolution, '1080p', '没有样片就照常出 1080p'); assert.equal(bodies[0].draft, undefined);
});

test('一键生成视频 → 生成设置：你的照片做首帧、视频用原片、没建形象的数字人镜头交给 AI', () => {
  const d = newDraft('2026-11-04T00:00:00Z');
  const mats = [{ id: 'a1', name: '客厅', kind: 'photo' as const, k: 'live' }, { id: 'a2', name: '走动', kind: 'video' as const, k: 'kit' }];
  const shots = buildShots({ mats, copy: '第一句话说一个细节。第二句话讲另一个地方。第三句说做法。最后一句评论区扣1。', type: 'talk', face: 'avatar' }, 38);
  const g = toGen({ ...d, mats, shots, type: 'talk', face: 'avatar', avatar: 'me-clone' }, { voiceReady: false, avatars: { clone: 'none', photo: 'none' } }, true);
  assert.equal(g.model, 's25'); assert.equal(g.draft, true);
  assert.deepEqual(g.shots.slice(0, 2).map(s => s.source), ['frame', 'clip']);
  assert.ok(shots[shots.length - 1].avatar); assert.equal(g.shots[g.shots.length - 1].source, 'ai');
  assert.equal(g.avatar, 'none'); assert.equal(g.voice, 'p1');
  const g2 = toGen({ ...d, mats, shots, type: 'talk', face: 'avatar', avatar: 'me-clone' }, { voiceReady: true, avatars: { clone: 'ready', photo: 'none' } }, false);
  assert.equal(g2.shots[g2.shots.length - 1].source, 'avatar'); assert.equal(g2.avatar, 'clone'); assert.equal(g2.voice, 'me'); assert.equal(g2.draft, false);
  assert.equal(sampleCost(costOf('talk', 'AI 推荐')), 25);
});

/* ---------- 接口：下单、回调、到账 ---------- */
const dir = mkdtempSync(join(tmpdir(), 'findai-pay-'));
const app = createApp({ dbFile: ':memory:', dataDir: dir, webDir: dir, modulesPreset: 'all', initialPoints: 100, env: {
  PAY_MOCK: '1', PUBLIC_BASE_URL: 'https://studio.example.com',
  WXPAY_MCHID: 'm1', WXPAY_APPID: 'wx1', WXPAY_SERIAL_NO: 'S1', WXPAY_PRIVATE_KEY: mch.privateKey, WXPAY_API_V3_KEY: V3, WXPAY_PLATFORM_PUBLIC_KEY: wxPlat.publicKey,
  ALIPAY_APP_ID: 'A1', ALIPAY_PRIVATE_KEY: aliApp.privateKey, ALIPAY_PUBLIC_KEY: aliPlat.publicKey,
} });
let base = '';
before(async () => { await new Promise<void>(r => app.server.listen(0, r)); base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`; });
after(() => { app.server.close(); rmSync(dir, { recursive: true, force: true }); });
function client() {
  let cookie = '';
  return async (method: string, path: string, data?: unknown) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: data === undefined ? undefined : JSON.stringify(data) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => null) as any };
  };
}
const u = client();
const wxNotify = (orderId: string, total: number, opts: { badSig?: boolean } = {}) => {
  const plain = JSON.stringify({ out_trade_no: orderId, transaction_id: `42000${Date.now()}`, trade_state: 'SUCCESS', mchid: 'm1', amount: { total, payer_total: total } });
  const nonce = 'n0nce1234567', body = JSON.stringify({ event_type: 'TRANSACTION.SUCCESS', resource: { algorithm: 'AEAD_AES_256_GCM', ciphertext: wxEncrypt(V3, plain, nonce, 'transaction'), nonce, associated_data: 'transaction' } });
  const ts = String(Math.floor(Date.now() / 1000)), hn = 'abc123';
  const sig = wxSign(opts.badSig ? mch.privateKey : wxPlat.privateKey, `${ts}\n${hn}\n${body}\n`);
  return fetch(`${base}/api/pay/notify/wechat`, { method: 'POST', headers: { 'content-type': 'application/json', 'wechatpay-timestamp': ts, 'wechatpay-nonce': hn, 'wechatpay-signature': sig, 'wechatpay-serial': 'P1' }, body });
};

test('充值：三个渠道都开着；模拟付款到账；微信回调验签、只入账一次、金额不对拒绝', async () => {
  const b = await u('GET', '/api/billing');
  assert.deepEqual(b.json.channels.sort(), ['alipay', 'mock', 'wechat']);
  assert.equal(b.json.balance, 100);
  const o1 = await u('POST', '/api/billing/orders', { product: 'points', packageId: 'p20', channel: 'mock' });
  assert.equal(o1.status, 201); assert.match(o1.json.order.qr, /MOCK/); assert.equal(o1.json.order.points, 200);
  const paid = await u('POST', `/api/billing/orders/${o1.json.order.id}/mock-pay`);
  assert.equal(paid.json.order.status, 'paid'); assert.equal(paid.json.balance, 300);
  // 再付一次不会重复加
  await u('POST', `/api/billing/orders/${o1.json.order.id}/mock-pay`);
  assert.equal((await u('GET', '/api/billing')).json.balance, 300);

  const o2 = (await u('POST', '/api/billing/orders', { product: 'points', packageId: 'p99', channel: 'mock' })).json.order;
  assert.equal((await wxNotify(o2.id, 9900, { badSig: true })).status, 400, '签名不对拒绝');
  assert.equal((await wxNotify(o2.id, 1)).status, 400, '金额对不上拒绝');
  assert.equal((await u('GET', `/api/billing/orders/${o2.id}`)).json.order.status, 'pending');
  assert.equal((await wxNotify(o2.id, 9900)).status, 204);
  assert.equal((await wxNotify(o2.id, 9900)).status, 204, '平台重发也只回成功');
  const after2 = await u('GET', `/api/billing/orders/${o2.id}`);
  assert.equal(after2.json.order.status, 'paid'); assert.equal(after2.json.balance, 1400);
  const led = await u('GET', '/api/ledger');
  assert.equal(led.json.items.filter((x: any) => /充值/.test(x.reason)).length, 2);
});

test('支付宝回调：验签通过就到账，回 success', async () => {
  const o = (await u('POST', '/api/billing/orders', { product: 'points', packageId: 'p20', channel: 'mock' })).json.order;
  const p: Record<string, string> = { app_id: 'A1', out_trade_no: o.id, trade_no: '2026110422001', total_amount: '19.90', trade_status: 'TRADE_SUCCESS', notify_time: '2026-11-04 12:00:00' };
  const body = new URLSearchParams({ ...p, sign_type: 'RSA2', sign: alipaySign(aliPlat.privateKey, p) }).toString();
  const r = await fetch(`${base}/api/pay/notify/alipay`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  assert.equal(await r.text(), 'success');
  assert.equal((await u('GET', `/api/billing/orders/${o.id}`)).json.order.status, 'paid');
});

test('大哲诊断账号：付款后解锁，不加点数；解锁后不能再下单', async () => {
  const before = (await u('GET', '/api/billing')).json.balance;
  const o = (await u('POST', '/api/billing/orders', { product: 'diag', channel: 'mock' })).json.order;
  assert.equal(o.amount, 89900);
  await u('POST', `/api/billing/orders/${o.id}/mock-pay`);
  assert.equal((await u('GET', '/api/studio')).json.state.diag.unlocked, true);
  assert.equal((await u('GET', '/api/billing')).json.balance, before);
  assert.equal((await u('POST', '/api/billing/orders', { product: 'diag', channel: 'mock' })).status, 400);
  assert.equal((await u('PUT', '/api/studio', { diag: { unlocked: false } })).json.state.diag.unlocked, true, '不能自己改回去或者改成已解锁');
});

test('一键生成视频：先出样片（四成价）再出成片（沿用样片），余额不够返回 402', async () => {
  const shots = buildShots({ mats: [], copy: '这套房我最想让你看两个细节。整面墙没做造型。餐厨动线短了4米。评论区扣1。', type: 'talk', face: 'none' }, 38);
  const draft = { type: 'talk', face: 'none', avatar: 'lin', title: '测试一条', opt: { dur: 'AI 推荐', ratio: '9:16 竖屏', font: 'AI 推荐', bgm: 'AI 推荐', voice: 'AI 推荐' }, mats: [], shots };
  const bal0 = (await u('GET', '/api/billing')).json.balance;
  const s = await u('POST', '/api/studio/render', { draft, mode: 'sample' });
  assert.equal(s.status, 201, JSON.stringify(s.json)); assert.equal(s.json.cost, 25); assert.equal(s.json.balance, bal0 - 25);
  let job = s.json.job;
  for (let i = 0; i < 50 && job.status !== 'done' && job.status !== 'failed'; i++) { await new Promise(r => setTimeout(r, 30)); job = (await u('GET', `/api/jobs/${job.id}`)).json; }
  assert.equal(job.status, 'done'); assert.equal(job.output.draft, true); assert.equal(job.output.res, '480p');
  const f = await u('POST', '/api/studio/render', { draft, mode: 'final', fromJob: job.id });
  assert.equal(f.status, 201); assert.equal(f.json.cost, 60); assert.equal(f.json.job.kind, 'video_final');
  const poor = client();
  await poor('GET', '/api/session');
  assert.equal((await poor('POST', '/api/studio/render', { draft: { ...draft, type: 'before', opt: { ...draft.opt, dur: '60 秒' } }, mode: 'final' })).status, 402);
});
