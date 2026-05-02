# Cloudflare Workers / Pages Functions 适配路线图

**当前状态：暂未支持。**

Cloudflare Workers 运行在 V8 isolate 上，**不是 Node.js 运行时**。缺失大量本项目依赖的核心模块：

| 项目当前依赖 | Workers 是否提供 |
|---|---|
| `http` / `https`（Node 内置） | ❌ |
| `stream`（Node Readable / Transform） | ⚠️ 仅部分 polyfill，行为不完全一致 |
| `fs` / `fs.promises` | ❌（持久化要换 KV / R2） |
| `Buffer` | ⚠️ 仅在 nodejs_compat flag 下有限支持 |
| Express 中间件链 | ❌（Express 依赖 `http.Server`） |
| `axios` 默认走 `http` adapter | ❌（需要切换到 fetch adapter） |
| Node SSE（手动 `res.write('data: ...')`） | ❌（要改 `ReadableStream`） |

## 要做哪些改动

按依赖深度从浅到深：

### 1. 网络层（必须）
- 把 `axios` 全部替换成 `fetch`，或者给 axios 显式指定 fetch adapter
- 上游 SSE 流：`response.body.getReader()` 取 chunk，不再用 `response.on('data')`
- 影响文件：`src/utils/request.js`、`src/utils/upload.js`、`src/models/models-map.js`、`src/utils/token-manager.js`、`src/routes/vercel.js`

### 2. 持久化层（必须）
- `DATA_SAVE_MODE=file` 直接砍掉
- `redis` 模式可以保留（已经走 fetch 协议）
- 新增 `cloudflare-kv` 模式：用 Workers 的 KV binding 直接读写
- 影响文件：`src/utils/data-persistence.js`、`src/utils/redis-client.js`

### 3. 框架层（重）
- Express 不能跑，需换 [Hono](https://hono.dev) 或 [itty-router](https://itty.dev/itty-router/)
- 路由从 `app.use(router)` 改写成 Hono 的 `app.route()` 风格
- 中间件从 `(req, res, next) => {}` 改成 `(c, next) => {}`
- 影响文件：`src/server.js`、`src/middlewares/*.js`、`src/routes/*.js`、`src/controllers/chat.js`

### 4. 流式响应（重）
- `streamOpenAIToAnthropic` / `streamOpenAIToGemini` / `handleStreamResponse` 当前用 Node Express 的 `res.write()` + `res.end()`
- Workers 要返回 `new Response(readableStream, {...})`，并用 `TransformStream` 桥接上游和下游
- 影响文件：`src/adapters/anthropic.js`、`src/adapters/gemini.js`、`src/controllers/chat.js`

### 5. 反爬模块（中）
- `ssxmod-manager.js` 用 `setInterval` 定期刷新；Workers 没有长生命周期的定时器
- 改用 Cron Trigger（独立 worker）或者按需懒计算
- 影响文件：`src/utils/ssxmod-manager.js`

## 估算工作量

按现有约 5000 行后端代码，全面 Cloudflare 化大约相当于一次中等重构（~2000 行新代码 + 删改），需要单独的分支和完整的 e2e 测试。

## 临时替代方案

目前需要 Edge / 全球低延迟部署的：

- **Vercel** —— 见 [README 部署指南](../README.md#vercel-一键部署推荐)
- **Netlify** —— 见 [README Netlify 部分](../README.md#netlify-部署)

两者都基于 AWS Lambda / Firecracker，是 Node.js 运行时，本项目无修改即可跑。

## 想贡献？

如果你想推进这个适配，建议从一个独立分支 `cloudflare/main` 起步。先做最小路径：
1. 砍掉 `t2i` / `t2v` / `images` / `videos` 路由
2. 只跑 OpenAI `/v1/chat/completions` 流式
3. 跑通后再扩
