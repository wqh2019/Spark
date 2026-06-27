import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

let currentLevel = LogLevel.WARN;
const logDir = join(homedir(), ".spark", "logs");

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function getLogFile(): string {
  const date = new Date().toISOString().slice(0, 10);
  return join(logDir, `spark-${date}.log`);
}

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

function write(level: string, msg: string): void {
  if (!existsSync(logDir)) {
    try {
      mkdirSync(logDir, { recursive: true });
    } catch {
      return;
    }
  }
  const timestamp = new Date().toISOString();
  const truncated =
    msg.length > 500
      ? msg.slice(0, 500) + `... (${msg.length} total chars)`
      : msg;
  try {
    appendFileSync(
      getLogFile(),
      `[${timestamp}] [${level}] ${truncated}\n`,
      "utf-8",
    );
  } catch {
    // Silent fail for logging itself
  }
}

export const logger: Logger = {
  debug(msg: string): void {
    if (currentLevel <= LogLevel.DEBUG) write("DEBUG", msg);
  },
  info(msg: string): void {
    if (currentLevel <= LogLevel.INFO) write("INFO", msg);
  },
  warn(msg: string): void {
    if (currentLevel <= LogLevel.WARN) write("WARN", msg);
  },
  error(msg: string): void {
    if (currentLevel <= LogLevel.ERROR) write("ERROR", msg);
  },
};
