/**
 * S02 - Tool Use：在 S01 基础上扩展文件操作工具
 *
 * 新增工具：
 *   - read_file   读取文件内容（支持行数限制）
 *   - write_file  写入文件（自动创建父目录）
 *   - edit_file   替换文件中指定文本（仅替换首次出现）
 *
 * 安全措施：
 *   - 所有文件路径经过 safePath() 沙箱检查，禁止逃逸出工作目录
 *   - bash 命令沿用 S01 的危险命令拦截
 */

import "dotenv/config";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";
import { resolve, relative, dirname } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { generateText, type CoreMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

// ── 常量 ──────────────────────────────────────────────

/** 单次工具输出最大字符数，防止上下文爆炸 */
const MAX_OUTPUT = 50_000;
/** 终端预览截断长度 */
const PREVIEW_LEN = 200;
/** bash 命令超时时间（ms） */
const TIMEOUT_MS = 120_000;
/** 单轮对话最大 tool-use 步数 */
const MAX_STEPS = 30;
/** 是否启用 ANSI 颜色输出 */
const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
/** 锁定的工作目录，所有路径操作基于此 */
const WORKDIR = process.cwd();
/** 需要拦截的危险命令关键词正则 */
const BLOCKED_KEYWORD_RULES: ReadonlyArray<RegExp> = [/\bsudo\b/, /\bshutdown\b/, /\breboot\b/, />\s*\/dev\//];

// ── 终端颜色 ──────────────────────────────────────────

const ANSI = {
  reset: "\x1b[0m",
  fg: { red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" },
} as const;

type FgColor = keyof typeof ANSI.fg;

// ── LLM 配置 ─────────────────────────────────────────

const provider = createAnthropic({ baseURL: process.env.ANTHROPIC_BASE_URL });
const model = provider(process.env.MODEL_ID ?? "claude-sonnet-4-6");
const system = `You are a coding agent at ${WORKDIR}. Use tools to solve tasks. Act, don't explain.`;

// ── 辅助函数 ─────────────────────────────────────────

/** 给文本着色，非 TTY 环境不着色 */
function paint(text: string, color: FgColor): string {
  if (!USE_COLOR) return text;
  return `${ANSI.fg[color]}${text}${ANSI.reset}`;
}

/** 在终端打印截断后的预览 */
function preview(text: string): void {
  console.log(text.slice(0, PREVIEW_LEN) + (text.length > PREVIEW_LEN ? "..." : ""));
}

// ── 路径沙箱 ─────────────────────────────────────────

/**
 * 将相对路径解析为绝对路径，并校验不超出工作目录。
 * 防止 `../../etc/passwd` 之类的路径穿越攻击。
 */
function safePath(p: string): string {
  const resolved = resolve(WORKDIR, p);
  const rel = relative(WORKDIR, resolved);
  // Reject parent traversal and absolute rel paths (e.g., different drive letters on Windows).
  if (rel === ".." || rel.startsWith(`..${"/"}`) || rel.startsWith(`..${"\\"}`)) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  if (resolve(WORKDIR, rel) !== resolved) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  return resolved;
}

// ── 命令安全检查 ──────────────────────────────────────

/** 检测 `rm -rf /` 这类毁灭性命令 */
function hasDangerousRmRoot(command: string): boolean {
  const hasRm = /\brm\b/.test(command);
  const hasRootTarget = /(^|\s)\/(\s|$)/.test(command);
  const hasRfOrFrFlag = /(^|\s)-[^\s]*r[^\s]*f[^\s]*(\s|$)|(^|\s)-[^\s]*f[^\s]*r[^\s]*(\s|$)/.test(command);
  return hasRm && hasRootTarget && hasRfOrFrFlag;
}

/** 综合判断命令是否应被拦截 */
function isDangerousCommand(rawCommand: string): boolean {
  const command = rawCommand.trim().toLowerCase();
  return hasDangerousRmRoot(command) || BLOCKED_KEYWORD_RULES.some((rule) => rule.test(command));
}

// ── Bash 工具实现 ────────────────────────────────────

/** 执行 bash 命令并返回截断后的输出，危险命令直接拒绝 */
function runBash(command: string): string {
  console.log(paint(`$ ${command}`, "yellow"));
  if (isDangerousCommand(command)) return "Error: Dangerous command blocked";
  try {
    const raw = execSync(command, {
      cwd: WORKDIR,
      timeout: TIMEOUT_MS,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out = raw ? raw.slice(0, MAX_OUTPUT) : "(no output)";
    preview(out);
    return out;
  } catch (err: unknown) {
    const e = err as { killed?: boolean; stdout?: string; stderr?: string };
    if (e.killed) return "Error: Timeout (120s)";
    const combined = ((e.stdout ?? "") + (e.stderr ?? "")).slice(0, MAX_OUTPUT) || "(no output)";
    preview(combined);
    return combined;
  }
}

// ── 文件工具实现 ─────────────────────────────────────

/** 读取文件内容，可通过 limit 限制返回行数 */
function runReadFile(path: string, limit?: number): string {
  try {
    const fp = safePath(path);
    const text = readFileSync(fp, "utf-8");
    const lines = text.split("\n");
    if (limit && limit < lines.length) {
      const truncated = lines.slice(0, limit);
      truncated.push(`... (${lines.length - limit} more lines)`);
      return truncated.join("\n").slice(0, MAX_OUTPUT);
    }
    return text.slice(0, MAX_OUTPUT);
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** 写入文件，自动递归创建不存在的父目录 */
function runWriteFile(path: string, content: string): string {
  try {
    const fp = safePath(path);
    mkdirSync(dirname(fp), { recursive: true });
    writeFileSync(fp, content, "utf-8");
    return `Wrote ${content.length} bytes to ${path}`;
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** 在文件中查找 oldText 并替换为 newText（仅首次出现） */
function runEditFile(path: string, oldText: string, newText: string): string {
  try {
    const fp = safePath(path);
    const content = readFileSync(fp, "utf-8");
    if (!content.includes(oldText)) {
      return `Error: Text not found in ${path}`;
    }
    writeFileSync(fp, content.replace(oldText, newText), "utf-8");
    return `Edited ${path}`;
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── 工具定义 ─────────────────────────────────────────

const tools = {
  bash: {
    description: "Run a bash command",
    parameters: z.object({ command: z.string() }),
    execute: async ({ command }: { command: string }) => runBash(command),
  },
  read_file: {
    description: "Read file contents. Returns the text content of the file.",
    parameters: z.object({ path: z.string(), limit: z.number().optional() }),
    execute: async ({ path, limit }: { path: string; limit?: number }) => {
      const result = runReadFile(path, limit);
      console.log(paint(`> read_file: ${result.slice(0, PREVIEW_LEN)}`, "yellow"));
      return result;
    },
  },
  write_file: {
    description: "Write content to a file. Creates parent directories if needed.",
    parameters: z.object({ path: z.string(), content: z.string() }),
    execute: async ({ path, content }: { path: string; content: string }) => {
      const result = runWriteFile(path, content);
      console.log(paint(`> write_file: ${result}`, "yellow"));
      return result;
    },
  },
  edit_file: {
    description: "Replace exact text in a file. Only the first occurrence is replaced.",
    parameters: z.object({ path: z.string(), old_text: z.string(), new_text: z.string() }),
    execute: async ({ path, old_text, new_text }: { path: string; old_text: string; new_text: string }) => {
      const result = runEditFile(path, old_text, new_text);
      console.log(paint(`> edit_file: ${result}`, "yellow"));
      return result;
    },
  },
};

// ── REPL 主循环 ──────────────────────────────────────

async function main() {
  const messages: CoreMessage[] = [];
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  process.on("SIGINT", () => process.exit(0));

  /** 读取一行用户输入，EOF / close 时返回 null */
  const ask = (): Promise<string | null> =>
    new Promise((resolve) => {
      const onClose = () => resolve(null);
      rl.once("close", onClose);
      rl.question(paint("s02 >> ", "cyan"), (answer) => {
        rl.off("close", onClose);
        resolve(answer);
      });
    });

  // 主循环：读取输入 → 调用 LLM → 输出结果
  while (true) {
    const input = await ask();
    if (input === null || input === "" || input === "q" || input === "exit") break;
    messages.push({ role: "user", content: input });
    try {
      const result = await generateText({ model, system, messages, tools, maxSteps: MAX_STEPS });
      if (result.text) console.log(result.text);
      messages.push(...result.response.messages);
    } catch (err: unknown) {
      console.error(paint(`Error: ${err instanceof Error ? err.message : String(err)}`, "red"));
    }
  }
  rl.close();
}

main();
