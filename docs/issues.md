# 提交 Issue 指南

## 提交前自查

打开 issue 之前，先排除以下情况能省下你和维护者的时间：

1. **搜过现有 issue** —— 用关键字（错误信息、模块名、模型名）在 [issues](https://github.com/Git-think/Qwen-Proxy/issues?q=is%3Aissue) 搜一下
2. **核对版本** —— `git rev-parse HEAD` 看本地 commit；如果跟 main 落后多个 commit，先 `git pull` 再复现
3. **看日志** —— `LOG_LEVEL=DEBUG` 重跑一次，看实际错误
4. **查文档** —— 重点看 [README](../README.md)、[API 文档](api.md)、[架构与实现](architecture.md)

## Issue 类型

### 🐛 Bug 报告

最有用的 bug 报告包含**复现配方**——哪怕一两行命令也比一段叙述强。模板：

```markdown
**版本**: <git rev-parse HEAD 输出>
**部署平台**: Vercel / Netlify / Docker / Render / 自部署
**Node 版本**: <node -v>
**DATA_SAVE_MODE**: none / file / redis

**复现步骤**:
1. ...
2. ...
3. ...

**期望行为**:

**实际行为**:

**日志**（LOG_LEVEL=DEBUG 跑一次，把和报错相关的几行贴上来；隐去 token / 邮箱）:

```
<paste here>
```

**额外上下文**: 客户端是什么（NextChat / OpenAI SDK / Claude SDK / Cline / curl）、模型名、是否启用 -thinking / -search / tools
```

### ✨ 功能请求

把"想要什么"和"为什么"写清楚——后者更重要。模板：

```markdown
**用例**:
我在做 X，目前 Y 不行 / 不顺，想要 Z。

**当前 workaround**（如果有）:

**期望接口**（API / 环境变量 / UI 形式）:
```

避免直接抛"加上 N 功能" + 不解释场景的 issue —— 维护者很难判断优先级。

### 🤔 使用问题

如果只是不确定"X 怎么用 / 是不是这样"——倾向先在 [Discussions](https://github.com/Git-think/Qwen-Proxy/discussions)（如果开放）问，issue 留给确定的 bug / 需求。

## 怎么写一个让人想立刻处理的 bug 报告

- ✅ **标题**：`/v1/chat/completions 返回 500 当请求体含 tools[].name='Read'`
- ❌ **标题**：`tool call 不工作`

- ✅ **重现路径**：贴一个最小 curl 命令
- ❌ **重现路径**：`我在用 Cline 调用，有时候报错有时候不报错`

- ✅ **日志**：贴具体几行带时间戳的错误
- ❌ **日志**：`后端日志说 token 拿不到`

## 安全相关

发现安全漏洞（账号 token 泄漏、上游凭证暴露、未授权 API 等）请**不要**直接开 public issue。先邮件 / 私信仓库主一份简要说明，等 patch 发布再公开。

## 跨语言

中文 / 英文都可以。维护者两种都看。
