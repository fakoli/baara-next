import { describe, it, expect } from "bun:test";
import { ok, err, notFound, resolveTask } from "../helpers.ts";
import type { IStore } from "@baara-next/core";

const mockTask = {
  id: "task-uuid-1",
  name: "my-task",
  description: "A test task",
  prompt: "echo hello",
  timeoutMs: 30000,
  executionType: "cloud_code" as const,
  agentConfig: null,
  priority: 2 as const,
  targetQueue: "default",
  maxRetries: 3,
  executionMode: "queued" as const,
  enabled: true,
  projectId: null,
  createdAt: "2026-04-04T00:00:00Z",
  updatedAt: "2026-04-04T00:00:00Z",
};

const mockStore: Pick<IStore, "getTask" | "getTaskByName"> = {
  getTask: (id: string) => (id === "task-uuid-1" ? mockTask : null),
  getTaskByName: (name: string) => (name === "my-task" ? mockTask : null),
};

describe("helpers", () => {
  describe("ok()", () => {
    it("wraps data as text content", () => {
      const result = ok({ foo: "bar" });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(JSON.parse(result.content[0].text)).toEqual({ foo: "bar" });
    });

    it("does not set isError", () => {
      const result = ok("hello");
      expect((result as { isError?: boolean }).isError).toBeUndefined();
    });
  });

  describe("err()", () => {
    it("wraps message as error text content", () => {
      const result = err("something went wrong");
      expect(result.content[0].text).toBe("something went wrong");
      expect(result.isError).toBe(true);
    });
  });

  describe("notFound()", () => {
    it("returns error for task not found", () => {
      const result = notFound("missing-task");
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("missing-task");
    });
  });

  describe("resolveTask()", () => {
    it("resolves by name", () => {
      const task = resolveTask(mockStore as IStore, "my-task");
      expect(task?.id).toBe("task-uuid-1");
    });

    it("resolves by id", () => {
      const task = resolveTask(mockStore as IStore, "task-uuid-1");
      expect(task?.id).toBe("task-uuid-1");
    });

    it("returns null when not found", () => {
      const task = resolveTask(mockStore as IStore, "nonexistent");
      expect(task).toBeNull();
    });
  });
});
