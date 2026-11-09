// 支付宝 · 当面付扫码（alipay.trade.precreate），RSA2 签名，openapi 网关 v1 协议。
// 下单：POST 网关，公共参数 + biz_content，返回 alipay_trade_precreate_response.qr_code。
// 签名：参数按 key 排序、去掉 sign 和空值，拼成 k=v&k=v，应用私钥 SHA256withRSA。
// 回调：x-www-form-urlencoded；去掉 sign、sign_type 后排序拼接，用支付宝公钥验签；成功后回纯文本 success。
// 查单：alipay.trade.query。
import { createSign, createVerify } from 'node:crypto';
import { yuanStr } from '../../shared/billing.ts';
import type { PaidInfo, PayProvider } from './index.ts';

export interface AlipayConfig { appId: string; privateKey: string; alipayPublicKey: string; notifyUrl: string; gateway?: string; fetch?: typeof fetch }

export const alipayContent = (p: Record<string, string>, drop: string[] = ['sign']) =>
  Object.keys(p).filter(k => !drop.includes(k) && p[k] !== '' && p[k] !== undefined && p[k] !== null).sort().map(k => `${k}=${p[k]}`).join('&');
export const alipaySign = (privateKey: string, p: Record<string, string>) => createSign('RSA-SHA256').update(alipayContent(p), 'utf8').sign(privateKey, 'base64');
export const alipayVerify = (publicKey: string, p: Record<string, string>) => { try { return createVerify('RSA-SHA256').update(alipayContent(p, ['sign', 'sign_type']), 'utf8').verify(publicKey, p.sign ?? '', 'base64'); } catch { return false; } };

/** 北京时间 yyyy-MM-dd HH:mm:ss */
const bjTime = (d = new Date()) => new Date(d.getTime() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);

export function makeAlipay(c: AlipayConfig): PayProvider {
  const gw = c.gateway || 'https://openapi.alipay.com/gateway.do', f = c.fetch ?? fetch;
  async function call(method: string, biz: Record<string, unknown>, notify = false) {
    const p: Record<string, string> = { app_id: c.appId, method, format: 'JSON', charset: 'utf-8', sign_type: 'RSA2', timestamp: bjTime(), version: '1.0', biz_content: JSON.stringify(biz), ...(notify ? { notify_url: c.notifyUrl } : {}) };
    p.sign = alipaySign(c.privateKey, p);
    const res = await f(gw, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: new URLSearchParams(p).toString() });
    const j = await res.json().catch(() => ({})) as Record<string, Record<string, string> | undefined>;
    return j[`${method.replace(/\./g, '_')}_response`] ?? {};
  }
  return {
    channel: 'alipay',
    async create(o) {
      const r = await call('alipay.trade.precreate', { out_trade_no: o.id, total_amount: yuanStr(o.amount), subject: o.title.slice(0, 120) }, true);
      if (r.code !== '10000' || !r.qr_code) throw new Error(`支付宝下单失败：${r.sub_msg || r.msg || '未知错误'}`);
      return { qr: r.qr_code };
    },
    async query(orderId) {
      const r = await call('alipay.trade.query', { out_trade_no: orderId });
      if (r.code !== '10000' || !['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(r.trade_status)) return null;
      return { orderId, tradeNo: r.trade_no ?? '', amount: Math.round(Number(r.total_amount) * 100) };
    },
    async notify(_h, raw): Promise<PaidInfo | null> {
      const p = Object.fromEntries(new URLSearchParams(raw));
      if (!alipayVerify(c.alipayPublicKey, p)) throw new Error('回调验签失败');
      if (p.app_id && p.app_id !== c.appId) throw new Error('应用 ID 不对');
      if (!['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(p.trade_status)) return null;
      return { orderId: p.out_trade_no, tradeNo: p.trade_no, amount: Math.round(Number(p.total_amount) * 100) };
    },
    ack: { status: 200, body: 'success', type: 'text/plain' },
    async ping() {
      const r = await call('alipay.trade.query', { out_trade_no: `FINDAI_PING_${Date.now()}` });
      if (r.sub_code === 'ACQ.TRADE_NOT_EXIST' || r.code === '10000') return { ok: true, message: '签名、应用 ID 都对（查了个不存在的订单）' };
      return { ok: false, message: `${r.code ?? ''} ${r.sub_code ?? ''} ${r.sub_msg ?? r.msg ?? ''}`.trim() || '没有返回' };
    },
  };
}
