import chalk from "chalk";

// ---------------------------------------------------------------------------
// Spinner — shown during LLM "thinking" before first token arrives
// ---------------------------------------------------------------------------

let spinnerInterval: ReturnType<typeof setInterval> | null = null;
let spinnerFrame = 0;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let _spinnerText = "";

export function startSpinner(text: string): void {
  if (spinnerInterval) return;
  _spinnerText = text;
  spinnerFrame = 0;
  process.stderr.write(chalk.cyan(`${SPINNER_FRAMES[0]} ${text}`));
  spinnerInterval = setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
    process.stderr.write(`\r${chalk.cyan(`${SPINNER_FRAMES[spinnerFrame]} ${_spinnerText}`)}`);
  }, 80);
}

export function stopSpinner(): void {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
    // Clear the spinner line
    process.stderr.write("\r\x1b[K");
  }
}

// ---------------------------------------------------------------------------
// Streaming text rendering with markdown syntax highlighting
// ---------------------------------------------------------------------------

let _codeFence = false;
let _codeFenceLang = "";
let _buffer = "";

/**
 * Reset the markdown parser state (call between responses).
 */
export function resetMarkdownState(): void {
  _codeFence = false;
  _codeFenceLang = "";
  _buffer = "";
}

/**
 * Render a single text delta chunk with real-time markdown highlighting.
 * Code blocks and headings are colorised as complete lines arrive.
 */
export function renderTextDelta(text: string): void {
  stopSpinner();

  // Accumulate and process line by line
  _buffer += text;
  const lines = _buffer.split("\n");

  // Keep the last (potentially incomplete) line in the buffer
  _buffer = lines.pop() ?? "";

  for (const line of lines) {
    processLine(line);
  }
}

function processLine(line: string): void {
  // Code fence detection
  const fenceMatch = line.match(/^(```+|~~~+)(\w*)/);
  if (fenceMatch) {
    if (!_codeFence) {
      _codeFence = true;
      _codeFenceLang = fenceMatch[2] || "";
      const langTag = _codeFenceLang ? chalk.yellow(` ${_codeFenceLang}`) : "";
      process.stdout.write(chalk.magenta("```") + langTag + "\n");
    } else {
      _codeFence = false;
      _codeFenceLang = "";
      process.stdout.write(chalk.magenta("```") + "\n");
    }
    return;
  }

  if (_codeFence) {
    // Inside a code block — render with a subtle tint
    process.stdout.write(chalk.hex("#888")(line) + "\n");
    return;
  }

  // Markdown headings
  const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const color = level === 1 ? chalk.bold.cyan : level === 2 ? chalk.bold.blue : chalk.bold.green;
    process.stdout.write(color(line) + "\n");
    return;
  }

  // Inline code: `code`
  const inlineCoded = line.replace(/`([^`]+)`/g, (_, code) => chalk.cyan(code));
  // Bold: **text**
  const bolded = inlineCoded.replace(/\*\*([^*]+)\*\*/g, (_, text) => chalk.bold(text));

  // List items
  const listMatch = bolded.match(/^(\s*[-*+]\s+)/);
  if (listMatch) {
    process.stdout.write(chalk.green(listMatch[1]) + bolded.slice(listMatch[1].length) + "\n");
    return;
  }

  // Numbered list
  const numListMatch = bolded.match(/^(\s*\d+[.)]\s+)/);
  if (numListMatch) {
    process.stdout.write(chalk.yellow(numListMatch[1]) + bolded.slice(numListMatch[1].length) + "\n");
    return;
  }

  process.stdout.write(bolded + "\n");
}

/** Flush any remaining buffered text and reset state. */
export function renderTextComplete(): void {
  if (_buffer) {
    processLine(_buffer);
    _buffer = "";
  } else {
    process.stdout.write("\n");
  }
  _codeFence = false;
  _codeFenceLang = "";
}

// ---------------------------------------------------------------------------
// Tool call / result rendering
// ---------------------------------------------------------------------------

export function renderToolStart(
  name: string,
  args: Record<string, unknown>,
): void {
  const argsStr = Object.entries(args)
    .map(([k, v]) => {
      const val = String(v);
      return `${k}=${val.length > 80 ? val.slice(0, 77) + "..." : val}`;
    })
    .join(", ");
  process.stderr.write(chalk.cyan(`[${name}]`) + ` ${argsStr}\n`);
}

export function renderToolResult(
  name: string,
  result: string,
  isError?: boolean,
): void {
  const lines = result.split("\n").slice(0, 10).join("\n");
  const truncated =
    result.split("\n").length > 10 ? "\n... (truncated)" : "";
  const prefix = isError
    ? chalk.red(`[${name} ERROR]`)
    : chalk.green(`[${name}]`);
  process.stderr.write(`${prefix} ${lines}${truncated}\n`);
}

// ---------------------------------------------------------------------------
// Info / Error / Progress
// ---------------------------------------------------------------------------

export function renderError(message: string): void {
  process.stderr.write(chalk.red(`✖ ${message}\n`));
}

export function renderInfo(message: string): void {
  process.stderr.write(chalk.gray(`▸ ${message}\n`));
}

export function renderSuccess(message: string): void {
  process.stderr.write(chalk.green(`✔ ${message}\n`));
}

/** Render a simple progress bar (e.g. "Step 3/10") to stderr. */
export function renderProgress(current: number, total: number): void {
  const width = 16;
  const progress = Math.min(Math.round((current / total) * width), width);
  const bar = "█".repeat(progress) + "░".repeat(width - progress);
  const pct = Math.round((current / total) * 100);
  process.stderr.write(`  ${chalk.gray(`[${bar}] ${pct}%`)}  `);
}

/** Render a section divider for readability. */
export function renderDivider(): void {
  process.stderr.write(chalk.gray("─".repeat(40)) + "\n");
}

// ---------------------------------------------------------------------------
// Confirm prompt
// ---------------------------------------------------------------------------

export type ConfirmResult = boolean | "all";

let _confirmRL: import("node:readline").Interface | null = null;

export function closeConfirmReadline(): void {
  if (_confirmRL) {
    _confirmRL.close();
    _confirmRL = null;
  }
}

export async function confirmAction(
  message: string,
): Promise<ConfirmResult> {
  if (!_confirmRL) {
    const readline = await import("node:readline");
    _confirmRL = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
  }

  return new Promise((resolve) => {
    _confirmRL!.question(chalk.yellow(`${message} [y/n/a]: `), (answer) => {
      const lower = answer.trim().toLowerCase();
      if (lower === "a" || lower === "all") {
        resolve("all");
      } else if (lower === "y" || lower === "yes") {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}
