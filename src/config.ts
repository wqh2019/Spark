import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import "dotenv/config";

export interface SparkConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  maxSteps: number;
  autoApprove: string[];
  llmTimeout?: number;
}

const SPARK_DIR = join(homedir(), ".spark");
const HOME_CONFIG_PATH = join(SPARK_DIR, "config.json");

/** Read a JSON config file, returning {} on any failure. */
function readJSON(path: string): Record<string, unknown> {
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8"));
    }
  } catch {
    // ignore malformed files
  }
  return {};
}

/**
 * Load config from two JSON files, merged left-to-right (local overrides home):
 *   1. ~/.spark/config.json         (global user config)
 *   2. <cwd>/.spark.json             (per-project config)
 */
function loadConfigFiles(cwd?: string): Partial<SparkConfig> {
  const home = readJSON(HOME_CONFIG_PATH) as Partial<SparkConfig>;
  const local = cwd ? readJSON(join(cwd, ".spark.json")) as Partial<SparkConfig> : {};
  return { ...home, ...local };
}

/**
 * Create a default config template at ~/.spark/config.json.
 * Called automatically on first run when no API key is found.
 */
export function createDefaultConfig(): void {
  ensureSparkDir();
  if (existsSync(HOME_CONFIG_PATH)) return; // don't overwrite existing

  const template = {
    apiKey: "sk-your-key-here",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o",
    maxSteps: 20,
    autoApprove: [] as string[],
  };

  writeFileSync(HOME_CONFIG_PATH, JSON.stringify(template, null, 2), "utf-8");
}

function parseAutoApprove(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function loadConfig(overrides: Partial<SparkConfig> = {}): SparkConfig {
  // File configs (home ~/.spark/config.json + local .spark.json)
  const fileConfig = loadConfigFiles(overrides.baseURL ? undefined : process.cwd());

  // Priority: CLI args > env vars > local .spark.json > ~/.spark/config.json > defaults
  const apiKey =
    overrides.apiKey ??
    process.env.OPENAI_API_KEY ??
    fileConfig.apiKey;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required but not set.\n\n" +
      "To configure, create ~/.spark/config.json with:\n" +
      '  { "apiKey": "sk-your-key-here", "model": "gpt-4o" }\n\n' +
      "Or set the key via:\n" +
      "  Environment variable:  set OPENAI_API_KEY=sk-xxx\n" +
      "  CLI argument:          spark --api-key sk-xxx \"your query\"\n" +
      `  (Tip: run "spark --setup" to generate the config file automatically)`,
    );
  }

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
    maxSteps:
      overrides.maxSteps ??
      maxStepsFromEnv ??
      fileConfig.maxSteps ??
      20,
    autoApprove:
      overrides.autoApprove ??
      parseAutoApprove(process.env.SPARK_AUTO_APPROVE) ??
      fileConfig.autoApprove ??
      [],
    llmTimeout: overrides.llmTimeout ?? fileConfig.llmTimeout ?? 120_000,
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

export function getCheckpointsDir(): string {
  const dir = join(ensureSparkDir(), "checkpoints");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
