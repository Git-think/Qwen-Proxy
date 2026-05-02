# 架构与功能实现

按"请求生命周期 → 跨横切模块"组织，用作改代码前的导航地图。

## 系统总览

```
客户端（OpenAI SDK / Claude SDK / Gemini SDK / NextChat / Cline / curl）
        │
        ▼  HTTP / SSE
┌──────────────────────────────────────┐
│  Express 应用（src/server.js）        │
│                                      │
│  路由协议适配 → 鉴权 → chat-middleware │
│        │                              │
│        ▼                              │
│  controllers/chat.js                  │
│        │                              │
│        ▼                              │
│  utils/request.js                     │
│   ├─ 选账号（rotator）                │
│   ├─ 选代理（proxy-pool）             │
│   ├─ 注入 ssxmod cookie               │
│   └─ axios POST → chat.qwen.ai        │
└────────┬─────────────────────────────┘
         │  HTTPS（可选 SOCKS5/HTTP 代理）
         ▼
┌──────────────────────────────────────┐
│  通义千问 API（chat.qwen.ai）         │
└──────────────────────────────────────┘
```

## 协议适配（Anthropic / Gemini → OpenAI 内部表示）

源文件：

- `src/adapters/anthropic.js`：`anthropicToOpenAI` / `openaiToAnthropicResponse` / `streamOpenAIToAnthropic`
- `src/adapters/gemini.js`：`geminiToOpenAI` / `openaiToGeminiResponse` / `streamOpenAIToGemini`

### 设计原则

- 内部统一为 OpenAI shape：`messages[].content`（string / multimodal array），`tools`（function 数组），`tool_choice`，`stream`
- 适配器**只做格式转换**，模型选择、思考、搜索这些上游交互全部走同一套 OpenAI 路径
- 响应侧反向：内部 OpenAI delta / message → 各协议原生格式

### 请求转换表

| Anthropic 字段 | 内部 OpenAI 等价 |
|---|---|
| `system`（string 或 blocks） | `messages[0]` 的 `role: 'system'` |
| `messages[].content[].type='tool_use'` | `messages.tool_calls` |
| `messages[].content[].type='tool_result'` | 单独一条 `role: 'tool'` 消息 |
| `thinking.type='enabled'` + `budget_tokens` | `enable_thinking + thinking_budget` |
| `thinking.type='adaptive'` | `enable_thinking + reasoning_effort='high'` |
| `tools[]` + `input_schema` | `tools[].function.parameters` |
| `tool_choice.type='auto'/'any'/'tool'/'none'` | `tool_choice='auto'/'required'/{type:'function',function:{name}}/'none'` |

| Gemini 字段 | 内部 OpenAI 等价 |
|---|---|
| `systemInstruction.parts[].text` | system 消息 |
| `contents[].parts[].functionCall` | `messages.tool_calls`（id 由后端生成，name → name 反查记忆） |
| `contents[].parts[].functionResponse` | `role: 'tool'` 消息（tool_call_id 反查同一 turn 的 functionCall） |
| `generationConfig.thinkingConfig.thinkingBudget > 0` | 显式 `thinking_budget` |
| `thinkingBudget === -1` | `reasoning_effort='high'` |
| `thinkingBudget === 0` | 关闭 |
| `thinkingLevel: NONE/LOW/MEDIUM/HIGH` | `reasoning_effort` lowercased |
| `tools[].functionDeclarations[]` | `tools[].function` |
| `toolConfig.functionCallingConfig.mode` AUTO/ANY/NONE | `tool_choice` auto/required/none（ANY + 单个 allowedFunctionNames → 强制特定函数） |

## 中间件 chain

源文件：

- `src/middlewares/authorization.js`：API Key / 管理员校验
- `src/middlewares/chat-middleware.js`：处理请求体，包含核心 tool-call gate

`processRequestBody` 关键步骤：

1. 解析 `stream` / `model` / `enable_thinking` / `thinking_budget` / `reasoning_effort` / `size` 等字段
2. **tool-call gate**：检测 `body.tools` 是否非空数组
   - 若是：注入 prompt + 重写历史 → `req.toolcall_enabled = true`
   - 若否：跳过所有 tool-call 逻辑（行为字节级对齐预特性时代）
3. 调用 `parserMessages` 折叠多消息为单条 user 消息（chat.qwen.ai 要求）
4. 设置 `req.body` 为内部 Qwen-shape，传给下游

## Tool Calling

源文件：`src/utils/toolcall.js`

### 工作原理

Qwen `chat.qwen.ai` 不支持原生 OpenAI tools 协议。本项目移植 [ds2api](https://github.com/CJackHwang/ds2api) 的 DSML 方法：

1. **Prompt 注入**：把 `tools` schema + 一段固定的 `<|DSML|tool_calls>` 格式说明文注入到 system prompt
2. **模型遵循**：Qwen 按指令在最终输出末尾用 `<|DSML|invoke name="..."><|DSML|parameter name="..."><![CDATA[...]]></|DSML|parameter></|DSML|invoke>` 格式生成调用
3. **下游解析**：流式 sieve 状态机 / 非流式整体扫描，把 DSML 转回 OpenAI `tool_calls`，从可见文本里剥离

### 模块结构

| 函数 | 用途 |
|---|---|
| `hasTools(reqBody)` | 守门：仅当客户端确实传了非空 `tools` 数组才返回 true |
| `buildToolPromptBlock(tools)` | 构造系统 prompt 段（规则 + 示例 + 工具 schema） |
| `serializeAssistantToolCalls(toolCalls)` | 历史中 assistant.tool_calls → DSML 文本 |
| `serializeToolResult(msg)` | 历史中 role:'tool' → `<|DSML|tool_result tool_use_id="...">...</...>` |
| `parseToolCallsFromText(text)` | 非流式：扫描文本，最后一段闭合的 DSML 块胜出，剥离 markdown fence 包裹 |
| `createSieve()` | 流式状态机：跨 chunk 的部分前缀 hold；闭合后整体解析并发 deltas |
| `tryJsonRepair(s)` | 三 pass JSON 修复：原样 / Python literal+尾随逗号+单引号 / 括号闭合 |

### 工具名混淆

`TOOL_ALIAS_OUT` 列表中的常见短名（`Read` / `Write` / `Bash` / `Grep` / `Edit` 等）映射到带前缀的别名（`fs_open_file` / `shell_run` 等），避免 Qwen 模型对裸短名的预训练偏见拒绝。其他名字（包括用户自定义工具）**保持原样不前缀**——因为 `t_` 前缀会让 qwen3.6-plus 误判为不存在的命名空间。

## 账号轮询

源文件：

- `src/utils/account.js`：账号管理器（单例）
- `src/utils/account-rotator.js`：LRU + 失败冷却调度
- `src/utils/token-manager.js`：登录 / 刷新 JWT

### 选择策略

- LRU：优先选最久未使用的账号
- 失败冷却：连续失败 ≥ `maxFailures` 进入 `cooldownPeriod` 冷却（默认 5 分钟），自动恢复
- 失败保留：登录失败的账号**仍留在列表**（token 设为空 + 时间戳），管理面板能看到红色"登录失败"，可点刷新重试。这是为了避免短暂网络抖动导致账号永久消失

### 自动刷新

- 启动后每 6 小时检查一次 token，剩余 < 24 小时则重新登录
- Serverless 环境（Vercel / Netlify）禁用定时器（容器无长生命周期），改为请求时按需懒检查

## 智能代理池

源文件：`src/utils/proxy-pool.js`

### 数据结构

```
proxies:           Map<url, {url, status, assignedAccounts:Set<email>}>
proxyAssignment:   Map<email, url>
```

`status` 三态：`untested` / `available` / `failed`。

### 四级优先级 `assignProxy(email, forceNew)`

```
P1: status='available' && assignedAccounts.size===0  ← 独占
P2: status='untested'                                 ← 首次探测
P3: status='failed'                                   ← 重测，可能恢复
P4: status='available' && shared，按占用最少排序     ← 共享
```

每级内部都先 `_testProxy(url)` 验证才下发；探测端点是 `gstatic.com/generate_204` + `cloudflare.com/cdn-cgi/trace` 兜底。

### 故障转移

`request.js` 检测到 TCP 类错误（`ECONNRESET` / `ETIMEDOUT` / `ENOTFOUND` / 等）时调用 `accountManager.handleNetworkFailure(email, proxyUrl)`：

1. `markProxyAsFailed(proxyUrl)` → 持久化
2. `assignProxy(email, forceNew=true)` → 重新走四级
3. 主循环 `continue` 进入下一次 attempt（最多 `PROXY_MAX_RETRIES` 次）

非 TCP 错误（Auth 401、4xx）**不**触发重试——避免错误诊断被 N 次重试遮盖。

### 持久化

`file` / `redis` 两种模式都保存：
- `proxyStatuses`：每个 url 的 status
- `proxyBindings`：每个 email → url 绑定

冷启动 / 重启后从存储恢复，绑定关系跨重启稳定（账号继续走熟悉的 IP，避免上游风控）。

## 请求层（Retry + Proxy）

源文件：`src/utils/request.js`

主循环骨架：

```js
for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  await accountManager.ensureInitialized()    // 等首次登录完成（防 cold-start race）
  const { token, email } = rotator.getNextAccountInfo()
  const proxy = await getProxyForAccount(email)

  try {
    const chatId = await generateChatID(token, model, email, proxy)
    const res = await axios.post(chatUrl, body, { agent, ... })
    if (res.status === 200) return { status: true, response: res.data }
  } catch (err) {
    if (proxy && isProxyShapedError(err) && attempt < MAX_RETRIES) {
      await accountManager.handleNetworkFailure(email, proxy)
      continue
    }
    break
  }
}
```

`ensureInitialized` 等首次登录这步很关键——没它的话 Vercel 多并发 cold start 会让一批请求落在尚未完成 signin 的实例里，看到 `token === ''` 就 500（典型症状：连续多个 500 后突然一个 200）。

## 反爬：ssxmod Cookie

源文件：`src/utils/cookie-generator.js` / `fingerprint.js` / `ssxmod-manager.js`

`chat.qwen.ai` 验证两个 cookie：`ssxmod_itna` 和 `ssxmod_itna2`。这两个值是浏览器指纹经过 LZW 压缩 + Base64 拼接的产物。

实现：
1. `fingerprint.js` 合成 37 字段浏览器指纹（screen / userAgent / canvas / WebGL / 时区等）
2. `cookie-generator.js`：随机化指纹 → LZW 压缩 → Base64 → 拼接成 itna / itna2
3. `ssxmod-manager.js` 进程启动时生成一次，每 15 分钟刷新（仅本地 / Docker；Vercel cold-start 模型每次启动单生成）

## 思考与搜索

详见 [api.md#思考强度openai-标准](api.md#思考强度openai-标准)。三协议都通过适配器映射到内部 `enable_thinking` + `thinking_budget` + `reasoning_effort`，最终在 `chat-helpers.js` 的 `isThinkingEnabled` 里合并优先级：

```
explicit thinking_budget > reasoning_effort mapping > default
                                 ^
                                 'low' → 4096, 'medium' → 16384, 'high' → 81920
```

Qwen 接收的字段：`feature_config.thinking_enabled` + `feature_config.thinking_budget`。

搜索：模型名带 `-search` 后缀触发 chat_type='search'（由 `chat-helpers.isChatType` 决定）。Gemini 适配器还会把 `tools[].google_search` / `googleSearch` 等多种声明翻译成模型后缀。

## 数据持久化

源文件：`src/utils/data-persistence.js` + `src/utils/redis-client.js`

三模式：

| 模式 | 后端 | 文件 |
|---|---|---|
| `none` | 内存 | env vars 启动时种子，运行期不写 |
| `file` | `data/data.json` | 单文件 JSON：`{accounts, proxyBindings, proxyStatuses}` |
| `redis` | Upstash REST 协议 | 单 key `qwen2api:data` 存 JSON |

`redis` 模式使用 axios 直接打 Upstash REST，没有 TCP 连接池——非常适合 Vercel / Netlify 这类 serverless 环境。凭证按优先级查找：`REDIS_URL/REDIS_TOKEN` > `KV_REST_API_URL/KV_REST_API_TOKEN`（Vercel Marketplace 集成 Upstash 时自动注入）> `UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN`。

## 前端 webui

源文件：`webui/`

技术栈：React 18 + Vite + Tailwind v3 + react-router v6。

主要页面：

| 路由 | 文件 | 说明 |
|---|---|---|
| `/login` | `pages/Login.jsx` | API Key 登录 |
| `/chat` | `pages/Chat.jsx` | 内置聊天，含思考/搜索 toggle、模型选择、附件、版本化重试 |
| `/admin` | `pages/Admin.jsx` | 账号管理（含登录失败保留 + 重试） |
| `/docs` | `pages/Docs.jsx` | 交互式 API 文档（每个端点都能"试一下"） |
| `/vercel` | `pages/Vercel.jsx` | Vercel 同步面板（仅在 Vercel 部署且配了 token 时显示） |

`Sidebar.jsx` 检测 `/api/vercel/info`（公共端点）决定是否显示 Vercel 链接，避免 SPA rewrite 把 `/` 截到 index.html。

### 版本化重试

`useChat.js` 在 retry 时不删除原回答，把新回答 push 到 `messages[i].versions[]` 数组，UI 渲染 `< N/M >` 切换器。

### Tool / Search toggle

模型选择器只显示**基础模型**（剥离 `-thinking` / `-search` 后缀去重），具体后缀由两个 toggle 控制；发送时 `composeModel()` 拼出最终模型名 `<base>-thinking-search`。

## CI / Release

`.github/workflows/`：

- `docker-build.yml`：每次 push 到 main 触发多架构 Docker 镜像构建
- `release.yml`：监听 `package.json` 的 `version` 变化，自动出 GitHub Release，含 Gemini 生成的 changelog（fallback 到普通 commit list）

## 测试

目前没有自动化测试套件，靠 require-时 smoke test + 本地手测。要补 e2e 测试可以从 `controllers/chat.js` 的 stream / non-stream 路径开始（mock 上游 SSE）。
