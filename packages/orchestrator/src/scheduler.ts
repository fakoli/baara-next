// @baara-next/orchestrator — Cron Scheduler
//
// Registers recurring tasks with Croner.  On each tick the task is re-fetched
// from the store (defensive check) and, if still enabled, a new execution is
// created and enqueued.  Errors inside a tick are logged and swallowed so they
// can never crash the cron loop.

import { Cron } from "croner";
import type { IStore } from "@baara-next/core";
import { QueueManager } from "./queue-manager.ts";
import {
  emitExecutionCreated,
  emitExecutionQueued,
} from "./event-handler.ts";

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export class Scheduler {
  /** Active Cron instances keyed by taskId. */
  private jobs = new Map<string, Cron>();

  constructor(
    private store: IStore,
    private queueManager: QueueManager
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Load all enabled tasks with a cron expression from the store and register
   * each one.  Called once during orchestrator start.
   */
  startAll(): void {
    const tasks = this.store
      .listTasks()
      .filter((t) => t.enabled && t.cronExpression);

    for (const task of tasks) {
      this.register(task.id, task.cronExpression!);
    }

    if (tasks.length > 0) {
      console.info(
        `[scheduler] Loaded ${tasks.length} recurring task(s)`
      );
    }
  }

  /** Stop all registered cron jobs and clear the registry. */
  stop(): void {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();
  }

  // -------------------------------------------------------------------------
  // Per-task registration
  // -------------------------------------------------------------------------

  /**
   * Register (or re-register) a cron job for the given task.
   *
   * If a job already exists for `taskId` it is stopped first, making this
   * safe to call when a task's cron expression is updated.
   */
  register(taskId: string, cronExpression: string): void {
    this.unregister(taskId);

    const job = new Cron(cronExpression, async () => {
      // Defensive re-fetch: the task may have been disabled since registration.
      const task = this.store.getTask(taskId);
      if (!task || !task.enabled) return;

      try {
        const execId = crypto.randomUUID();
        const now = new Date().toISOString();

        // Create execution in 'created' status.
        this.store.createExecution(
          execId,
          task.id,
          task.targetQueue,
          task.priority,
          now,
          1
        );
        emitExecutionCreated(
          this.store,
          execId,
          task.id,
          task.targetQueue,
          1
        );

        // Transition to 'queued'.
        this.store.updateExecutionStatus(execId, "queued");
        emitExecutionQueued(this.store, execId, task.targetQueue);

        // Notify queue manager so waiting agents are woken.
        this.queueManager.enqueue(task.targetQueue, execId);

        console.info(
          `[scheduler] Enqueued execution ${execId} for task ${taskId}`
        );
      } catch (err) {
        // Log and continue — never let a tick crash the cron loop.
        console.error(
          `[scheduler] Failed to create execution for task ${taskId}:`,
          err
        );
      }
    });

    this.jobs.set(taskId, job);
  }

  /**
   * Stop and remove the cron job for the given task.
   *
   * No-op if the task has no registered job.
   */
  unregister(taskId: string): void {
    const existing = this.jobs.get(taskId);
    if (existing) {
      existing.stop();
      this.jobs.delete(taskId);
    }
  }
}
