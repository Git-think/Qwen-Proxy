# Qwen-Proxy

<p align="center">
  <strong>通义千问 OpenAI / Anthropic / Gemini 三协议兼容代理</strong><br>
  支持 Vercel / Docker / Render 一键部署，零持久化存储
</p>

<p align="center">
  <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FGit-think%2FQwen-Proxy&env=API_KEY,ACCOUNTS&envDescription=API_KEY%3A%20API%E5%AF%86%E9%92%A5%EF%BC%8CACCOUNTS%3A%20%E8%B4%A6%E5%8F%B7(email%3Apassword)&project-name=qwen-proxy&repository-name=Qwen-Proxy"><img src="https://vercel.com/button" alt="Deploy with Vercel" /></a>
</p>

<p align="center">
  <a href="#功能特性">功能</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#部署指南">部署</a> •
  <a href="#技术架构">架构</a> •
  <a href="#api-接口文档">API 文档</a>
</p>

---

## 功能特性

| 功能 | 说明 |
|------|------|
| **三协议兼容** | 同一后端同时暴露 OpenAI / Anthropic Messages / Google Gemini 三种 API 格式 |
| **Tool Calling** | Qwen3.x 模型原生支持 Function Calling，工具调用通过上下文传递，模型自动识别并生成结构化调用 |
| **多账号轮询** | 最近最少使用 (LRU) 调度 + 失败冷却机制 + 自动故障转移 |
| **自动刷新** | 用户名密码登录，每 6 小时自动重新登录刷新 JWT Token |
| **流式输出** | 完整 SSE 流式响应，兼容 `stream: true` |
| **思维链** | 推理模型通过 OpenAI 标准 `reasoning_content` 字段输出，模型名加 `-thinking` 后缀启用 |
| **联网搜索** | 搜索增强生成，模型名加 `-search` 后缀，返回来源引用 |
| **图片生成** | 文生图 `/v1/images/generations`，支持多种尺寸 |
| **图片编辑** | `/v1/images/edits`，支持 multipart 上传 |
| **视频生成** | 文生视频 `/v1/videos` |
| **反爬绕过** | 内置 ssxmod 浏览器指纹 Cookie 自动生成，每 15 分钟刷新 |
| **代理支持** | HTTP / HTTPS / SOCKS5 代理 |
| **Vercel 部署** | 部署即同时构建前端 + Serverless 后端 |
| **Docker 部署** | 多阶段 Alpine 镜像构建 |
| **管理面板** | React 暗色主题面板 + 内置聊天（支持版本化重试） + 交互式 API 文档 |

---

## 快速开始

### 1. 安装

```bash
git clone https://github.com/Git-think/Qwen-Proxy.git
cd Qwen-Proxy
npm install
cd webui && npm install && cd ..
```

### 2. 配置

```bash
cp .env.example .env
```

编辑 `.env`：

```bash
# 必填
API_KEY=sk-your-key-here
ACCOUNTS=your-email@example.com:your-password

# 可选
SERVICE_PORT=3000
DATA_SAVE_MODE=none
LOG_LEVEL=INFO
```

### 3. 构建前端 + 启动

```bash
npm run build:webui   # 构建前端到 webui/dist/
npm start             # 生产模式（同时托管前端 + 后端）
npm run dev           # 开发模式（自动重启后端）
```

前端开发模式：`cd webui && npm run dev`（默认 5173，已配置代理转发到 3000）。

访问 `http://localhost:3000` 查看管理面板。

### 4. 测试

OpenAI 格式：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3.6-plus","messages":[{"role":"user","content":"你好"}],"stream":true}'
```

Anthropic 格式：

```bash
curl http://localhost:3000/v1/messages \
  -H "x-api-key: sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3.6-plus","max_tokens":1024,"messages":[{"role":"user","content":"你好"}]}'
```

Gemini 格式：

```bash
curl "http://localhost:3000/v1beta/models/qwen3.6-plus:generateContent" \
  -H "x-goog-api-key: sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"你好"}]}]}'
```

---

## 部署指南

### Vercel 一键部署（推荐）

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FGit-think%2FQwen-Proxy&env=API_KEY,ACCOUNTS&envDescription=API_KEY%3A%20API%E5%AF%86%E9%92%A5%EF%BC%8CACCOUNTS%3A%20%E8%B4%A6%E5%8F%B7(email%3Apassword)&envLink=https%3A%2F%2Fgithub.com%2FGit-think%2FQwen-Proxy%23%E7%8E%AF%E5%A2%83%E5%8F%98%E9%87%8F&project-name=qwen-proxy&repository-name=Qwen-Proxy)

点击按钮后：
1. Vercel 会自动 fork 仓库到你的 GitHub
2. 填写环境变量：
   - `API_KEY` — 你的 API 密钥（如 `sk-xxx`）
   - `ACCOUNTS` — 通义千问账号（如 `email@example.com:password`，多个用逗号分隔）
3. 点击 Deploy，等待部署完成

`vercel.json` 自动执行：
- `cd webui && npm install && npm run build` 构建前端到 `webui/dist`
- `api/index.js` 作为 Serverless Function 处理所有 API 请求
- SPA 路由 fallback 到 `index.html`

`DATA_SAVE_MODE` 默认为 `none`，所有状态保存在内存中，冷启动时自动登录获取 Token。

### Docker 部署

```bash
docker compose up -d

# 或手动
docker build -t qwen-proxy .
docker run -d -p 3000:3000 \
  -e API_KEY=sk-your-key \
  -e ACCOUNTS=email:password \
  qwen-proxy
```

需要持久化存储时加 `-e DATA_SAVE_MODE=file -v ./data:/app/data`。

仓库已配置 GitHub Actions 自动构建并发布镜像到 GHCR / Release，详见 [.github/workflows](.github/workflows/)。

### Render 部署

1. 创建 **Web Service**，连接 GitHub
2. Build Command: `npm install && npm run build:webui`
3. Start Command: `npm start`
4. 环境变量：`API_KEY`、`ACCOUNTS`、`DATA_SAVE_MODE=none`

### 其他平台（Railway / Fly.io）

Node.js 18+，先 `npm run build:webui` 再 `npm start` 即可。

---

## 技术架构

### 系统总览

```
客户端（OpenAI SDK / Claude SDK / Gemini SDK / NextChat / ChatBox）
        │
        ▼  HTTP / SSE
┌──────────────────────────────────────┐
│  Qwen-Proxy（Express.js）             │
│                                      │
│  协议适配 → API Key 鉴权 → 格式转换 → 账号轮询 │
│        │                              │
│        ▼                              │
│  请求模块 + ssxmod Cookie + 代理      │
└────────┬─────────────────────────────┘
         │  HTTPS
         ▼
┌──────────────────────────────────────┐
│  通义千问 API（chat.qwen.ai）         │
│  登录 / 创建会话 / 聊天 / 模型列表    │
└──────────────────────────────────────┘
```

三协议适配层：所有非 OpenAI 协议（Anthropic / Gemini）请求统一在 `src/adapters/` 中转换为 OpenAI 内部表示，复用同一套上游请求与流式解析。

### 目录结构

```
项目根目录/
├── api/index.js              # Vercel Serverless 入口
├── src/
│   ├── adapters/
│   │   ├── anthropic.js      # Anthropic ↔ OpenAI 转换 + SSE 重写
│   │   └── gemini.js         # Gemini ↔ OpenAI 转换 + SSE 重写
│   ├── config/index.js       # 环境变量配置
│   ├── controllers/          # 控制器（聊天、图片视频、模型）
│   ├── middlewares/          # 中间件（鉴权、格式转换）
│   ├── models/models-map.js  # 动态模型获取与缓存
│   ├── routes/
│   │   ├── chat.js           # /v1/chat/completions、images、videos
│   │   ├── anthropic.js      # /v1/messages、/anthropic/v1/messages
│   │   ├── gemini.js         # /v1(beta)/models/{model}:generate*
│   │   ├── models.js         # /v1/models
│   │   ├── accounts.js       # /api/* 账号管理
│   │   ├── verify.js         # /verify
│   │   └── vercel.js         # Vercel 专属辅助接口
│   ├── utils/
│   │   ├── account.js        # 账号管理器（核心单例）
│   │   ├── account-rotator.js # LRU 负载均衡
│   │   ├── token-manager.js  # Token 登录/验证/刷新
│   │   ├── data-persistence.js # 存储层（none/file）
│   │   ├── request.js        # 上游 HTTP 请求
│   │   ├── chat-helpers.js   # 消息解析与模型匹配
│   │   ├── cookie-generator.js # ssxmod Cookie（LZW 压缩）
│   │   ├── fingerprint.js    # 浏览器指纹合成
│   │   ├── ssxmod-manager.js # Cookie 生命周期（15分钟刷新）
│   │   ├── proxy-helper.js   # 代理配置
│   │   ├── upload.js         # 阿里云 OSS 上传
│   │   ├── logger.js         # 日志
│   │   └── tools.js          # SHA-256 / JWT / UUID
│   ├── server.js             # Express 应用
│   └── start.js              # 启动器
├── webui/                    # React 前端管理面板（Vite + Tailwind）
├── vercel.json               # 同时构建前端 + 部署 Serverless
├── Dockerfile
├── docker-compose.yml
├── package.json
└── .env.example
```

### 后端实现详解

#### 认证流程

| 步骤 | 实现 |
|------|------|
| 密码处理 | `SHA-256` 哈希明文密码 |
| 登录 | `POST chat.qwen.ai/api/v1/auths/signin` |
| Token | JWT 格式，包含过期时间 `exp` |
| 自动刷新 | 每 6 小时重新登录（刷新 = 重新登录） |
| 刷新阈值 | 剩余有效期 < 24 小时时触发 |

#### 账号轮询

- **LRU 策略**：优先选择最久未使用的账号
- **失败冷却**：连续失败 3 次 → 5 分钟冷却 → 自动重置
- **负载均衡**：多账号自动分散请求压力

#### 反爬机制

通义千问 API 要求浏览器指纹 Cookie：

1. `fingerprint.js` 合成 37 字段浏览器指纹
2. `cookie-generator.js` 随机化 → LZW 压缩 → Base64 → `ssxmod_itna` + `ssxmod_itna2`
3. `ssxmod-manager.js` 每 15 分钟自动刷新

#### 请求处理链路

```
1. 客户端发送 OpenAI / Anthropic / Gemini 格式请求
2. 鉴权中间件（按协议匹配 Authorization / x-api-key / x-goog-api-key）
3. 适配器把请求转换为内部 OpenAI 表示
4. Chat 中间件转换格式：
   - 解析模型后缀（-thinking / -search 等）
   - 匹配上游模型 ID
   - 转换消息为 Qwen 格式
5. Request 模块：
   - 选取账号 Token
   - 生成 ssxmod Cookie
   - 创建会话 → 发送请求
6. Chat 控制器处理响应：
   - 解析 SSE（phase=think → reasoning_content，phase=answer → content）
   - 按客户端协议封装为对应格式（OpenAI Chunk / Anthropic Event / Gemini Candidate）
```

#### Tool Calling

Qwen3 模型原生支持 Function Calling。工作方式：

1. 客户端按 OpenAI 格式在 `messages` 中携带 `tools` 定义
2. 中间件将所有消息序列化为文本上下文
3. Qwen3 模型从上下文理解工具协议，自动生成结构化 `tool_calls`
4. 实测 OpenAI SDK 的 function calling 可正常使用

### 前端实现

| 项目 | 说明 |
|------|------|
| 框架 | React 18 + Hooks |
| 构建 | Vite 5，产物 `webui/dist/` |
| 样式 | Tailwind CSS 3，暗色主题，毛玻璃 |
| 路由 | React Router 6 |
| 聊天 | `fetch` + `ReadableStream` SSE 流式解析；重试不重发消息，新版本作为 `versions[]` 追加并支持左右切换 |
| 存储 | `localStorage` 聊天历史 |
| 渲染 | `marked` + `highlight.js` 代码高亮 |
| 文档页 | OpenAI / Anthropic / Gemini / 管理 / 公共 五分类切换 |

页面：聊天界面 / 管理面板 / API 文档 / 登录

```bash
cd webui && npm install && npm run build   # 构建
cd webui && npm run dev                     # 开发
```

---

## 环境变量

| 变量 | 说明 | 默认值 | 必填 |
|------|------|--------|------|
| `API_KEY` | API 密钥，逗号分隔，第一个为管理员 | — | ✅ |
| `ACCOUNTS` | 账号 `email:pass,email2:pass2` | — | ✅ |
| `SERVICE_PORT` | 端口 | `3000` | — |
| `DATA_SAVE_MODE` | `none`（内存）/ `file`（文件） | `none` | — |
| `LISTEN_ADDRESS` | 监听地址 | 所有接口 | — |
| `OUTPUT_THINK` | 输出思考内容 | `false` | — |
| `SEARCH_INFO_MODE` | 搜索显示 `text` / `table` | `text` | — |
| `SIMPLE_MODEL_MAP` | 简化模型列表 | `false` | — |
| `LOG_LEVEL` | 日志级别 | `INFO` | — |
| `PROXY_URL` | 代理地址 | — | — |
| `QWEN_CHAT_PROXY_URL` | 自定义 API 地址 | `https://chat.qwen.ai` | — |

---

## API 接口文档

### OpenAI 格式

```http
POST /v1/chat/completions
Authorization: Bearer sk-your-key

{"model":"qwen3.6-plus","messages":[{"role":"user","content":"你好"}],"stream":true}
```

模型后缀：无（标准） / `-thinking`（思维链） / `-search`（搜索） / `-thinking-search` / `-image` / `-video` / `-image-edit`

常用基础模型示例：`qwen3.6-plus` / `qwen3-235b-a22b` / `qwen3-coder-plus` / `qwen-max`。完整列表通过 `GET /v1/models` 动态获取。

### Anthropic Messages 格式

```http
POST /v1/messages           （或 /anthropic/v1/messages）
x-api-key: sk-your-key
Content-Type: application/json

{
  "model": "qwen3.6-plus",
  "max_tokens": 1024,
  "messages": [{"role":"user","content":"你好"}],
  "stream": true
}
```

也接受 `Authorization: Bearer ...`。流式响应遵循 Anthropic SSE 事件类型（`message_start` / `content_block_delta` / `message_stop` 等）。

### Gemini 格式

```http
POST /v1beta/models/qwen3.6-plus:generateContent
x-goog-api-key: sk-your-key
Content-Type: application/json

{"contents":[{"role":"user","parts":[{"text":"你好"}]}]}
```

也支持：
- 流式：`/v1beta/models/{model}:streamGenerateContent`
- v1 路径：`/v1/models/{model}:generateContent`、`/v1/models/{model}:streamGenerateContent`
- 鉴权：`x-goog-api-key` 头、`?key=...` 查询参数、`Authorization: Bearer ...`

### 模型列表

```http
GET /v1/models
```

### 图片 / 视频

```http
POST /v1/images/generations
{"prompt":"海上日落","size":"1024x1024"}

POST /v1/images/edits  (multipart)
POST /v1/videos        (multipart)
```

### 账号管理（管理员）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/getAllAccounts` | 获取账号列表（支持分页） |
| POST | `/api/setAccount` | 添加账号 |
| DELETE | `/api/deleteAccount` | 删除账号 |
| POST | `/api/refreshAccount` | 刷新单账号 Token |
| POST | `/api/refreshAllAccounts` | 批量刷新（支持 `thresholdHours`） |

### 健康检查

```http
GET /health → {"status":"ok"}
POST /verify {"apiKey":"sk-..."} → {"valid":true}
```

---

## 常见问题

**Token 过期？** — 自动刷新，每 6 小时重新登录。也可在管理面板手动刷新。

**Vercel 冷启动慢？** — 首次请求需登录账号（几秒），后续直接使用内存中的 Token。

**支持哪些客户端？** — 任何 OpenAI / Anthropic / Gemini 客户端均可：OpenAI SDK、`@anthropic-ai/sdk`、`@google/generative-ai`、NextChat、ChatBox、Open WebUI、Lobe Chat、Claude Code 等。

**Tool Calling 怎么用？** — 按 OpenAI function calling 格式发送即可，Qwen3 自动识别。

**多账号？** — `ACCOUNTS=email1:pass1,email2:pass2,email3:pass3` 或管理面板批量添加。

**前端重试会丢失上一次回答吗？** — 不会。新一轮回答作为新版本追加到同一条 assistant 消息，可以用消息底部的 `< 1/N >` 控件随时切回旧版本。

---

## 许可证

MIT
