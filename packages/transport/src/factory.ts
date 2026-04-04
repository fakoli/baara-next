// @baara-next/transport — createTransport factory

import { DevTransport, type DevTransportOrchestratorRefs } from "./dev-transport.ts";
import { HttpTransport } from "./http-transport.ts";

export type TransportMode = "dev" | "production";

/**
 * Options for dev mode: the orchestrator's method references are required.
 */
export interface DevTransportOptions {
  mode: "dev";
  orchestrator: DevTransportOrchestratorRefs;
}

/**
 * Options for production mode: a base URL pointing to the orchestrator HTTP
 * server is required.
 */
export interface HttpTransportOptions {
  mode: "production";
  baseUrl: string;
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
 * @example Production mode (separate processes):
 * ```ts
 * const transport = createTransport({
 *   mode: "production",
 *   baseUrl: "http://orchestrator:3000",
 * });
 * ```
 */
export function createTransport(opts: DevTransportOptions): DevTransport;
export function createTransport(opts: HttpTransportOptions): HttpTransport;
export function createTransport(opts: CreateTransportOptions): DevTransport | HttpTransport {
  if (opts.mode === "dev") {
    return new DevTransport(opts.orchestrator);
  }
  return new HttpTransport(opts.baseUrl);
}
