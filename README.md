# weixin-cursor-bridge

微信当输入框，本机 [Cursor CLI](https://cursor.com/docs/cli/headless) 当工人。普通消息只进草稿（最多 100 条）；单独一条两个句号才发给 `agent`；两个句号加逗号关闭当前会话。中英文句号/逗号都可以。

走腾讯官方 iLink（`ilinkai.weixin.qq.com`），不依赖 OpenClaw。需要 Node 22+ 与已登录的本机 `agent`。

## 协议

| 整条 trim 后 | 动作 |
|---|---|
| `。。` 或 `..` | 提交当前草稿。空草稿则拒绝 |
| `。。，` 或 `..,`（中英文可混） | 杀掉在跑的 agent，丢掉 session，清空草稿 |
| 其它 | 追加草稿（满 100 条后拒绝，需先发送或关闭） |

回选项：先发 `2` 进草稿，再发两个句号。`等一下。`、`。。。`、`。。选2` 都只当草稿。

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

cron 命中则入队，同一时刻只跑一个 agent（交互与计划串行）；忙时排队，空闲后当天补跑。`skipHolidays` 跳法定假日（周末仍跑）。分类/翻译用日字段 `*/5`。任务 session 为 `jobs.<id>`；草稿为空才把当前微信 session 指过去。无 `context_token` 只打日志。

## 合规

使用[腾讯官方 iLink Bot API](https://github.com/Tencent/openclaw-weixin)。不要提交 `.env` 或 `data/`。
