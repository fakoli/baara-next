// @baara-next/transport — createTransport factory

import { DevTransport, type DevTransportOrchestratorRefs } from "./dev-transport.ts";
import { HttpTransport, type HttpTransportConfig } from "./http-transport.ts";

export type TransportMode = "dev" | "http";

/**
 * Options for dev mode: the orchestrator's method references are required.
 */
export interface DevTransportOptions {
  mode: "dev";
  orchestrator: DevTransportOrchestratorRefs;
}

/**
 * Options for http mode: a base URL pointing to the orchestrator HTTP server
 * is required.  An apiKey is required whenever the orchestrator was started
 * with `BAARA_API_KEY` set (which `start --mode http` enforces).
 */
export interface HttpTransportOptions extends HttpTransportConfig {
  mode: "http";
}

export type CreateTransportOptions = DevTransportOptions | HttpTransportOptions;

/**
 * Factory that returns the appropriate transport implementation for the
 * selected execution mode.
 *
 * @example Dev mode (single-process):
 * ```ts
 * const transport = createTransport({
 *   mode: "dev",
 *   orchestrator: { matchTask, handleExecutionComplete, requestInput, heartbeat },
 * });
 * ```
 *
 * @example Http mode (separate processes):
 * ```ts
 * const transport = createTransport({
 *   mode: "http",
 *   baseUrl: "http://orchestrator:3000",
 *   apiKey: process.env.BAARA_API_KEY,
 * });
 * ```
 */
export function createTransport(opts: DevTransportOptions): DevTransport;
export function createTransport(opts: HttpTransportOptions): HttpTransport;
export function createTransport(opts: CreateTransportOptions): DevTransport | HttpTransport {
  if (opts.mode === "dev") {
    return new DevTransport(opts.orchestrator);
  }
  return new HttpTransport({
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    maxRetries: opts.maxRetries,
    baseDelayMs: opts.baseDelayMs,
    maxDelayMs: opts.maxDelayMs,
  });
}
