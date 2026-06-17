import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Snapshot relevant env vars so we can restore them after each test
    for (const key of [
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
      "OPENAI_MODEL",
      "SPARK_MAX_STEPS",
      "SPARK_AUTO_APPROVE",
    ]) {
      originalEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    // Restore env vars to their original state
    for (const key of Object.keys(originalEnv)) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  function clearSparkEnv() {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
    delete process.env.SPARK_MAX_STEPS;
    delete process.env.SPARK_AUTO_APPROVE;
  }

  it("uses defaults when only OPENAI_API_KEY is set", () => {
    clearSparkEnv();
    process.env.OPENAI_API_KEY = "test-key";

    const config = loadConfig();

    expect(config.apiKey).toBe("test-key");
    expect(config.baseURL).toBe("https://api.openai.com/v1");
    expect(config.model).toBe("gpt-4");
    expect(config.maxSteps).toBe(20);
    expect(config.autoApprove).toEqual([]);
  });

  it("reads all env vars correctly", () => {
    clearSparkEnv();
    process.env.OPENAI_API_KEY = "my-key";
    process.env.OPENAI_BASE_URL = "https://custom.api.com/v1";
    process.env.OPENAI_MODEL = "gpt-3.5-turbo";
    process.env.SPARK_MAX_STEPS = "50";
    process.env.SPARK_AUTO_APPROVE = "read,write,search";

    const config = loadConfig();

    expect(config.apiKey).toBe("my-key");
    expect(config.baseURL).toBe("https://custom.api.com/v1");
    expect(config.model).toBe("gpt-3.5-turbo");
    expect(config.maxSteps).toBe(50);
    expect(config.autoApprove).toEqual(["read", "write", "search"]);
  });

  it("throws if OPENAI_API_KEY is missing", () => {
    clearSparkEnv();

    expect(() => loadConfig()).toThrow(/OPENAI_API_KEY/);
  });

  it("CLI args (overrides) take priority over env vars", () => {
    clearSparkEnv();
    process.env.OPENAI_API_KEY = "env-key";
    process.env.OPENAI_BASE_URL = "https://env.url/v1";
    process.env.OPENAI_MODEL = "gpt-4";
    process.env.SPARK_MAX_STEPS = "10";
    process.env.SPARK_AUTO_APPROVE = "read";

    const config = loadConfig({
      apiKey: "override-key",
      baseURL: "https://override.url/v1",
      model: "gpt-4o",
      maxSteps: 99,
      autoApprove: ["shell", "edit"],
    });

    expect(config.apiKey).toBe("override-key");
    expect(config.baseURL).toBe("https://override.url/v1");
    expect(config.model).toBe("gpt-4o");
    expect(config.maxSteps).toBe(99);
    expect(config.autoApprove).toEqual(["shell", "edit"]);
  });

  it("parses SPARK_MAX_STEPS as integer", () => {
    clearSparkEnv();
    process.env.OPENAI_API_KEY = "key";
    process.env.SPARK_MAX_STEPS = "42";

    const config = loadConfig();

    expect(config.maxSteps).toBe(42);
    expect(typeof config.maxSteps).toBe("number");
  });

  it("handles SPARK_AUTO_APPROVE with empty string as empty array", () => {
    clearSparkEnv();
    process.env.OPENAI_API_KEY = "key";
    process.env.SPARK_AUTO_APPROVE = "";

    const config = loadConfig();

    expect(config.autoApprove).toEqual([]);
  });

  it("allows overrides to fill in missing apiKey without throwing", () => {
    clearSparkEnv();

    const config = loadConfig({ apiKey: "provided-via-override" });

    expect(config.apiKey).toBe("provided-via-override");
    expect(config.baseURL).toBe("https://api.openai.com/v1");
  });

  it("trims whitespace from SPARK_AUTO_APPROVE entries", () => {
    clearSparkEnv();
    process.env.OPENAI_API_KEY = "key";
    process.env.SPARK_AUTO_APPROVE = " read , write , search ";

    const config = loadConfig();

    expect(config.autoApprove).toEqual(["read", "write", "search"]);
  });
});
