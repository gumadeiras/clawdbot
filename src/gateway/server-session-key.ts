import { loadConfig } from "../config/config.js";
import { getAgentRunContext, registerAgentRunContext } from "../infra/agent-events.js";
import { toAgentRequestSessionKey } from "../routing/session-key.js";
import { loadCombinedSessionStoreForGateway } from "./session-utils.js";

const RUN_LOOKUP_CACHE_LIMIT = 256;
const resolvedSessionKeyByRunId = new Map<string, string | null>();

function setResolvedSessionKeyCache(runId: string, sessionKey: string | null): void {
  if (!runId) {
    return;
  }
  if (
    !resolvedSessionKeyByRunId.has(runId) &&
    resolvedSessionKeyByRunId.size >= RUN_LOOKUP_CACHE_LIMIT
  ) {
    const oldest = resolvedSessionKeyByRunId.keys().next().value;
    if (oldest) {
      resolvedSessionKeyByRunId.delete(oldest);
    }
  }
  resolvedSessionKeyByRunId.set(runId, sessionKey);
}

export function resolveSessionKeyForRun(runId: string) {
  const cached = getAgentRunContext(runId)?.sessionKey;
  if (cached) {
    return cached;
  }
  const cachedLookup = resolvedSessionKeyByRunId.get(runId);
  if (cachedLookup !== undefined) {
    return cachedLookup ?? undefined;
  }
  const cfg = loadConfig();
  const { store } = loadCombinedSessionStoreForGateway(cfg);
  const found = Object.entries(store).find(([, entry]) => entry?.sessionId === runId);
  const storeKey = found?.[0];
  if (storeKey) {
    const sessionKey = toAgentRequestSessionKey(storeKey) ?? storeKey;
    registerAgentRunContext(runId, { sessionKey });
    setResolvedSessionKeyCache(runId, sessionKey);
    return sessionKey;
  }
  setResolvedSessionKeyCache(runId, null);
  return undefined;
}

export function resetResolvedSessionKeyForRunCacheForTest(): void {
  resolvedSessionKeyByRunId.clear();
}
