import { describe, it, expect } from "vitest";
import { TaskService } from "./taskService.js";
import type { NovaDb } from "../db/supabaseClient.js";

function fakeDbWithStatus(status: string) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { status }, error: null }),
        }),
      }),
      update: () => ({
        eq: () => Promise.resolve({ data: null, error: null }),
      }),
    }),
  } as unknown as NovaDb;
}

describe("TaskService state machine", () => {
  const service = new TaskService();

  it("allows a legal transition (queued -> planning)", async () => {
    const db = fakeDbWithStatus("queued");
    await expect(service.transition(db, "task-1", "planning")).resolves.toBeUndefined();
  });

  it("rejects an illegal transition (completed -> running)", async () => {
    const db = fakeDbWithStatus("completed");
    await expect(service.transition(db, "task-1", "running")).rejects.toThrow(/Invalid task transition/);
  });

  it("rejects skipping straight from queued to completed", async () => {
    const db = fakeDbWithStatus("queued");
    await expect(service.transition(db, "task-1", "completed")).rejects.toThrow(/Invalid task transition/);
  });
});
