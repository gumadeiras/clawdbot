import { loadConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import { getAgentRunContext, registerAgentRunContext } from "../infra/agent-events.js";
import { toAgentRequestSessionKey } from "../routing/session-key.js";
import { loadCombinedSessionStoreForGateway } from "./session-utils.js";

const RUN_LOOKUP_CACHE_LIMIT = 256;
const RUN_LOOKUP_MISS_TTL_MS = 1_000;

type RunLookupCacheEntry = {
  sessionKey: string | null;
  expiresAt: number | null;
};

const resolvedSessionKeyByRunId = new Map<string, RunLookupCacheEntry>();

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
  resolvedSessionKeyByRunId.set(runId, {
    sessionKey,
    expiresAt: sessionKey === null ? Date.now() + RUN_LOOKUP_MISS_TTL_MS : null,
  });
}

function resolvePreferredRunStoreKey(
  matches: Array<[string, SessionEntry]>,
  runId: string,
): string | undefined {
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length === 1) {
    return matches[0][0];
  }

  const loweredRunId = runId.trim().toLowerCase();
  const structuralMatches = matches.filter(([storeKey]) => {
    const requestKey = toAgentRequestSessionKey(storeKey)?.toLowerCase();
    return (
      storeKey.toLowerCase().endsWith(`:${loweredRunId}`) ||
      requestKey === loweredRunId ||
      requestKey?.endsWith(`:${loweredRunId}`) === true
    );
  });
  if (structuralMatches.length === 1) {
    return structuralMatches[0][0];
  }

  const sortedMatches = [...matches].toSorted(
    (a, b) => (b[1]?.updatedAt ?? 0) - (a[1]?.updatedAt ?? 0),
  );
  const [freshest, secondFreshest] = sortedMatches;
  if ((freshest?.[1]?.updatedAt ?? 0) > (secondFreshest?.[1]?.updatedAt ?? 0)) {
    return freshest?.[0];
  }

  return undefined;
}

export function resolveSessionKeyForRun(runId: string) {
  const cached = getAgentRunContext(runId)?.sessionKey;
  if (cached) {
    return cached;
  }
  const cachedLookup = resolvedSessionKeyByRunId.get(runId);
  if (cachedLookup !== undefined) {
    if (cachedLookup.sessionKey !== null) {
      return cachedLookup.sessionKey;
    }
    if ((cachedLookup.expiresAt ?? 0) > Date.now()) {
      return undefined;
    }
    resolvedSessionKeyByRunId.delete(runId);
  }
  const cfg = loadConfig();
  const { store } = loadCombinedSessionStoreForGateway(cfg);
  const matches = Object.entries(store).filter(
    (entry): entry is [string, SessionEntry] => entry[1]?.sessionId === runId,
  );
  const storeKey = resolvePreferredRunStoreKey(matches, runId);
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
