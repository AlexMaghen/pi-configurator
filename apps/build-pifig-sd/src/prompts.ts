/**
 * Terminal questions: a line of text, a yes/no, and a password typed without showing it.
 * Works in Terminal on the Mac and in PowerShell / Command Prompt on Windows. When input isn't
 * a terminal (piped, for tests), lines are read plainly.
 */
import { createInterface } from "node:readline";

const lines: string[] = [];
let waiting: ((line: string | undefined) => void) | undefined;
let closed = false;
let reader: ReturnType<typeof createInterface> | undefined;

/** Piped input: lines are queued so each question takes the next one. */
function readerForPipe() {
  if (reader) return;
  reader = createInterface({ input: process.stdin, terminal: false });
  reader.on("line", (line) => (waiting ? (waiting(line), (waiting = undefined)) : lines.push(line)));
  reader.on("close", () => {
    closed = true;
    waiting?.(undefined);
  });
}

function nextPipedLine(): Promise<string | undefined> {
  readerForPipe();
  if (lines.length > 0) return Promise.resolve(lines.shift());
  if (closed) return Promise.resolve(undefined);
  return new Promise((resolve) => (waiting = resolve));
}

export async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    process.stdout.write(question);
    const line = await nextPipedLine();
    process.stdout.write("\n");
    if (line === undefined) throw new Error("no more input");
    return line;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    // readline draws the question itself, so its redraws while typing keep it on screen.
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function confirm(question: string): Promise<boolean> {
  const answer = (await ask(`${question} [y/N] `)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

/** Reads a password showing one * per character. Backspace works; Ctrl-C quits. */
export async function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) return ask(question);
  const stdin = process.stdin;
  // Raw mode (no echo) before the question appears, so nothing typed early shows in clear.
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  process.stdout.write(question);
  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (ch >= " ") {
          value += ch;
          process.stdout.write("*");
        }
      }
    };
    stdin.on("data", onData);
  });
}
