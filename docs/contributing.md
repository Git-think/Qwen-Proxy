# 提交代码 / Pull Request 指南

本仓库采用 **Conventional Commits** + 单分支主线（`main`）的轻量流程。

## 分支策略

- `main`：唯一主分支，CI 通过即可合并 / 直推
- 功能开发用短期 topic 分支：`feat/<short-name>`、`fix/<bug>`，开 PR 合回 `main`，merge 后删除
- 不要使用长期 feature 分支；累积 diff 容易冲突

## Commit 规范

格式：`<type>(<scope>): <subject>`

常用 type：

| type | 何时用 |
|---|---|
| `feat` | 新功能（用户能感知） |
| `fix` | bug 修复 |
| `refactor` | 重构（外部行为不变） |
| `docs` | 仅文档 |
| `chore` | 构建脚本、依赖升级、配置 |
| `test` | 仅测试 |
| `perf` | 性能优化 |
| `ci` | CI 配置 |

scope 用模块名，常见的有：`account`, `proxy`, `toolcall`, `webui`, `vercel`, `ci`, `request`。

### 示例

```
feat(toolcall): add JSON repair pass to streaming sieve
fix(account): keep failed-login accounts in the list
refactor(redis): generic env vars + Vercel KV auto-pickup
docs(readme): clarify DATA_SAVE_MODE=redis is required on Vercel
```

### 提交正文

- 第一行 ≤ 72 字符
- 空行后写正文，解释**为什么**这么改（"what" 看 diff 就行）
- 关联 issue 用 `Closes #N`

## Sign-off / Co-Author

历史上贡献者用了 `Co-Authored-By` 行（GitHub 会渲染 contributor 头像）。可选；自己提交不必加。

## 本地开发流程

```bash
# 1. fork → clone
git clone https://github.com/<your>/Qwen-Proxy.git
cd Qwen-Proxy
git remote add upstream https://github.com/Git-think/Qwen-Proxy.git

# 2. 装依赖
npm install
cd webui && npm install && cd ..

# 3. 拉一根 topic 分支
git checkout -b feat/cool-thing

# 4. 写代码 / 写测试

# 5. 跑本地烟雾测试
npm start                 # 后端
cd webui && npm run dev   # 前端 (默认 5173)

# 6. commit & push
git add <files>
git commit -m "feat(scope): summary"
git push -u origin feat/cool-thing

# 7. 在 GitHub 网页发 PR 到 upstream/main
```

## 在创建 PR 之前

请确认：

- [ ] 没有把 `.env`、`data/data.json`、`logs/` 提交进来（`.gitignore` 已经覆盖，但用 `git status` 二次确认）
- [ ] 没有把上游 token、API Key 写进 commit 历史（哪怕被 revert，git 历史也会保留 — 真的泄漏了请重置 token）
- [ ] 后端改动跑过 `node -e "require('./src/server.js')"` 至少能 require 不报错
- [ ] 前端改动 `cd webui && npm run build` 能编译通过

## CI / Hooks

- `.github/workflows/docker-build.yml`：所有 push 触发构建多架构镜像
- `.github/workflows/release.yml`：监听 `package.json` 的 `version` 字段变化，自动出 GitHub Release（含 Gemini 生成的 changelog，要求 `GEMINI_API_KEY` secret）

## 同步上游

```bash
git fetch upstream
git rebase upstream/main      # 不要 merge upstream，rebase 干净
git push --force-with-lease   # 自己的 topic 分支可以 force，main 永远不要 force
```

## Code Review

- 自己的 PR 至少自审一遍 diff（`git diff main...HEAD`），把 typo / debug log / 临时调试代码清掉
- 如果 PR 太大（>500 行），考虑拆成两个相互独立的 PR
- 维护者会用 `review` 命令检查；review 提的"必须"项需要解决，"建议"项可讨论
