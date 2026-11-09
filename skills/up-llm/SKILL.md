---
id: up-llm
name: 文案大模型
category: upstream
version: 1.0.0
order: 50
summary: 兼容 OpenAI Chat Completions 的大模型（豆包 / 方舟、DeepSeek、通义、OpenAI…），所有 AI 技能都用它
---

# 文案大模型

**用在**：所有 AI 技能（诊断深聊、出诊断、排选题、AI 建议、分镜、发布包装、文案写手）。不配就全部走规则 / 模拟结果。

**接口约定**：`POST {接口地址}/chat/completions`，`Authorization: Bearer {API Key}`，请求带 `response_format: {type: "json_object"}`（不支持的网关会自动去掉重试）。主模型出错（5xx、模型不存在、限流、超时）时依次换「精写模型 → 默认模型 → 备用模型」。

**测试连接**：发一句「只回复 ok」，看能不能在超时内返回。

**去哪拿**：火山方舟控制台 → API Key；或 DeepSeek / 通义开放平台。接口地址填到 `/api/v3` 或 `/v1` 为止。
