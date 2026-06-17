import chalk from "chalk";

export function renderTextDelta(text: string): void {
  process.stdout.write(text);
}

export function renderTextComplete(): void {
  process.stdout.write("\n");
}

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

export function renderError(message: string): void {
  process.stderr.write(chalk.red(`Error: ${message}\n`));
}

export function renderInfo(message: string): void {
  process.stderr.write(chalk.gray(`${message}\n`));
}

export type ConfirmResult = boolean | "all";

export async function confirmAction(
  message: string,
): Promise<ConfirmResult> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    rl.question(chalk.yellow(`${message} [y/n/a]: `), (answer) => {
      rl.close();
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
