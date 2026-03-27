import "dotenv/config";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";
import { generateText, type CoreMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const DANGEROUS = /rm\s+-rf\s+\/|sudo|shutdown|reboot|>\s*\/dev\//;
const MAX_OUTPUT = 50_000;
const PREVIEW_LEN = 200;
const TIMEOUT_MS = 120_000;
const MAX_STEPS = 30;

const provider = createAnthropic({ baseURL: process.env.ANTHROPIC_BASE_URL });
const model = provider(process.env.MODEL_ID ?? "claude-sonnet-4-6");
const system = `You are a coding agent at ${process.cwd()}. Use bash to solve tasks. Act, don't explain.`;

function preview(text: string): void {
  console.log(text.slice(0, PREVIEW_LEN) + (text.length > PREVIEW_LEN ? "..." : ""));
}

function runBash(command: string): string {
  console.log(`\x1b[33m$ ${command}\x1b[0m`);
  if (DANGEROUS.test(command)) return "Error: Dangerous command blocked";
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

const tools = {
  bash: {
    description: "Run a bash command",
    parameters: z.object({ command: z.string() }),
    execute: async ({ command }: { command: string }) => runBash(command),
  },
};

async function main() {
  const messages: CoreMessage[] = [];
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  process.on("SIGINT", () => process.exit(0));

  const ask = (): Promise<string | null> =>
    new Promise((resolve) => {
      const onClose = () => resolve(null);
      rl.once("close", onClose);
      rl.question("\x1b[36ms01 >> \x1b[0m", (answer) => {
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
      console.error(`\x1b[31mError: ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
    }
  }
  rl.close();
}

main();
