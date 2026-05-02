# API 接口文档

本服务在同一个后端同时暴露三种协议格式：**OpenAI**、**Anthropic Messages**、**Google Gemini**。所有请求最终都被转换成内部 OpenAI-shape，调用 `chat.qwen.ai` 后再按客户端协议序列化返回。

## 鉴权

| 协议 | 鉴权头 |
|---|---|
| OpenAI | `Authorization: Bearer sk-...` |
| Anthropic | `x-api-key: sk-...` 或 `Authorization: Bearer sk-...` |
| Gemini | `x-goog-api-key: sk-...` 或 `?key=sk-...` 或 `Authorization: Bearer sk-...` |
| 管理 / 公共 | `Authorization: Bearer sk-...`（管理需要 `API_KEY` 列表里的**第一个** key） |

`API_KEY` 环境变量支持逗号分隔多个密钥；其中**第一个**为管理员密钥（可访问 `/api/*` 管理接口）。

## OpenAI 兼容

### `POST /v1/chat/completions`

聊天补全，支持流式 / 非流式、视觉、Function Calling、思考、联网搜索。

```json
{
  "model": "qwen3.6-plus",
  "messages": [
    {"role": "user", "content": "你好"}
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 1024
}
```

#### 模型后缀

模型名通过后缀切换能力（可叠加）：

| 后缀 | 含义 |
|---|---|
| 无 | 标准聊天 |
| `-thinking` | 思考模式（reasoning_content 非空） |
| `-search` | 联网搜索 |
| `-thinking-search` | 同时启用 |
| `-image` | 文生图（走 `/v1/images/*` 路径） |
| `-image-edit` | 图片编辑 |
| `-video` | 文生视频 |

#### 思考强度（OpenAI 标准）

```json
{
  "model": "qwen3.6-plus",
  "enable_thinking": true,         // 显式开关
  "thinking_budget": 16384,         // 显式 budget
  "reasoning_effort": "high"        // 'low'|'medium'|'high' → 4096|16384|81920
}
```

优先级：`thinking_budget` > `reasoning_effort` > `-thinking` 后缀。

#### Tool / Function Calling

```json
{
  "model": "qwen3.6-plus",
  "messages": [...],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "...",
        "parameters": {...}
      }
    }
  ],
  "tool_choice": "auto"
}
```

实现机制详见 [architecture.md#tool-calling](architecture.md#tool-calling)。客户端不传 `tools` 时，行为与本特性引入前完全一致。

### `GET /v1/models`

返回当前可用模型列表（运行时从 chat.qwen.ai 拉取并按后缀展开）。

```json
{
  "object": "list",
  "data": [
    { "id": "qwen3.6-plus", "object": "model", "owned_by": "qwen" },
    { "id": "qwen3.6-plus-thinking", "object": "model", "owned_by": "qwen" },
    { "id": "qwen3.6-plus-search", "object": "model", "owned_by": "qwen" }
  ]
}
```

### `POST /v1/images/generations`

文生图。

```json
{
  "model": "qwen3.6-plus-image",
  "prompt": "A beautiful sunset",
  "n": 1,
  "size": "1024x1024"
}
```

### `POST /v1/images/edits`

图片编辑（multipart/form-data）：`image`（文件）、`prompt`（文字）、`model`（带 `-image-edit` 后缀的模型名）。

### `POST /v1/videos`

文生视频（multipart/form-data）：`model`、`prompt`。

## Anthropic Messages 兼容

### `POST /v1/messages` 或 `POST /anthropic/v1/messages`

```json
{
  "model": "qwen3.6-plus",
  "max_tokens": 1024,
  "messages": [
    {"role": "user", "content": "Hi"}
  ],
  "stream": false,
  "thinking": { "type": "enabled", "budget_tokens": 16384 },
  "tools": [
    {
      "name": "get_weather",
      "description": "...",
      "input_schema": {...}
    }
  ],
  "tool_choice": { "type": "auto" }
}
```

支持：
- `system` 字段（string 或 content blocks）
- `messages[].content` 字符串或 content blocks（含 `text` / `image` / `tool_use` / `tool_result` / `thinking`）
- `thinking.type` = `enabled` / `adaptive` / `disabled`
- `tools` + `tool_choice`（auto / any / tool / none）
- `stream: true` 输出标准 Anthropic SSE 事件序列（`message_start` / `content_block_*` / `message_delta` / `message_stop`），含 `tool_use` 块的 `input_json_delta`

## Google Gemini 兼容

### `POST /v1beta/models/{model}:generateContent`（非流）
### `POST /v1beta/models/{model}:streamGenerateContent`（流）

也接受不带 beta 的 `/v1/models/...` 路径。

```json
{
  "contents": [
    {"role": "user", "parts": [{"text": "Hello"}]}
  ],
  "systemInstruction": { "parts": [{"text": "..."}] },
  "generationConfig": {
    "temperature": 0.7,
    "topP": 0.95,
    "maxOutputTokens": 1024,
    "thinkingConfig": {
      "thinkingBudget": 16384,
      "thinkingLevel": "HIGH",
      "includeThoughts": true
    }
  },
  "tools": [
    { "functionDeclarations": [{ "name": "get_weather", "parameters": {...} }] }
  ],
  "toolConfig": {
    "functionCallingConfig": { "mode": "AUTO", "allowedFunctionNames": [...] }
  }
}
```

支持：
- `contents[].parts[]`：`text` / `inlineData` / `functionCall` / `functionResponse`
- `thinkingConfig.thinkingBudget` 正数 → 显式 budget；`-1` → 自适应；`0` → 关闭；同时支持 `thinkingLevel` 字段
- `tools[].functionDeclarations` → OpenAI tools；`toolConfig.functionCallingConfig.mode` AUTO / ANY / NONE → auto / required / none
- 搜索工具识别多种写法：`google_search` / `googleSearch` / `google_search_retrieval` / `googleSearchRetrieval`，以及 OpenAI 风格 `{ type: 'function', function: { name: 'googleSearch' } }`

## 管理 / Admin（需要管理员 API Key）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/getAllAccounts` | 列出所有账号（含登录失败状态） |
| POST | `/api/setAccount` | 添加账号 `{ email, password }` |
| DELETE | `/api/deleteAccount` | 删除账号 `{ email }` |
| POST | `/api/refreshAccount` | 重新登录单个账号 `{ email }` |
| POST | `/api/refreshAllAccounts` | 批量刷新即将过期 `{ thresholdHours }` |
| GET | `/api/proxy/status` | 智能代理池状态快照 |
| POST | `/api/proxy/add` | 运行时加代理 `{ url }` |
| DELETE | `/api/proxy` | 移除代理 `{ url }` |
| GET | `/api/vercel/status` | Vercel 同步状态（含 projectId / teamId） |
| GET | `/api/vercel/env` | Vercel 项目环境变量列表 |
| POST | `/api/vercel/env` | 更新 Vercel 环境变量 `{ key, value, target?, type? }` |
| POST | `/api/vercel/redeploy` | 重新部署最近一次 |

## 公共

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/verify` | 验证 API Key `{ apiKey }` → `{ valid: bool }` |
| GET | `/health` | 健康检查 → `{ status: 'ok' }` |
| GET | `/api/vercel/info` | Vercel runtime 检测信息（boolean + 非密 ID）；前端 Sidebar 用 |

## 错误格式

按协议返回各自的标准错误体：

```json
// OpenAI
{ "error": { "message": "...", "type": "...", "code": "..." } }

// Anthropic
{ "type": "error", "error": { "type": "...", "message": "..." } }

// Gemini
{ "error": { "code": 500, "message": "...", "status": "INTERNAL" } }
```
