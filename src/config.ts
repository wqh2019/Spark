import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import "dotenv/config";

export interface SparkConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  maxSteps: number;
  autoApprove: string[];
}

const SPARK_DIR = join(homedir(), ".spark");
const CONFIG_PATH = join(SPARK_DIR, "config.json");

function loadConfigFile(): Partial<SparkConfig> {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function parseAutoApprove(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function loadConfig(overrides: Partial<SparkConfig> = {}): SparkConfig {
  const apiKey = overrides.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required but not set");
  }

  const fileConfig = loadConfigFile();

  const maxStepsFromEnv = process.env.SPARK_MAX_STEPS
    ? parseInt(process.env.SPARK_MAX_STEPS, 10)
    : undefined;

  return {
    apiKey,
    baseURL:
      overrides.baseURL ??
      process.env.OPENAI_BASE_URL ??
      fileConfig.baseURL ??
      "https://api.openai.com/v1",
    model:
      overrides.model ??
      process.env.OPENAI_MODEL ??
      fileConfig.model ??
      "gpt-4",
    maxSteps: overrides.maxSteps ?? maxStepsFromEnv ?? fileConfig.maxSteps ?? 20,
    autoApprove:
      overrides.autoApprove ??
      parseAutoApprove(process.env.SPARK_AUTO_APPROVE) ??
      fileConfig.autoApprove ??
      [],
  };
}

export function ensureSparkDir(): string {
  if (!existsSync(SPARK_DIR)) {
    mkdirSync(SPARK_DIR, { recursive: true });
  }
  return SPARK_DIR;
}

export function getSessionsDir(): string {
  const dir = join(ensureSparkDir(), "sessions");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
