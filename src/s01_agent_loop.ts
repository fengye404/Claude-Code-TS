/**
 * S01 - Agent Loop：最小可用的 Agent REPL
 *
 * 核心概念：
 *   用户输入 → LLM 生成回复（可能调用 tool）→ 输出结果 → 等待下一轮输入
 *   通过 ai-sdk 的 generateText + maxSteps 实现多步 tool-use 循环。
 *
 * 唯一可用工具：bash —— 在当前工作目录执行 shell 命令。
 * 安全措施：危险命令（sudo / rm -rf / / shutdown 等）会被拦截。
 */

import "dotenv/config";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";
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
/** 需要拦截的危险命令关键词正则 */
const BLOCKED_KEYWORD_RULES: ReadonlyArray<RegExp> = [/\bsudo\b/, /\bshutdown\b/, /\breboot\b/, />\s*\/dev\//];

// ── 终端颜色 ──────────────────────────────────────────

const ANSI = {
  reset: "\x1b[0m",
  fg: {
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
  },
} as const;

type FgColor = keyof typeof ANSI.fg;

// ── LLM 配置 ─────────────────────────────────────────

const provider = createAnthropic({ baseURL: process.env.ANTHROPIC_BASE_URL });
const model = provider(process.env.MODEL_ID ?? "claude-sonnet-4-6");
const system = `You are a coding agent at ${process.cwd()}. Use bash to solve tasks. Act, don't explain.`;

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
      cwd: process.cwd(),
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

// ── 工具定义 ─────────────────────────────────────────

const tools = {
  bash: {
    description: "Run a bash command",
    parameters: z.object({ command: z.string() }),
    execute: async ({ command }: { command: string }) => runBash(command),
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
      rl.question(paint("s01 >> ", "cyan"), (answer) => {
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
