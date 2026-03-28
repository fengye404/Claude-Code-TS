# Claude-Code-TS 产品规格书

## 1. 项目概述

用 TypeScript + Vercel AI SDK 重新实现 [learn-claude-code](https://github.com/shareAI-lab/learn-claude-code) 教学仓库，从最小 Agent Loop 开始，逐步叠加 harness 机制。

---

## 2. S01 功能规格 —— "One loop & Bash is all you need"

### 2.1 Agent Loop 核心循环

| 属性 | 规格 |
|------|------|
| 驱动方式 | `while` 循环：LLM 返回 `tool_use` 则继续，否则终止 |
| 实现方式 | 使用 `ai` SDK 的 `generateText` + `maxSteps`，SDK 内部处理循环 |
| 消息历史 | `CoreMessage[]`，跨轮次累积，支持多轮对话上下文 |
| System Prompt | `"You are a coding agent at {cwd}. Use bash to solve tasks. Act, don't explain."` |
| Max Steps | 单次调用最多 30 步工具调用 |

### 2.2 Bash 工具

| 属性 | 规格 |
|------|------|
| 工具名 | `bash` |
| 参数 | `{ command: string }` (Zod schema) |
| 执行方式 | `execSync`，同步阻塞 |
| 工作目录 | `process.cwd()` |
| 超时 | 120 秒，超时返回 `"Error: Timeout (120s)"` |
| 输出截断 | 最多 50,000 字符 |
| 空输出 | 返回 `"(no output)"` |
| 危险命令拦截 | 匹配以下模式立即返回 `"Error: Dangerous command blocked"`：`rm -rf /`, `sudo`, `shutdown`, `reboot`, `> /dev/` |
| 异常处理 | 子进程非零退出码：返回 stdout+stderr 合并内容 |

### 2.3 REPL 交互界面

| 属性 | 规格 |
|------|------|
| 提示符 | `\x1b[36ms01 >> \x1b[0m` (青色) |
| 退出方式 | 输入 `q`、`exit`、空行，或 Ctrl+C / Ctrl+D |
| 工具调用显示 | 黄色前缀 `$ {command}`，输出截断 200 字符预览 |
| LLM 文本输出 | 直接打印 |
| 会话连续性 | 消息历史在整个 REPL 会话中持续累积 |

### 2.4 错误处理

| 场景 | 行为 |
|------|------|
| API 调用失败 | 捕获异常，打印红色错误信息，不崩溃，继续 REPL |
| 工具执行异常 | 异常信息作为 tool_result 回传给 LLM |
| 环境变量缺失 | `ANTHROPIC_API_KEY` 缺失时 SDK 自动报错；`MODEL_ID` 有默认值 |

---

## 3. S02 功能规格 —— "Adding a tool means adding one handler"

核心理念：loop 不变，新工具注册到 tools 对象。添加工具 = 添加一个 handler + 一个 Zod schema。

### 3.1 新增工具

#### read_file

| 属性 | 规格 |
|------|------|
| 工具名 | `read_file` |
| 参数 | `{ path: string, limit?: number }` |
| 行为 | 读取文件全部内容；若指定 `limit`，只返回前 N 行，追加 `"... (M more lines)"` |
| 输出截断 | 最多 50,000 字符 |
| 路径安全 | 经过 `safePath()` 校验 |
| 异常处理 | 返回 `"Error: {message}"` |

#### write_file

| 属性 | 规格 |
|------|------|
| 工具名 | `write_file` |
| 参数 | `{ path: string, content: string }` |
| 行为 | 写入文件内容，自动创建父目录 |
| 成功返回 | `"Wrote {N} bytes to {path}"` |
| 路径安全 | 经过 `safePath()` 校验 |
| 异常处理 | 返回 `"Error: {message}"` |

#### edit_file

| 属性 | 规格 |
|------|------|
| 工具名 | `edit_file` |
| 参数 | `{ path: string, old_text: string, new_text: string }` |
| 行为 | 替换文件中精确匹配的文本（仅第一次出现） |
| 未找到 | 返回 `"Error: Text not found in {path}"` |
| 成功返回 | `"Edited {path}"` |
| 路径安全 | 经过 `safePath()` 校验 |
| 异常处理 | 返回 `"Error: {message}"` |

### 3.2 路径沙箱 — safePath()

```typescript
function safePath(p: string): string
```

- 将相对路径解析为绝对路径（基于 `process.cwd()`）
- 检查解析后路径是否在工作目录内
- 越界抛出 `Error("Path escapes workspace: {p}")`

### 3.3 System Prompt 变更

由 S01 的 `"Use bash to solve tasks"` 改为 `"Use tools to solve tasks"`。

### 3.4 REPL 提示符

由 `s01 >>` 改为 `s02 >>`。

### 3.5 S01 → S02 差异总览

| 组件 | S01 | S02 |
|------|-----|-----|
| Tools | 1 (bash) | 4 (bash, read_file, write_file, edit_file) |
| 路径安全 | 无 | `safePath()` 沙箱 |
| Agent loop | generateText + maxSteps | 不变 |
| 依赖 | 无新增 | 无新增 |

### 3.6 边界与约束

- S02 为独立文件 `src/s02_tool_use.ts`，不修改 S01
- bash 工具保持 S01 逻辑不变
- 仅处理 UTF-8 文本文件，不处理二进制文件

---

## 4. 技术架构

### 3.1 目录结构

```
Claude-Code-TS/
├── .github/
│   └── copilot-instructions.md
├── docs/
│   ├── spec.md                          # 产品规格书
│   └── contracts/
│       └── sprint-1-contract.md         # Sprint 验收合同
├── src/
│   ├── s01_agent_loop.ts               # S01 实现
│   └── s02_tool_use.ts                 # S02 实现
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

### 3.2 依赖列表

| 包名 | 版本范围 | 用途 |
|------|---------|------|
| `ai` | `^4.3.0` | Vercel AI SDK 核心 |
| `@ai-sdk/anthropic` | `^1.2.0` | Anthropic provider |
| `zod` | `^3.24.0` | 工具参数 schema |
| `dotenv` | `^16.4.0` | 环境变量加载 |
| `typescript` | `^5.7.0` | (dev) 类型检查 |
| `tsx` | `^4.19.0` | (dev) 直接运行 TS |
| `@types/node` | `^22.0.0` | (dev) Node 类型 |

### 3.3 配置规格

**tsconfig.json:**
- `target`: ES2022
- `module`: ESNext
- `moduleResolution`: bundler
- `strict`: true
- `outDir`: dist
- `rootDir`: src

**package.json scripts:**
- `build`: `tsc`
- `s01`: `tsx src/s01_agent_loop.ts`
- `s02`: `tsx src/s02_tool_use.ts`

**环境变量 (.env):**
- `ANTHROPIC_API_KEY` — 必需
- `MODEL_ID` — 可选，默认 `claude-sonnet-4-6`
- `ANTHROPIC_BASE_URL` — 可选，用于兼容 provider

---

## 4. 验收标准

### 功能验收

- [ ] AC-01: `npm run s01` 启动 REPL，显示提示符
- [ ] AC-02: 输入自然语言任务，LLM 自主调用 bash 工具执行命令
- [ ] AC-03: 工具调用结果回传 LLM，LLM 可基于结果继续调用或生成回答
- [ ] AC-04: 多轮对话上下文保持（第二轮可引用第一轮的内容）
- [ ] AC-05: 输入 `q` / `exit` / 空行正常退出
- [ ] AC-06: Ctrl+C / Ctrl+D 不崩溃，优雅退出

### 安全验收

- [ ] AC-07: 输入涉及 `rm -rf /` 的任务，bash 工具返回拦截信息
- [ ] AC-08: 超时命令（如 `sleep 200`）在 120s 后返回超时错误

### 代码质量

- [ ] AC-09: `npx tsc --noEmit` 零错误
- [ ] AC-10: 单文件实现，不超过 150 行
- [ ] AC-11: 使用 ESM (`"type": "module"`)
- [ ] AC-12: 无 `any` 类型（除异常捕获的 `unknown` 处理）

### S02 功能验收

- [ ] AC-13: `npm run s02` 启动 REPL，显示 `s02 >>` 提示符
- [ ] AC-14: `read_file` 能读取工作目录下的文件并返回内容
- [ ] AC-15: `read_file` 的 `limit` 参数能限制返回行数
- [ ] AC-16: `write_file` 能创建新文件（含自动建父目录）
- [ ] AC-17: `edit_file` 能精确替换文件中的文本
- [ ] AC-18: `edit_file` 找不到目标文本时返回错误信息
- [ ] AC-19: `safePath()` 阻止访问工作目录之外的路径
- [ ] AC-20: bash 工具保持 S01 行为不变
- [ ] AC-21: `npx tsc --noEmit` 对 s02_tool_use.ts 零错误
- [ ] AC-22: 单文件实现，无新增依赖

---

## 5. Sprint 计划

| Sprint | 内容 | 交付物 |
|--------|------|--------|
| Sprint-1 | Agent Loop + Bash Tool + REPL | `src/s01_agent_loop.ts` + 配置文件 |
| Sprint-2 | Tool Use: read_file, write_file, edit_file + 路径沙箱 | `src/s02_tool_use.ts` |

---

## 6. 待定决策

| 编号 | 问题 | 建议 |
|------|------|------|
| D-01 | 默认模型 | `claude-sonnet-4-6`，通过 `MODEL_ID` 环境变量可覆盖 |
| D-02 | 流式 vs 非流式 | S01 使用非流式 `generateText`，后续 Sprint 可切换 |
| D-03 | 终端格式化 | 使用 ANSI escape codes，不引入第三方 CLI 库 |
| D-04 | 二进制文件处理 | S02 仅处理 UTF-8 文本，后续可扩展 |
| D-05 | 文件工具输出显示 | 工具调用使用 `> {tool_name}: {preview}` 格式 |
