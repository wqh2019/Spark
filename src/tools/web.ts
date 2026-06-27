import type { Tool } from "./index.js";

/**
 * Fetch a URL and return its text content (HTML, JSON, plain text, etc.).
 * Uses Node 18+ global fetch.
 */
const webFetch: Tool = {
  name: "web_fetch",
  description:
    "Fetch content from a URL and return its text content. Supports HTTP/HTTPS URLs.",
  parameters: {
    url: {
      type: "string",
      description: "HTTP or HTTPS URL to fetch",
    },
    max_length: {
      type: "number",
      description:
        "Maximum characters to return (default: 10000). Use 0 for unlimited.",
    },
  },
  required: ["url"],
  requiresConfirmation: false,
  async execute(args) {
    const url = String(args.url);
    const maxLength = typeof args.max_length === "number" ? args.max_length : 10_000;

    // Basic URL validation
    let parsed: URL;
    try {
      parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return `Error: Only HTTP and HTTPS URLs are supported, got "${parsed.protocol}"`;
      }
    } catch {
      return `Error: Invalid URL: ${url}`;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Spark-CLI/1.0",
          Accept: "text/html,application/json,text/plain,*/*",
        },
        redirect: "follow",
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return `Error: HTTP ${response.status} ${response.statusText} for ${url}`;
      }

      const contentType = response.headers.get("content-type") || "";

      // Reject binary content types
      if (
        /^(application\/(octet-stream|pdf|zip|gzip|x-tar|x-gtar|vnd\.)|image\/|audio\/|video\/)/.test(
          contentType,
        )
      ) {
        return `Error: Unsupported content type "${contentType}" for ${url}`;
      }

      let text: string;
      try {
        text = await response.text();
      } catch {
        return `Error: Failed to decode response body from ${url}`;
      }

      if (maxLength > 0 && text.length > maxLength) {
        text = text.slice(0, maxLength) + `\n... (truncated, ${text.length} total chars)`;
      }

      return text || "(empty response)";
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return `Error: Request timed out for ${url}`;
      }
      return `Error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const webTools: Tool[] = [webFetch];
