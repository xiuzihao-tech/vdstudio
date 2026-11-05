// 在线支付：微信支付（Native 扫码，APIv3）、支付宝（当面付扫码 alipay.trade.precreate）。
// 配了哪个就开哪个；一个都没配时用「模拟支付」（演示和本地开发，点一下就算付了）。上线时两种真实渠道至少配一个，模拟支付会自动关掉。
// 环境变量：
//   微信：WXPAY_MCHID、WXPAY_APPID、WXPAY_SERIAL_NO（商户证书序列号）、WXPAY_PRIVATE_KEY（商户私钥 PEM，或 WXPAY_PRIVATE_KEY_FILE）、
//         WXPAY_API_V3_KEY（32 位）、WXPAY_PLATFORM_PUBLIC_KEY（微信支付公钥 PEM，或 _FILE）、WXPAY_PLATFORM_KEY_ID（公钥 ID，可选）
//   支付宝：ALIPAY_APP_ID、ALIPAY_PRIVATE_KEY（应用私钥 PEM，或 _FILE）、ALIPAY_PUBLIC_KEY（支付宝公钥 PEM，或 _FILE）、ALIPAY_GATEWAY（默认正式环境）
//   公共：PUBLIC_BASE_URL（回调地址用，必须是公网 https）、PAY_MOCK=1 强制打开模拟支付（只在测试环境用）
import { readFileSync } from 'node:fs';
import { makeWechatPay, type WechatPayConfig } from './wechat.ts';
import { makeAlipay, type AlipayConfig } from './alipay.ts';
import type { PayChannel } from '../../shared/billing.ts';

export interface PayOrderInput { id: string; amount: number; title: string }
export interface PayCreated { /** 扫码内容（微信 code_url / 支付宝 qr_code） */ qr: string }
/** 回调或查单的结果：已付款才返回 */
export interface PaidInfo { orderId: string; tradeNo: string; amount: number }
export interface PayProvider {
  channel: PayChannel;
  create(o: PayOrderInput): Promise<PayCreated>;
  /** 主动查单（回调没到时兜底）：已付返回 PaidInfo，没付返回 null */
  query(orderId: string): Promise<PaidInfo | null>;
  /** 验签并解析回调；验签失败抛错。非「支付成功」的通知返回 null */
  notify(headers: Record<string, string | string[] | undefined>, raw: string): Promise<PaidInfo | null>;
  /** 回调处理成功后给平台的响应 */
  ack: { status: number; body: string; type: string };
}

const pem = (env: NodeJS.ProcessEnv, k: string) => {
  const v = env[k] || (env[`${k}_FILE`] ? readFileSync(env[`${k}_FILE`]!, 'utf8') : '');
  return v.replace(/\\n/g, '\n').trim();
};

export interface PayInfo { channels: PayChannel[]; mock: boolean }
export function loadPay(env: NodeJS.ProcessEnv = process.env, publicBaseUrl?: string): { providers: Partial<Record<PayChannel, PayProvider>>; info: PayInfo } {
  const out: Partial<Record<PayChannel, PayProvider>> = {};
  const base = (publicBaseUrl ?? env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  if (env.WXPAY_MCHID && env.WXPAY_APPID) {
    const c: WechatPayConfig = {
      mchid: env.WXPAY_MCHID, appid: env.WXPAY_APPID, serialNo: env.WXPAY_SERIAL_NO ?? '', privateKey: pem(env, 'WXPAY_PRIVATE_KEY'),
      apiV3Key: env.WXPAY_API_V3_KEY ?? '', platformPublicKey: pem(env, 'WXPAY_PLATFORM_PUBLIC_KEY'), platformKeyId: env.WXPAY_PLATFORM_KEY_ID,
      notifyUrl: `${base}/api/pay/notify/wechat`,
    };
    out.wechat = makeWechatPay(c);
  }
  if (env.ALIPAY_APP_ID) {
    const c: AlipayConfig = { appId: env.ALIPAY_APP_ID, privateKey: pem(env, 'ALIPAY_PRIVATE_KEY'), alipayPublicKey: pem(env, 'ALIPAY_PUBLIC_KEY'), gateway: env.ALIPAY_GATEWAY, notifyUrl: `${base}/api/pay/notify/alipay` };
    out.alipay = makeAlipay(c);
  }
  const mock = env.PAY_MOCK === '1' || (!out.wechat && !out.alipay && env.PAY_MOCK !== '0');
  if (mock) out.mock = mockPay();
  return { providers: out, info: { channels: (Object.keys(out) as PayChannel[]), mock } };
}

/** 模拟支付：二维码里是一串说明文字；付款走 /api/billing/orders/:id/mock-pay */
export function mockPay(): PayProvider {
  return {
    channel: 'mock',
    async create(o) { return { qr: `FINDAI-MOCK-PAY:${o.id}:${o.amount}` }; },
    async query() { return null; },
    async notify() { return null; },
    ack: { status: 200, body: 'ok', type: 'text/plain' },
  };
}
