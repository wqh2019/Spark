/**
 * Session-level token tracking and cost estimation.
 * Accumulates per-step usage, estimates cost based on model pricing,
 * and provides budget cap checking.
 */

// ---------------------------------------------------------------------------
// Pricing table — per-model input/output costs (USD per 1K tokens)
// ---------------------------------------------------------------------------

interface ModelPrice {
  input: number;  // $ per 1K input tokens
  output: number; // $ per 1K output tokens
}

const MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-4":              { input: 0.03,  output: 0.06 },
  "gpt-4-32k":          { input: 0.06,  output: 0.12 },
  "gpt-4-turbo":        { input: 0.01,  output: 0.03 },
  "gpt-4o":             { input: 0.0025, output: 0.01 },
  "gpt-4o-mini":        { input: 0.00015, output: 0.0006 },
  "gpt-3.5-turbo":      { input: 0.0005, output: 0.0015 },
  "deepseek-coder":     { input: 0.00014, output: 0.00028 },
  "deepseek-chat":      { input: 0.00014, output: 0.00028 },
  "claude-3-opus":      { input: 0.015,  output: 0.075 },
  "claude-3-sonnet":    { input: 0.003,  output: 0.015 },
  "claude-3-haiku":     { input: 0.00025, output: 0.00125 },
  "claude-3.5-sonnet":  { input: 0.003,  output: 0.015 },
  "gemini-pro":         { input: 0.0005, output: 0.0015 },
};

const DEFAULT_PRICE: ModelPrice = { input: 0.0025, output: 0.01 }; // gpt-4o-like

function getModelPrice(model: string): ModelPrice {
  // Try exact match first
  if (MODEL_PRICES[model]) return MODEL_PRICES[model];
  // Try prefix match (e.g. "gpt-4o-2024-08-06" → "gpt-4o")
  for (const key of Object.keys(MODEL_PRICES)) {
    if (model.startsWith(key)) return MODEL_PRICES[key];
  }
  return DEFAULT_PRICE;
}

// ---------------------------------------------------------------------------
// TokenTracker
// ---------------------------------------------------------------------------

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface TokenReport {
  sessionPromptTokens: number;
  sessionCompletionTokens: number;
  sessionTotalTokens: number;
  estimatedCost: number;
  model: string;
  stepCount: number;
  budgetExceeded: boolean;
}

export class TokenTracker {
  private model: string;
  private sessionPromptTokens = 0;
  private sessionCompletionTokens = 0;
  private stepCount = 0;
  private maxBudget: number; // max total tokens — 0 = no cap
  private warned = false;

  constructor(model: string, maxBudget = 0) {
    this.model = model;
    this.maxBudget = maxBudget;
  }

  /** Record a single step's token usage. */
  recordStep(prompt: number, completion: number): void {
    this.sessionPromptTokens += prompt;
    this.sessionCompletionTokens += completion;
    this.stepCount++;
  }

  /** Current step number (incremented each recordStep call). */
  get currentStep(): number {
    return this.stepCount;
  }

  /** Total tokens consumed this session. */
  get totalTokens(): number {
    return this.sessionPromptTokens + this.sessionCompletionTokens;
  }

  /** Estimated cost for the session (USD). */
  get estimatedCost(): number {
    const price = getModelPrice(this.model);
    return (
      (this.sessionPromptTokens / 1000) * price.input +
      (this.sessionCompletionTokens / 1000) * price.output
    );
  }

  /** Whether the session has exceeded the budget cap. */
  get isOverBudget(): boolean {
    if (this.maxBudget <= 0) return false;
    return this.totalTokens > this.maxBudget;
  }

  /** Get a human-readable report. */
  getReport(): TokenReport {
    return {
      sessionPromptTokens: this.sessionPromptTokens,
      sessionCompletionTokens: this.sessionCompletionTokens,
      sessionTotalTokens: this.totalTokens,
      estimatedCost: this.estimatedCost,
      model: this.model,
      stepCount: this.stepCount,
      budgetExceeded: this.isOverBudget,
    };
  }

  /** Get a formatted summary string (for :tokens command or LLM consumption). */
  getSummary(): string {
    const report = this.getReport();
    const lines: string[] = [
      `## Token Usage`,
      `Model: ${report.model}`,
      `Steps: ${report.stepCount}`,
      `Prompt tokens: ${report.sessionPromptTokens.toLocaleString()}`,
      `Completion tokens: ${report.sessionCompletionTokens.toLocaleString()}`,
      `Total tokens: ${report.sessionTotalTokens.toLocaleString()}`,
      `Estimated cost: $${report.estimatedCost.toFixed(4)}`,
    ];
    if (this.maxBudget > 0) {
      const pct = Math.round((this.totalTokens / this.maxBudget) * 100);
      lines.push(`Budget: ${this.totalTokens.toLocaleString()} / ${this.maxBudget.toLocaleString()} (${pct}%)`);
      if (this.isOverBudget) lines.push("⚠ Budget exceeded!");
    }
    return lines.join("\n");
  }

  /**
   * Check budget and warn if approaching limit.
   * Returns true if the session should be stopped (over budget).
   */
  checkBudget(): boolean {
    if (this.maxBudget <= 0) return false;
    if (this.isOverBudget) return true;

    const pct = Math.round((this.totalTokens / this.maxBudget) * 100);
    if (pct >= 80 && !this.warned) {
      this.warned = true;
      // Warning is returned in budgetWarning property
      return false;
    }
    return false;
  }

  /** Get a warning string if budget is approaching the limit. */
  get budgetWarning(): string | null {
    if (this.maxBudget <= 0) return null;
    const pct = Math.round((this.totalTokens / this.maxBudget) * 100);
    if (pct >= 80 && !this.warned) {
      return `Token budget at ${pct}% (${this.totalTokens.toLocaleString()} / ${this.maxBudget.toLocaleString()}).`;
    }
    return null;
  }
}
