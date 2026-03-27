---
sprint: 1
title: "最小可用 Agent Loop (s01)"
status: draft
---

# Sprint 1 验收合同: 最小可用 Agent Loop

## 来源

- 规格书: docs/spec.md
- Sprint 计划: S01 — "One loop & Bash is all you need"

## Sprint 元信息

| 属性 | 值 |
|------|-----|
| Sprint 编号 | 1 |
| 目标 | 交付单文件最小可用 Agent Loop，具备 REPL 交互、Bash 工具调用、多轮对话能力 |
| 主入口 | `src/s01_agent_loop.ts` |

### 交付物清单

| # | 交付物 | 路径 |
|---|--------|------|
| D-1 | Agent Loop 实现 | `src/s01_agent_loop.ts` |
| D-2 | 项目配置 | `package.json` |
| D-3 | TypeScript 配置 | `tsconfig.json` |
| D-4 | 环境变量模板 | `.env.example` |
| D-5 | Git 忽略规则 | `.gitignore` |

---

## 验收检查清单

### 项目工程化

- [ ] AC-01: `package.json` 存在，`type` 字段为 `"module"`（ESM）
- [ ] AC-02: `package.json` 中 `scripts.s01` 值为 `tsx src/s01_agent_loop.ts`
- [ ] AC-03: `package.json` 中 `scripts.build` 值为 `tsc`
- [ ] AC-04: 运行时依赖包含 `ai`、`@ai-sdk/anthropic`、`zod`、`dotenv`，版本范围符合规格书
- [ ] AC-05: 开发依赖包含 `typescript`、`tsx`、`@types/node`，版本范围符合规格书
- [ ] AC-06: `tsconfig.json` 配置 `strict: true`、`module: ESNext`、`target: ES2022`、`moduleResolution: bundler`
- [ ] AC-07: `.env.example` 包含 `ANTHROPIC_API_KEY=` 和 `MODEL_ID=` 占位
- [ ] AC-08: `.gitignore` 包含 `node_modules/`、`dist/`、`.env`

### 类型安全 & 编译

- [ ] AC-09: `npx tsc --noEmit` 零错误零警告退出
- [ ] AC-10: 源码中无 `any` 类型（`grep -r "any" src/` 仅匹配注释或字符串，不匹配类型标注）
- [ ] AC-11: `src/s01_agent_loop.ts` 行数 ≤ 150 行（`wc -l` 验证）

### REPL 交互

- [ ] AC-12: `npm run s01` 成功启动，终端显示青色提示符 `s01 >> `（ANSI 序列 `\x1b[36m`）
- [ ] AC-13: 输入 `q` 后程序正常退出（exit code 0）
- [ ] AC-14: 输入 `exit` 后程序正常退出
- [ ] AC-15: 输入空行（直接回车）后程序正常退出
- [ ] AC-16: 按 Ctrl+C 程序优雅退出，无未捕获异常堆栈
- [ ] AC-17: 按 Ctrl+D（EOF）程序优雅退出，无未捕获异常堆栈

### Agent Loop 核心

- [ ] AC-18: 使用 `ai` SDK 的 `generateText` 函数驱动 LLM 调用
- [ ] AC-19: `maxSteps` 设置为 30
- [ ] AC-20: System Prompt 包含当前工作目录（`process.cwd()`）
- [ ] AC-21: 消息历史类型为 `CoreMessage[]`，跨轮次累积（第二轮提问可引用第一轮内容）
- [ ] AC-22: LLM 纯文本回复直接打印到终端

### Bash 工具

- [ ] AC-23: 工具名为 `bash`，参数 schema 使用 Zod 定义 `{ command: z.string() }`
- [ ] AC-24: 工具调用时以黄色前缀打印 `$ {command}`（ANSI 黄色序列）
- [ ] AC-25: 工具输出在终端预览截断为 200 字符
- [ ] AC-26: 工具执行使用 `execSync`，工作目录为 `process.cwd()`
- [ ] AC-27: 命令输出最多保留 50,000 字符返回给 LLM
- [ ] AC-28: 命令无输出时返回字符串 `"(no output)"`

### 危险命令拦截

- [ ] AC-29: 输入包含 `rm -rf /` 的命令，工具返回 `"Error: Dangerous command blocked"`，不实际执行
- [ ] AC-30: 输入包含 `sudo` 的命令，被拦截
- [ ] AC-31: 输入包含 `shutdown`、`reboot` 的命令，被拦截
- [ ] AC-32: 输入包含 `> /dev/` 的命令，被拦截

### 超时 & 错误处理

- [ ] AC-33: 执行超过 120 秒的命令返回 `"Error: Timeout (120s)"`，不崩溃
- [ ] AC-34: 子进程非零退出码时返回 stdout+stderr 合并内容给 LLM
- [ ] AC-35: API 调用失败（如网络错误、key 无效）时打印红色错误信息，REPL 继续运行不崩溃
- [ ] AC-36: 工具执行异常信息作为 tool result 回传给 LLM（不中断 agent loop）

---

## 验证方式

| 验证类型 | 方法 |
|----------|------|
| 静态检查 | `npx tsc --noEmit`；`grep` 检查无 `any`；`wc -l` 检查行数 |
| 工程检查 | 读取 `package.json`、`tsconfig.json` 验证字段值 |
| 启动验证 | `npm run s01` 启动后观察提示符 |
| 退出验证 | 分别输入 `q`、`exit`、空行、Ctrl+C、Ctrl+D 验证退出行为 |
| 工具调用 | 通过 REPL 输入需要执行命令的自然语言请求，观察 LLM 是否调用 bash |
| 拦截验证 | 通过单元级检查或直接向 LLM 请求执行危险命令，确认拦截消息 |
| 超时验证 | 请求执行 `sleep 130` 类命令验证超时返回 |
| 错误恢复 | 临时设置无效 API KEY 验证不崩溃 |

---

## 完成定义 (Definition of Done)

Sprint 1 在以下条件**全部满足**时视为完成：

1. 所有 AC-01 至 AC-36 验收标准通过
2. `npm install && npm run s01` 在干净环境可成功启动
3. 交付物清单中所有文件存在且内容正确
4. 无运行时未捕获异常（正常使用路径下）

---

## 实现约束

| 约束项 | 要求 |
|--------|------|
| 文件数量 | 源码仅 `src/s01_agent_loop.ts` 一个文件 |
| 行数上限 | ≤ 150 行 |
| 模块系统 | ESM（`"type": "module"`） |
| 类型安全 | `strict: true`，无 `any` |
| SDK 用法 | 使用 `generateText` + `maxSteps`，不手写 tool-use 循环 |
| 环境变量 | `ANTHROPIC_API_KEY`（必需）、`MODEL_ID`（可选，有默认值） |
| Node 版本 | ≥ 18 |

---

## 双方备注

- **Generator**: 将按交付物清单顺序创建文件，先搭建工程骨架再实现核心逻辑。危险命令拦截为正则匹配，不做语义分析。
- **Evaluator**: 验收时逐条执行验证方式中的检查项，AC-18 至 AC-22 需要有效 API KEY 进行端到端验证；其余可通过代码审查和静态检查完成。
