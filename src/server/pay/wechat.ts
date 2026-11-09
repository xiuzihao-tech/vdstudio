// 微信支付 APIv3 · Native 扫码支付。
// 下单：POST /v3/pay/transactions/native → { code_url }
// 签名：Authorization: WECHATPAY2-SHA256-RSA2048 mchid,nonce_str,signature,timestamp,serial_no；
//       待签串 = 方法\nURL(含查询串)\n时间戳\n随机串\n请求体\n，商户私钥 SHA256withRSA。
// 回调：验 Wechatpay-Signature（时间戳\n随机串\n报文\n，微信支付公钥），resource 用 APIv3 密钥 AES-256-GCM 解密。
// 查单：GET /v3/pay/transactions/out-trade-no/{单号}?mchid=…
import { createCipheriv, createDecipheriv, createSign, createVerify, randomBytes } from 'node:crypto';
import type { PaidInfo, PayProvider } from './index.ts';

export interface WechatPayConfig {
  mchid: string; appid: string; serialNo: string; privateKey: string; apiV3Key: string;
  platformPublicKey: string; platformKeyId?: string; notifyUrl: string;
  base?: string; fetch?: typeof fetch;
  /** 回调时间戳允许的偏差（秒），默认 5 分钟 */ skewSec?: number;
}

export const wxSign = (privateKey: string, msg: string) => createSign('RSA-SHA256').update(msg).sign(privateKey, 'base64');
export const wxVerify = (publicKey: string, msg: string, sig: string) => { try { return createVerify('RSA-SHA256').update(msg).verify(publicKey, sig, 'base64'); } catch { return false; } };

/** AEAD_AES_256_GCM 解密：密文最后 16 字节是认证标签 */
export function wxDecrypt(apiV3Key: string, r: { ciphertext: string; nonce: string; associated_data?: string }): string {
  const buf = Buffer.from(r.ciphertext, 'base64');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(r.nonce, 'utf8'));
  d.setAuthTag(buf.subarray(buf.length - 16));
  if (r.associated_data) d.setAAD(Buffer.from(r.associated_data, 'utf8'));
  return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8');
}
/** 测试用：按微信的格式加密一段回调 */
export function wxEncrypt(apiV3Key: string, plain: string, nonce: string, aad: string): string {
  const c = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(nonce, 'utf8'));
  c.setAAD(Buffer.from(aad, 'utf8'));
  return Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()]).toString('base64');
}

const h1 = (h: Record<string, string | string[] | undefined>, k: string) => { const v = h[k] ?? h[k.toLowerCase()]; return Array.isArray(v) ? v[0] : v; };

export function makeWechatPay(c: WechatPayConfig): PayProvider {
  const base = (c.base ?? 'https://api.mch.weixin.qq.com').replace(/\/$/, ''), f = c.fetch ?? fetch;
  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: T }> {
    const ts = Math.floor(Date.now() / 1000).toString(), nonce = randomBytes(16).toString('hex');
    const text = body === undefined ? '' : JSON.stringify(body);
    const sig = wxSign(c.privateKey, `${method}\n${path}\n${ts}\n${nonce}\n${text}\n`);
    const res = await f(base + path, {
      method, body: body === undefined ? undefined : text,
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'findai-studio',
        authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${c.mchid}",nonce_str="${nonce}",signature="${sig}",timestamp="${ts}",serial_no="${c.serialNo}"`,
        ...(c.platformKeyId ? { 'wechatpay-serial': c.platformKeyId } : {}) },
    });
    const json = await res.json().catch(() => ({})) as T;
    return { status: res.status, json };
  }
  return {
    channel: 'wechat',
    async create(o) {
      const r = await call<{ code_url?: string; message?: string }>('POST', '/v3/pay/transactions/native', {
        appid: c.appid, mchid: c.mchid, description: o.title.slice(0, 120), out_trade_no: o.id, notify_url: c.notifyUrl, amount: { total: o.amount, currency: 'CNY' },
      });
      if (r.status >= 300 || !r.json.code_url) throw new Error(`微信下单失败（${r.status}）${r.json.message ? `：${r.json.message}` : ''}`);
      return { qr: r.json.code_url };
    },
    async query(orderId) {
      const r = await call<{ trade_state?: string; transaction_id?: string; amount?: { total?: number } }>('GET', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderId)}?mchid=${c.mchid}`);
      if (r.json.trade_state !== 'SUCCESS') return null;
      return { orderId, tradeNo: r.json.transaction_id ?? '', amount: r.json.amount?.total ?? -1 };
    },
    async notify(headers, raw): Promise<PaidInfo | null> {
      const ts = h1(headers, 'wechatpay-timestamp') ?? '', nonce = h1(headers, 'wechatpay-nonce') ?? '', sig = h1(headers, 'wechatpay-signature') ?? '';
      if (Math.abs(Date.now() / 1000 - Number(ts)) > (c.skewSec ?? 300)) throw new Error('回调时间戳过期');
      if (!wxVerify(c.platformPublicKey, `${ts}\n${nonce}\n${raw}\n`, sig)) throw new Error('回调验签失败');
      const body = JSON.parse(raw) as { event_type?: string; resource?: { ciphertext: string; nonce: string; associated_data?: string } };
      if (!body.resource) return null;
      const t = JSON.parse(wxDecrypt(c.apiV3Key, body.resource)) as { out_trade_no: string; transaction_id: string; trade_state: string; mchid?: string; amount?: { total?: number } };
      if (t.trade_state !== 'SUCCESS') return null;
      if (t.mchid && t.mchid !== c.mchid) throw new Error('商户号不对');
      return { orderId: t.out_trade_no, tradeNo: t.transaction_id, amount: t.amount?.total ?? -1 };
    },
    ack: { status: 204, body: '', type: 'text/plain' },
    async ping() {
      const r = await call<{ code?: string; message?: string; trade_state?: string }>('GET', `/v3/pay/transactions/out-trade-no/FINDAI_PING_${Date.now()}?mchid=${c.mchid}`);
      if (r.status === 404 && r.json.code === 'ORDER_NOT_EXIST') return { ok: true, message: '签名、商户号都对（查了个不存在的订单）' };
      if (r.status < 300) return { ok: true, message: '接通了' };
      return { ok: false, message: `${r.status} ${r.json.code ?? ''} ${r.json.message ?? ''}`.trim() };
    },
  };
}
