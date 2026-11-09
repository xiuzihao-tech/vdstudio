---
id: up-wxpay
name: 微信支付
category: upstream
version: 1.0.0
order: 55
summary: Native 扫码支付（APIv3）：充值点数、诊断 ¥899
---

# 微信支付（Native，APIv3）

**接口约定**
- 下单：`POST /v3/pay/transactions/native`，返回 `code_url` 生成二维码
- 签名：`Authorization: WECHATPAY2-SHA256-RSA2048 …`，待签串「方法\nURL\n时间戳\n随机串\n报文\n」，商户私钥 SHA256withRSA
- 回调：`{公网地址}/api/pay/notify/wechat`，用微信支付公钥验签，APIv3 密钥 AES-256-GCM 解密；金额对不上不入账，同一笔只入账一次
- 查单兜底：回调没到时，页面轮询订单会主动查

**要准备**：商户号、绑定的 AppID（公众号 / 小程序）、商户 API 证书序列号和私钥、APIv3 密钥（32 位）、微信支付公钥和公钥 ID。服务器要配 `PUBLIC_BASE_URL`（https 公网地址）。

**测试连接**：查一个不存在的订单，返回「订单不存在」就说明签名和密钥都对。
