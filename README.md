# weixin-cursor-bridge

微信当输入框，本机 [Cursor CLI](https://cursor.com/docs/cli/headless) 当工人。普通消息只进草稿；单独一条 `。。` 才真正发给 `agent`；`。。，` 关闭当前会话。

走腾讯官方 iLink（`ilinkai.weixin.qq.com`），不依赖 OpenClaw。需要 Node 22+ 与已登录的本机 `agent`。

## 协议

| 整条 trim 后 | 动作 |
|---|---|
| `。。` | 提交当前草稿。空草稿则拒绝 |
| `。。，` | 杀掉在跑的 agent，丢掉 session，清空草稿 |
| 其它 | 追加草稿 |

回选项：先发 `2` 进草稿，再发 `。。`。`等一下。`、`。。。`、`。。选2` 都只当草稿。

## 使用

```bash
cp .env.example .env
# 按需改 CURSOR_WORKSPACE / CURSOR_CLI_PATH / WEIXIN_ALLOW_FROM
npm install
npm run dev
```

终端出二维码，微信扫码。凭证在 `data/credentials.json`（已 gitignore）。

本机先执行过 `agent login`，或设置 `CURSOR_API_KEY`。

```bash
npm test
npm run logout   # 清凭证，下次重新扫码
```

## 配置

见 `.env.example`。`WEIXIN_ALLOW_FROM` 为空时：优先绑定扫码用户；否则绑定第一条入站消息的发送者，之后拒绝其他人。

`--force --trust` 会让 Cursor 在无人值守下改文件、跑命令。只给自己的微信号用。

## 计划任务

复制 `jobs.example.yaml` 为 `jobs.yaml`（已 gitignore）并填 `notifyUser`。无该文件时只做交互。

到点且 agent 空闲时，用独立 session `jobs.<id>` 跑 backend `.cursor/skills-wcb/<skill>`，微信推摘要；细节写 skill 的 `output/`。忙则跳过本 tick。推送后把当前微信 session 指到该任务，可用 `。。` 续问。无 `context_token` 只打日志。

## 合规

使用[腾讯官方 iLink Bot API](https://github.com/Tencent/openclaw-weixin)。不要提交 `.env` 或 `data/`。
