---
id: diag-agent
name: 大哲诊断 · 深聊
category: ai
version: 1.0.0
order: 10
uses: up-llm
summary: 一问一答，从回答里抓个性 / 专业 / 品牌三类标签；题目不限，用户说够了就结束
---
# 大哲诊断 · 深聊

**在哪用**：大哲诊断账号 → 解锁后的聊天页。每次用户发一句，服务端调这个技能决定「下一个问什么」。

**两种跑法**
- 接了大模型（上游接口「文案大模型」）且 `useLlm` 为 true：按 `prompt.md` 的 `system` + `next` 让模型追问，题库只当方向参考。模型出错或返回格式不对，自动退回题库。
- 没接大模型 / `useLlm` 为 false：按 `questions` 顺序一题一题问，问完再用 `more` 里的话收尾，每句前面随机接一句 `acks`。

**config.json 怎么改**
| 字段 | 说明 |
|---|---|
| `stages` | 四段的名字，顺序就是聊的顺序（页面顶上的步骤条也用它） |
| `welcome` | 第一条欢迎语 |
| `questions` | 题库：`stage` 是第几段（从 0 开始），`q` 是问题。苗苗给正式问题方向后直接换这里 |
| `more` | 题库问完后的追问 / 收尾话术，最后一句会一直重复 |
| `acks` | 接住上一句的短语，轮着用 |
| `minAnswers` | 至少回答几题才能「结束并生成诊断」 |
| `maxQuestions` | 最多问多少题（防止无限聊），到了就提示结束 |
| `demoName` / `demoAnswers` | 「一键演示」用的人和回答（默认盛哥 · 木里木外） |

**提示词变量**：`{{stages}}` 四段名、`{{questions}}` 题库、`{{transcript}}` 对话记录、`{{asked}}` 已问几题、`{{stage}}` / `{{stageName}}` 当前段。

**输出约定**（代码会校验）：`{"stage":0-3,"ack":"","question":"","done":false}`。
