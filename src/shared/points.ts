// 积分（点数）流水的类型：前台流水、后台统计、对账都按这个分。1 点≈1 秒成片。
export type LedgerKind =
  | 'recharge' | 'spend' | 'refund' | 'redeem' | 'admin' | 'order_refund'
  | 'gift_signup' | 'gift_invite' | 'gift_invited' | 'gift_rebate' | 'gift_first' | 'gift_share' | 'revoke' | 'other';

export const KIND_NAME: Record<LedgerKind, string> = {
  recharge: '充值', spend: '消耗', refund: '失败退回', redeem: '兑换码', admin: '管理员调整', order_refund: '退款扣回',
  gift_signup: '注册赠送', gift_invite: '邀请好友', gift_invited: '受邀注册', gift_rebate: '好友充值返点', gift_first: '首充奖励', gift_share: '分享奖励',
  revoke: '奖励收回', other: '其他',
};
/** 算「赠送」的几类（统计发放、对账时和真金白银分开） */
export const GIFT_KINDS: LedgerKind[] = ['gift_signup', 'gift_invite', 'gift_invited', 'gift_rebate', 'gift_first', 'gift_share'];

export interface LedgerItem { delta: number; reason: string; kind: LedgerKind; createdAt: string }
