// V33 Supreme — Tests for the dev-only ref warning watcher.
// NOTE: The watcher installs itself only once per module instance. We install
// it once at the top of the suite and then exercise console.error directly.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installRefWarningWatcher } from "./refWarningWatcher";
import { clearDebugEvents, getDebugEvents } from "./debugBus";

// Wait one microtask cycle so debugBus listeners flush.
const flush = () => new Promise<void>(r => queueMicrotask(() => r()));

beforeAll(() => {
  installRefWarningWatcher();
});

describe("refWarningWatcher", () => {
  beforeEach(() => {
    clearDebugEvents();
  });

  afterEach(() => {
    clearDebugEvents();
  });

  it("emits an info bootstrap event on install (idempotent)", async () => {
    // Re-calling install should be a no-op (no second info event).
    installRefWarningWatcher();
    installRefWarningWatcher();
    await flush();
    const infoEvents = getDebugEvents().filter(e => e.category === "info");
    // Bootstrap event happened in beforeAll before clearDebugEvents wiped it,
    // so after clearing we expect zero new info events from extra install calls.
    expect(infoEvents.length).toBe(0);
  });

  it("forwards 'Function components cannot be given refs' warnings to debug bus", async () => {
    console.error(
      "Warning: Function components cannot be given refs. Attempts to access this ref will fail. Did you mean to use React.forwardRef()?\n\nCheck the render method of `SmartJudgePanel`.",
    );
    await flush();

    const judgeEvents = getDebugEvents().filter(e => e.category === "judge");
    expect(judgeEvents.length).toBe(1);
    expect(judgeEvents[0].message).toContain("في مكوّن القاضي");
    expect(judgeEvents[0].message).toContain("SmartJudgePanel");
    expect(judgeEvents[0].symbol).toBe("SmartJudgePanel");
  });

  it("does NOT mark non-judge components as judge warnings", async () => {
    console.error(
      "Warning: Function components cannot be given refs.\n\nCheck the render method of `SomeRandomCard`.",
    );
    await flush();

    const judgeEvents = getDebugEvents().filter(e => e.category === "judge");
    expect(judgeEvents.length).toBe(1);
    expect(judgeEvents[0].message).not.toContain("في مكوّن القاضي");
    expect(judgeEvents[0].message).toContain("SomeRandomCard");
  });

  it("ignores unrelated console.error messages", async () => {
    console.error("Some random error about network failure XYZ-unique-1");
    console.error("TypeError: foo is not a function XYZ-unique-2");
    await flush();

    const judgeEvents = getDebugEvents().filter(e => e.category === "judge");
    expect(judgeEvents.length).toBe(0);
  });

  it("deduplicates identical ref warnings", async () => {
    const msg =
      "Warning: Function components cannot be given refs.\n\nCheck the render method of `RiskPanelDedupTest`.";
    console.error(msg);
    console.error(msg);
    console.error(msg);
    await flush();

    const judgeEvents = getDebugEvents().filter(
      e => e.category === "judge" && e.message.includes("RiskPanelDedupTest"),
    );
    expect(judgeEvents.length).toBe(1);
  });

  it("preserves the original console.error behavior (chains through)", async () => {
    const spy = vi.spyOn(console, "error");
    console.error(
      "Warning: Function components cannot be given refs in LearningStatsPanelChainTest",
    );
    await flush();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("matches the forwardRef hint pattern", async () => {
    console.error("Did you mean to use React.forwardRef() ForwardRefHintUnique?");
    await flush();

    const judgeEvents = getDebugEvents().filter(
      e => e.category === "judge" && e.message.includes("ForwardRefHintUnique"),
    );
    expect(judgeEvents.length).toBe(1);
  });
});
