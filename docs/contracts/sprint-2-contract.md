# Sprint-2 合同 — Tool Use

## Sprint 目标

在 S01 Agent Loop 基础上扩展工具集，添加 `read_file`、`write_file`、`edit_file` 三个文件操作工具，并引入路径沙箱机制。核心循环不变。

## 交付物

| 编号 | 交付物 | 说明 |
|------|--------|------|
| D-1 | `src/s02_tool_use.ts` | 包含 4 个工具（bash + 3 个文件工具）的 Agent REPL |
| D-2 | `package.json` 更新 | 添加 `s02` script |
| D-3 | `docs/spec.md` 更新 | 包含 S02 规格（已完成） |

## 验收条目

### 功能验收

| 编号 | 条目 | 验证方法 |
|------|------|---------|
| V-01 | `npm run s02` 启动 REPL，显示 `s02 >>` 提示符 | 运行观察 |
| V-02 | `read_file` 能读取工作目录下的文件 | LLM 调用 read_file 读取 package.json |
| V-03 | `read_file` 的 `limit` 参数限制返回行数 | 读取大文件验证截断 |
| V-04 | `write_file` 能创建新文件并自动建父目录 | LLM 调用 write_file 创建 tmp/test.txt |
| V-05 | `edit_file` 精确替换文件中的文本 | 创建文件后用 edit_file 修改 |
| V-06 | `edit_file` 找不到目标文本时返回错误信息 | 传入不存在的 old_text |
| V-07 | bash 工具保持 S01 行为不变 | 执行 shell 命令验证 |
| V-08 | 多轮对话上下文保持 | 连续操作验证 |

### 安全验收

| 编号 | 条目 | 验证方法 |
|------|------|---------|
| V-09 | `safePath()` 阻止 `../../../etc/passwd` 等越界路径 | 代码审查 + 逻辑验证 |
| V-10 | 符号链接不能绕过沙箱 | `path.resolve()` 解析后检查 |
| V-11 | 危险 bash 命令仍被拦截 | 同 S01 |

### 代码质量

| 编号 | 条目 | 验证方法 |
|------|------|---------|
| V-12 | `npx tsc --noEmit` 零错误 | 运行命令 |
| V-13 | 单文件实现，不超过 200 行 | `wc -l` |
| V-14 | 无新增 npm 依赖 | `package.json` diff |
| V-15 | 无 `any` 类型 | 代码搜索 |

## 实现约束

1. `s02_tool_use.ts` 为独立文件，不修改 `s01_agent_loop.ts`
2. 使用 Vercel AI SDK 的 `tool()` 定义方式 + Zod schema
3. 复用 S01 的 bash 工具逻辑（可复制，不引入共享模块）
4. `safePath()` 使用 `path.resolve()` + `startsWith()` 实现
5. 所有文件工具的错误以字符串形式返回，不抛异常到调用者
6. System prompt 改为 `"Use tools to solve tasks"`

## 完成定义

- [ ] 所有 V-01 ~ V-15 验收条目通过
- [ ] 代码通过类型检查
- [ ] spec.md 包含 S02 规格（已完成）
- [ ] 本合同已创建（已完成）
