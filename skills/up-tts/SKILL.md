---
id: up-tts
name: 配音 · MiniMax
category: upstream
version: 1.0.0
order: 54
summary: 把台词合成成语音；视频是真实服务但没配配音时，成片不带配音
---

# 配音 · MiniMax

**接口**：`POST {接口地址}/t2a_v2`，`model`、`voice_setting.voice_id`。p1 / p2 是出片时「AI 配音·沉稳男声 / 知性女声」对应的音色 id。

**测试连接**：查一下可用音色（`/get_voice`），不花钱。
