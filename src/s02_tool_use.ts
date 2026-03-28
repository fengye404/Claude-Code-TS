import "dotenv/config";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { generateText, type CoreMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const MAX_OUTPUT = 50_000;
const PREVIEW_LEN = 200;
const TIMEOUT_MS = 120_000;
const MAX_STEPS = 30;
const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const WORKDIR = process.cwd();
const BLOCKED_KEYWORD_RULES: ReadonlyArray<RegExp> = [/\bsudo\b/, /\bshutdown\b/, /\breboot\b/, />\s*\/dev\//];

const ANSI = {
  reset: "\x1b[0m",
  fg: { red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" },
} as const;

type FgColor = keyof typeof ANSI.fg;

const provider = createAnthropic({ baseURL: process.env.ANTHROPIC_BASE_URL });
const model = provider(process.env.MODEL_ID ?? "claude-sonnet-4-6");
const system = `You are a coding agent at ${WORKDIR}. Use tools to solve tasks. Act, don't explain.`;

function paint(text: string, color: FgColor): string {
  if (!USE_COLOR) return text;
  return `${ANSI.fg[color]}${text}${ANSI.reset}`;
}

function preview(text: string): void {
  console.log(text.slice(0, PREVIEW_LEN) + (text.length > PREVIEW_LEN ? "..." : ""));
}

// --- Path sandbox ---

function safePath(p: string): string {
  const resolved = resolve(WORKDIR, p);
  if (!resolved.startsWith(WORKDIR)) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  return resolved;
}

// --- Tool handlers ---

function hasDangerousRmRoot(command: string): boolean {
  const hasRm = /\brm\b/.test(command);
  const hasRootTarget = /(^|\s)\/(\s|$)/.test(command);
  const hasRfOrFrFlag = /(^|\s)-[^\s]*r[^\s]*f[^\s]*(\s|$)|(^|\s)-[^\s]*f[^\s]*r[^\s]*(\s|$)/.test(command);
  return hasRm && hasRootTarget && hasRfOrFrFlag;
}

function isDangerousCommand(rawCommand: string): boolean {
  const command = rawCommand.trim().toLowerCase();
  return hasDangerousRmRoot(command) || BLOCKED_KEYWORD_RULES.some((rule) => rule.test(command));
}

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

function runWriteFile(path: string, content: string): string {
  try {
    const fp = safePath(path);
    mkdirSync(resolve(fp, ".."), { recursive: true });
    writeFileSync(fp, content, "utf-8");
    return `Wrote ${content.length} bytes to ${path}`;
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

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

// --- Tools ---

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

// --- REPL ---

async function main() {
  const messages: CoreMessage[] = [];
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  process.on("SIGINT", () => process.exit(0));

  const ask = (): Promise<string | null> =>
    new Promise((resolve) => {
      const onClose = () => resolve(null);
      rl.once("close", onClose);
      rl.question(paint("s02 >> ", "cyan"), (answer) => {
        rl.off("close", onClose);
        resolve(answer);
      });
    });

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
