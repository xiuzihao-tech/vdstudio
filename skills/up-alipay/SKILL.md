---
id: up-alipay
name: 支付宝
category: upstream
version: 1.0.0
order: 56
summary: 当面付扫码（alipay.trade.precreate，RSA2）：充值点数、诊断 ¥899
---

# 支付宝（当面付扫码）

**接口约定**
- 下单：网关 `alipay.trade.precreate`，返回 `qr_code`
- 签名：参数按 key 排序拼成 k=v&k=v，应用私钥 RSA2；回调去掉 sign、sign_type 后用支付宝公钥验签，成功回纯文本 success
- 回调：`{公网地址}/api/pay/notify/alipay`；查单兜底用 `alipay.trade.query`

**要准备**：开放平台应用（开通当面付）、应用私钥、支付宝公钥。沙箱网关：https://openapi-sandbox.dl.alipaydev.com/gateway.do

**测试连接**：查一个不存在的订单，返回「交易不存在」就说明签名对。
