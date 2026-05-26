// HTTP transport for production multi-process deployments.

import type { RuntimeCapability } from "@baara-next/core";
import type { ITransport, TaskAssignment, ExecuteResult } from "@baara-next/core";

const FETCH_TIMEOUT_MS = 30_000;
const HITL_TIMEOUT_MS = 5 * 60 * 1_000;
const HITL_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 100;
const DEFAULT_MAX_DELAY_MS = 5_000;

export interface HttpTransportConfig {
  baseUrl: string;
  apiKey?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class HttpTransport implements ITransport {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(config: HttpTransportConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = config.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) h["X-Api-Key"] = this.apiKey;
    return h;
  }

  // 408 (Request Timeout) and 429 (Too Many Requests) are treated as transient
  // alongside 5xx; some HTTP clients only retry 5xx by default.
  private isTransientStatus(status: number): boolean {
    return status >= 500 || status === 408 || status === 429;
  }

  // fetch raises TypeError on network failure; Bun/Node also expose the
  // underlying errno via `cause.code` (preferred over message-substring matching).
  // AbortError is caller-driven cancellation and is never retried.
  private isTransientError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    if (err.name === "AbortError") return false;
    if (err.name === "TypeError") return true;
    const code = (err as { cause?: { code?: string } }).cause?.code;
    return code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "EAI_AGAIN";
  }

  private backoffMs(attempt: number): number {
    return Math.min(this.baseDelayMs * 2 ** attempt, this.maxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private async retryFetch(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(url, init);
        if (this.isTransientStatus(res.status)) {
          if (attempt < this.maxRetries) {
            await this.sleep(this.backoffMs(attempt));
            continue;
          }
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }
        return res;
      } catch (err) {
        if (!this.isTransientError(err)) throw err;
        if (attempt < this.maxRetries) {
          await this.sleep(this.backoffMs(attempt));
          continue;
        }
        throw err;
      }
    }
    throw new Error("retryFetch: unreachable");
  }

  async pollTask(
    agentId: string,
    capabilities: RuntimeCapability[]
  ): Promise<TaskAssignment | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await this.retryFetch(`${this.baseUrl}/internal/poll`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ agentId, capabilities }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`pollTask HTTP ${res.status}: ${await res.text()}`);
      return (await res.json()) as TaskAssignment | null;
    } catch (err) {
      // 30s timeout fired — no assignment available; treated as a normal "no work" tick.
      if (err instanceof Error && err.name === "AbortError") return null;
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async startExecution(executionId: string): Promise<void> {
    const res = await this.retryFetch(`${this.baseUrl}/internal/start`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ executionId }),
    });

    if (!res.ok) {
      throw new Error(`startExecution HTTP ${res.status}: ${await res.text()}`);
    }
  }

  async completeExecution(
    executionId: string,
    result: ExecuteResult
  ): Promise<void> {
    const res = await this.retryFetch(`${this.baseUrl}/internal/complete`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ executionId, result }),
    });

    if (!res.ok) {
      throw new Error(`completeExecution HTTP ${res.status}: ${await res.text()}`);
    }
  }

  async requestInput(
    executionId: string,
    prompt: string,
    options?: string[]
  ): Promise<string> {
    const createRes = await this.retryFetch(`${this.baseUrl}/internal/input-request`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ executionId, prompt, options }),
    });

    if (!createRes.ok) {
      throw new Error(
        `requestInput (create) HTTP ${createRes.status}: ${await createRes.text()}`
      );
    }

    const { inputRequestId } = (await createRes.json()) as { inputRequestId: string };

    const deadline = Date.now() + HITL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const pollRes = await this.retryFetch(`${this.baseUrl}/internal/input-poll`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({ executionId, inputRequestId }),
          signal: controller.signal,
        });

        if (!pollRes.ok) {
          throw new Error(
            `requestInput (poll) HTTP ${pollRes.status}: ${await pollRes.text()}`
          );
        }

        const body = (await pollRes.json()) as {
          status: "pending" | "responded" | "timed_out";
          response?: string;
        };

        if (body.status === "responded" && body.response !== undefined) {
          return body.response;
        }
        if (body.status === "timed_out") {
          throw new Error(`timed_out: input request ${inputRequestId} expired`);
        }

        await this.sleep(HITL_POLL_INTERVAL_MS);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // Per-poll 30s window elapsed; loop again to issue a fresh poll until the HITL deadline.
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error(
      `requestInput timed out after ${HITL_TIMEOUT_MS}ms (inputRequestId=${inputRequestId}, executionId=${executionId})`
    );
  }

  async heartbeat(
    agentId: string,
    executionId: string,
    turnCount: number
  ): Promise<void> {
    const res = await this.retryFetch(`${this.baseUrl}/internal/heartbeat`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ agentId, executionId, turnCount }),
    });

    if (!res.ok) {
      throw new Error(`heartbeat HTTP ${res.status}: ${await res.text()}`);
    }
  }
}
