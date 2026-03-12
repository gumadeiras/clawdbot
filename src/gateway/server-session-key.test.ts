import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resetAgentRunContextForTest } from "../infra/agent-events.js";

const hoisted = vi.hoisted(() => ({
  loadConfigMock: vi.fn<() => OpenClawConfig>(),
  loadCombinedSessionStoreForGatewayMock: vi.fn(),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: () => hoisted.loadConfigMock(),
}));

vi.mock("./session-utils.js", async () => {
  const actual = await vi.importActual<typeof import("./session-utils.js")>("./session-utils.js");
  return {
    ...actual,
    loadCombinedSessionStoreForGateway: (cfg: OpenClawConfig) =>
      hoisted.loadCombinedSessionStoreForGatewayMock(cfg),
  };
});

const { resolveSessionKeyForRun, resetResolvedSessionKeyForRunCacheForTest } =
  await import("./server-session-key.js");

describe("resolveSessionKeyForRun", () => {
  beforeEach(() => {
    hoisted.loadConfigMock.mockReset();
    hoisted.loadCombinedSessionStoreForGatewayMock.mockReset();
    resetAgentRunContextForTest();
    resetResolvedSessionKeyForRunCacheForTest();
  });

  afterEach(() => {
    resetAgentRunContextForTest();
    resetResolvedSessionKeyForRunCacheForTest();
  });

  it("resolves run ids from the combined gateway store and caches the result", () => {
    const cfg: OpenClawConfig = {
      session: {
        store: "/custom/root/agents/{agentId}/sessions/sessions.json",
      },
    };
    hoisted.loadConfigMock.mockReturnValue(cfg);
    hoisted.loadCombinedSessionStoreForGatewayMock.mockReturnValue({
      storePath: "(multiple)",
      store: {
        "agent:retired:acp:run-1": { sessionId: "run-1", updatedAt: 123 },
      },
    });

    expect(resolveSessionKeyForRun("run-1")).toBe("acp:run-1");
    expect(resolveSessionKeyForRun("run-1")).toBe("acp:run-1");
    expect(hoisted.loadCombinedSessionStoreForGatewayMock).toHaveBeenCalledTimes(1);
    expect(hoisted.loadCombinedSessionStoreForGatewayMock).toHaveBeenCalledWith(cfg);
  });

  it("caches misses so repeated lookups do not rebuild the combined store", () => {
    hoisted.loadConfigMock.mockReturnValue({});
    hoisted.loadCombinedSessionStoreForGatewayMock.mockReturnValue({
      storePath: "(multiple)",
      store: {},
    });

    expect(resolveSessionKeyForRun("missing-run")).toBeUndefined();
    expect(resolveSessionKeyForRun("missing-run")).toBeUndefined();
    expect(hoisted.loadCombinedSessionStoreForGatewayMock).toHaveBeenCalledTimes(1);
  });
});
