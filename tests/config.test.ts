import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("loads defaults when only API key is set", () => {
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
    delete process.env.SPARK_MAX_STEPS;
    delete process.env.SPARK_AUTO_APPROVE;

    const config = loadConfig();
    expect(config.apiKey).toBe("test-key");
    expect(config.baseURL).toBe("https://api.openai.com/v1");
    expect(config.model).toBe("gpt-4");
    expect(config.maxSteps).toBe(20);
    expect(config.autoApprove).toEqual([]);
  });

  it("reads OPENAI_BASE_URL from env", () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = "http://localhost:11434/v1";

    const config = loadConfig();
    expect(config.baseURL).toBe("http://localhost:11434/v1");
  });

  it("reads OPENAI_MODEL from env", () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "gpt-3.5-turbo";

    const config = loadConfig();
    expect(config.model).toBe("gpt-3.5-turbo");
  });

  it("reads SPARK_MAX_STEPS from env", () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.SPARK_MAX_STEPS = "5";

    const config = loadConfig();
    expect(config.maxSteps).toBe(5);
  });

  it("reads SPARK_AUTO_APPROVE from env as comma-separated list", () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.SPARK_AUTO_APPROVE = "read_file, write_file";

    const config = loadConfig();
    expect(config.autoApprove).toEqual(["read_file", "write_file"]);
  });

  it("throws error when OPENAI_API_KEY is not set", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => loadConfig()).toThrow("OPENAI_API_KEY is required");
  });

  it("CLI overrides take precedence over env vars", () => {
    process.env.OPENAI_API_KEY = "env-key";
    process.env.OPENAI_BASE_URL = "http://env-url/v1";
    process.env.OPENAI_MODEL = "env-model";

    const config = loadConfig({
      apiKey: "cli-key",
      baseURL: "http://cli-url/v1",
      model: "cli-model",
      maxSteps: 3,
      autoApprove: ["run_command"],
    });

    expect(config.apiKey).toBe("cli-key");
    expect(config.baseURL).toBe("http://cli-url/v1");
    expect(config.model).toBe("cli-model");
    expect(config.maxSteps).toBe(3);
    expect(config.autoApprove).toEqual(["run_command"]);
  });

  it("trims whitespace in SPARK_AUTO_APPROVE values", () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.SPARK_AUTO_APPROVE = "  read_file ,  write_file  ";

    const config = loadConfig();
    expect(config.autoApprove).toEqual(["read_file", "write_file"]);
  });

  it("returns empty autoApprove for empty string", () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.SPARK_AUTO_APPROVE = "  ,  ,  ";

    const config = loadConfig();
    expect(config.autoApprove).toEqual([]);
  });
});
