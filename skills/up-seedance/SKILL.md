---
id: up-seedance
name: 视频 · 火山方舟 Seedance
category: upstream
version: 1.0.0
order: 52
summary: 直连方舟的 Seedance 视频生成，支持 2.5 样片模式（先出 480p 样片，满意后用样片任务续出 1080p）
---

# 视频 · 火山方舟 Seedance

**用在**：一键生成视频出样片 / 成片、旧版生成视频。

**接口约定**
- 创建：`POST {接口地址}/contents/generations/tasks`，`content` 里放文字提示（和首帧图），`resolution`、`ratio`、`duration`；样片加 `draft: true`（480p、更便宜）
- 出成片：`content: [{"type":"draft_task","draft_task":{"id":"样片任务 id"}}]` + `resolution: "1080p"`，画面沿用样片不重新抽卡；样片 7 天内有效
- 查询：`GET {接口地址}/contents/generations/tasks/{id}`，`status` 为 succeeded 时取 `content.video_url`

**档位模型**：s25 = Seedance 2.5（默认、支持样片模式），s20 / s20f = 2.0 / 2.0 fast。填方舟控制台里的模型 id 或推理接入点 id。

**测试连接**：列一下最近的任务（不花钱）。
