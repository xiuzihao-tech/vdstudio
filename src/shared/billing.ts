// 充值和支付：点数套餐、订单状态、金额换算。前后端共用；套餐和诊断价格后台能改（存在 settings 的 billing 里）。
// 1 点 ≈ 1 秒成片。默认 ¥1 = 10 点，套餐越大送得越多。价格是占位，按方舟实际计费和毛利再定。

export type PayChannel = 'wechat' | 'alipay' | 'mock';
export type OrderStatus = 'pending' | 'paid' | 'closed' | 'refunded';
export type Product = 'points' | 'diag';

export interface Package {
  id: string; n: string;
  /** 价格（分） */ price: number;
  /** 买到的点数（不含赠送） */ points: number;
  /** 赠送点数 */ bonus: number;
  tag?: string;
}
export interface BillingConfig { packages: Package[]; /** 大哲诊断账号解锁价（分） */ diagPrice: number }

export const DEFAULT_BILLING: BillingConfig = {
  packages: [
    { id: 'p20', n: '体验包', price: 1990, points: 200, bonus: 0 },
    { id: 'p99', n: '常用包', price: 9900, points: 990, bonus: 110 },
    { id: 'p299', n: '进阶包', price: 29900, points: 2990, bonus: 510, tag: '推荐' },
    { id: 'p999', n: '专业包', price: 99900, points: 9990, bonus: 2510, tag: '最划算' },
  ],
  diagPrice: 89900,
};

export const yuan = (fen: number) => `¥${(fen / 100).toFixed(fen % 100 ? 2 : 0)}`;
/** 支付宝要的金额格式：12.30 */
export const yuanStr = (fen: number) => (fen / 100).toFixed(2);
export const totalPoints = (p: Package) => p.points + p.bonus;
export const CHANNEL_NAME: Record<PayChannel, string> = { wechat: '微信支付', alipay: '支付宝', mock: '模拟支付（演示）' };
export const STATUS_NAME: Record<OrderStatus, string> = { pending: '待支付', paid: '已支付', closed: '已关闭', refunded: '已退款' };
/** 订单多久没付就关掉（分钟） */
export const ORDER_TTL_MIN = 15;

export interface Order {
  id: string; product: Product; packageId: string | null; title: string;
  amount: number; points: number; channel: PayChannel; status: OrderStatus;
  tradeNo: string | null; createdAt: string; paidAt: string | null;
}

/** 后台改的套餐要过一遍：价格、点数都是正整数，id 不重复，至少一个 */
export function normalizeBilling(x: Partial<BillingConfig> | null | undefined): BillingConfig {
  const pk = (x?.packages ?? DEFAULT_BILLING.packages)
    .filter(p => p && p.id && p.n && Number.isInteger(p.price) && p.price > 0 && Number.isInteger(p.points) && p.points > 0)
    .map(p => ({ id: String(p.id).slice(0, 20), n: String(p.n).slice(0, 12), price: p.price, points: p.points, bonus: Math.max(0, Math.floor(p.bonus || 0)), ...(p.tag ? { tag: String(p.tag).slice(0, 6) } : {}) }));
  const uniq = pk.filter((p, i) => pk.findIndex(q => q.id === p.id) === i).slice(0, 8);
  const diag = Number.isInteger(x?.diagPrice) && x!.diagPrice! > 0 ? x!.diagPrice! : DEFAULT_BILLING.diagPrice;
  return { packages: uniq.length ? uniq : DEFAULT_BILLING.packages, diagPrice: diag };
}
