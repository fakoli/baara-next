// @baara-next/orchestrator — Queue Manager
//
// Manages the four durable queues (transfer, timer, visibility, dlq) backed by
// the store.  Uses Node-compatible EventEmitter for push notification instead
// of setInterval polling so agents are woken immediately when work arrives.
//
// Timer queue: each timer entry carries a fire-time encoded as a delay.  When
// an entry is enqueued a setTimeout is scheduled; on expiry the stored
// execution is transitioned from retry_scheduled → queued and a
// 'task-available' event is emitted for the transfer queue.

import { EventEmitter } from "events";
import type { IStore } from "@baara-next/core";
import { emitRetryStarted } from "./event-handler.ts";

// ---------------------------------------------------------------------------
// QueueManager
// ---------------------------------------------------------------------------

export class QueueManager extends EventEmitter {
  /** Active setTimeout handles keyed by executionId, used to cancel timers. */
  private timerHandles = new Map<string, ReturnType<typeof setTimeout>>();

  /** Buffer of pending visibility updates to be flushed as a batch. */
  private visibilityBuffer: Array<{ executionId: string; status: string }> = [];

  /** setInterval handle for the visibility flush cycle. */
  private visibilityInterval: ReturnType<typeof setInterval> | undefined;

  constructor(private store: IStore) {
    super();
    // Start the 1-second visibility flush cycle immediately.
    this.visibilityInterval = setInterval(() => this.flushVisibility(), 1000);
  }

  // -------------------------------------------------------------------------
  // Transfer queue
  // -------------------------------------------------------------------------

  /**
   * Persist the execution to the transfer queue (store already has it in
   * `queued` status) and notify waiting agents.
   */
  enqueue(queueName: string, _executionId: string): void {
    // The execution is already in the store with `queued` status.
    // Emit so that any agent awaiting waitForTask() is woken.
    this.emit("task-available", queueName);
  }

  /**
   * Atomically dequeue the highest-priority queued execution from the named
   * queue and transition it to `assigned`.
   *
   * Returns null when the queue is empty.
   */
  dequeue(queueName: string): ReturnType<IStore["dequeueExecution"]> {
    return this.store.dequeueExecution(queueName);
  }

  /**
   * Return a Promise that resolves with the queue name the moment a
   * 'task-available' event fires for `queueName`, or null on timeout.
   *
   * Agents use this to block-and-wait instead of busy-polling.
   *
   * @reserved Reserved for future agent integration — enables blocking poll instead of busy-wait.
   */
  waitForTask(queueName: string, timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>;

      const handler = (name: string) => {
        if (name !== queueName) return;
        clearTimeout(timer);
        this.removeListener("task-available", handler);
        resolve(queueName);
      };

      timer = setTimeout(() => {
        this.removeListener("task-available", handler);
        resolve(null);
      }, timeoutMs);

      this.on("task-available", handler);
    });
  }

  // -------------------------------------------------------------------------
  // Timer queue (retry backoff)
  // -------------------------------------------------------------------------

  /**
   * Schedule a retry after `delayMs`.  After the delay elapses the execution
   * is transitioned from `retry_scheduled` to `queued` on the transfer queue,
   * a RetryStarted event is emitted, and a 'task-available' signal is fired.
   *
   * @param executionId - The execution currently in `retry_scheduled` status.
   * @param delayMs     - How long to wait before re-enqueuing.
   * @param nextAttempt - The attempt number the new execution will carry.
   */
  enqueueTimer(
    executionId: string,
    delayMs: number,
    nextAttempt: number
  ): void {
    // Cancel any existing timer for this execution (idempotent).
    this.cancelTimer(executionId);

    const handle = setTimeout(async () => {
      this.timerHandles.delete(executionId);
      await this._fireTimer(executionId, nextAttempt);
    }, delayMs);

    this.timerHandles.set(executionId, handle);
  }

  /** Cancel a pending timer for an execution (no-op if none exists). */
  cancelTimer(executionId: string): void {
    const handle = this.timerHandles.get(executionId);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.timerHandles.delete(executionId);
    }
  }

  /** Drain all pending timers — called during graceful shutdown. */
  cancelAllTimers(): void {
    for (const handle of this.timerHandles.values()) {
      clearTimeout(handle);
    }
    this.timerHandles.clear();
    if (this.visibilityInterval !== undefined) {
      clearInterval(this.visibilityInterval);
      this.visibilityInterval = undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Visibility queue (batched status broadcast)
  // -------------------------------------------------------------------------

  /**
   * Buffer a status change notification for the visibility queue.
   * Notifications are flushed as a batch every 1 second.
   */
  enqueueVisibility(executionId: string, status: string): void {
    this.visibilityBuffer.push({ executionId, status });
  }

  /**
   * Flush all buffered visibility updates and emit a 'visibility-batch' event.
   * Called automatically on the 1-second interval; also safe to call manually.
   */
  private flushVisibility(): void {
    if (this.visibilityBuffer.length === 0) return;
    const batch = this.visibilityBuffer.splice(0);
    try {
      this.emit("visibility-batch", batch);
    } catch (err) {
      console.error("[queue-manager] visibility-batch listener threw:", err);
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Called when a timer fires: create a new execution from the failed one
   * and emit task-available so waiting agents are woken.
   */
  private async _fireTimer(
    executionId: string,
    nextAttempt: number
  ): Promise<void> {
    try {
      const execution = this.store.getExecution(executionId);
      if (!execution) return;

      // Only proceed if the execution is still retry_scheduled.
      if (execution.status !== "retry_scheduled") return;

      // Create the new execution attempt.
      const newId = crypto.randomUUID();
      const now = new Date().toISOString();
      this.store.createExecution(
        newId,
        execution.taskId,
        execution.queueName,
        execution.priority,
        now,
        nextAttempt
      );

      // Transition the new execution: created → queued.
      this.store.updateExecutionStatus(newId, "queued");

      // Emit a RetryStarted event on the new execution.
      emitRetryStarted(this.store, newId, nextAttempt);

      // Notify agents.
      this.emit("task-available", execution.queueName);
    } catch (err) {
      console.error(
        `[queue-manager] Timer fire failed for execution ${executionId}:`,
        err
      );
    }
  }
}
