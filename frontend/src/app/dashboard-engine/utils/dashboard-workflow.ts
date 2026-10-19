// Purpose: Builds generation payloads and manages iteration/chat history structures.
import {
  DashboardChatMessage,
  DashboardChatRole,
  DashboardGenerationMode,
  DashboardGenerationResponse,
  DashboardIterationGroup,
  DashboardIterationSnapshot,
  DashboardSessionSnapshot,
  DashboardTemplateFamily,
} from '../models/dashboard.model';

export interface BuildGenerationPayloadOptions {
  prompt: string;
  databasePath: string;
  templateFamily: '' | DashboardTemplateFamily;
  chatSessionId: string;
  sessionGenerationMode: DashboardGenerationMode;
}

export interface BuildGenerationPayloadResult extends Record<string, unknown> {
  prompt: string;
  databasePath?: string;
  templateFamily?: DashboardTemplateFamily;
  sessionId?: string;
  mode?: DashboardGenerationMode;
}

export function buildGenerationPayload(options: BuildGenerationPayloadOptions): BuildGenerationPayloadResult {
  const payload: BuildGenerationPayloadResult = {
    prompt: options.prompt.trim(),
  };

  const normalizedPath = options.databasePath.trim();

  if (normalizedPath) {
    payload.databasePath = normalizedPath;
  }

  if (options.templateFamily) {
    payload.templateFamily = options.templateFamily;
  }

  if (options.chatSessionId) {
    payload.sessionId = options.chatSessionId;
    payload.mode = options.sessionGenerationMode;
  }

  return payload;
}

export function createIterationSnapshot(
  response: DashboardGenerationResponse,
  prompt: string,
  databasePath: string,
  parentIterationId: string | null,
  createId: (prefix: string) => string,
  resolveIterationRootId: (iterationId: string) => string,
): DashboardIterationSnapshot {
  const sessionMetadata = response.metadata.session;
  const resolvedParentIterationId = sessionMetadata?.continuedFromTurnId ?? parentIterationId;
  const iterationId = sessionMetadata?.turnId ?? createId('iteration');

  const rootIterationId: string = resolvedParentIterationId
    ? resolveIterationRootId(resolvedParentIterationId)
    : iterationId;

  const summaryParts = [
    response.metadata.selectedTemplateFamily,
    response.metadata.resolvedTable || response.metadata.selectedTable,
    response.metadata.generation.renderedComponentKinds.join(', '),
  ];

  if (resolvedParentIterationId) {
    summaryParts.push(`fork ${resolvedParentIterationId.slice(0, 10)}`);
  }

  return {
    id: iterationId,
    parentIterationId: resolvedParentIterationId,
    rootIterationId,
    prompt,
    templateFamily: response.metadata.selectedTemplateFamily,
    databasePath,
    createdAt: new Date().toISOString(),
    summary: summaryParts.filter(Boolean).join(' · '),
    response,
  };
}

export function normalizeIterationHistory(
  turns: DashboardIterationSnapshot[],
  resolveIterationRootId: (
    iterationId: string,
    iterationMap?: Map<string, DashboardIterationSnapshot>,
    rootCache?: Map<string, string>
  ) => string,
): DashboardIterationSnapshot[] {
  const normalizedTurns = turns.map((turn) => ({ ...turn }));
  const iterationMap = new Map(normalizedTurns.map((turn) => [turn.id, turn]));
  const rootCache = new Map<string, string>();

  for (const iteration of normalizedTurns) {
    iteration.rootIterationId = resolveIterationRootId(iteration.id, iterationMap, rootCache);
  }

  return normalizedTurns;
}


export function resolveIterationRootId(
  iterationId: string,
  iterationMap: Map<string, DashboardIterationSnapshot>,
  rootCache: Map<string, string>,
): string {
  const cachedRootId = rootCache.get(iterationId);

  if (cachedRootId) {
    return cachedRootId;
  }

  const iteration = iterationMap.get(iterationId);

  if (!iteration) {
    rootCache.set(iterationId, iterationId);
    return iterationId;
  }

  if (iteration.rootIterationId) {
    rootCache.set(iterationId, iteration.rootIterationId);
    return iteration.rootIterationId;
  }

  if (!iteration.parentIterationId) {
    rootCache.set(iterationId, iteration.id);
    return iteration.id;
  }

  const resolvedRootId: string = resolveIterationRootId(
    iteration.parentIterationId,
    iterationMap,
    rootCache
  );

  rootCache.set(iterationId, resolvedRootId);
  return resolvedRootId;
}

export function rebuildGenerationGroups(
  history: DashboardIterationSnapshot[],
  preferredIterationId: string | null,
): DashboardIterationGroup[] {
  const groupsMap = new Map<string, DashboardIterationGroup>();

  for (const iteration of history) {
    const rootId = iteration.rootIterationId ?? iteration.id; 

    const group = groupsMap.get(rootId);

    if (!group) {
      groupsMap.set(rootId, {
        rootIterationId: rootId,
        rootIteration: iteration,
        versions: [iteration],
        selectedIterationId: iteration.id,
      });
      continue;
    }

    group.versions.push(iteration);

    if (iteration.id === preferredIterationId) {
      group.selectedIterationId = iteration.id;
    }
  }

  return Array.from(groupsMap.values());
}

export function createChatMessage(
  role: DashboardChatRole,
  text: string,
  meta?: string
): DashboardChatMessage | null {
  const normalizedText = String(text || '').trim();

  if (!normalizedText) {
    return null;
  }

  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text: normalizedText,
    meta: meta?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };
}

export function applySessionSnapshotMetadata(snapshot: DashboardSessionSnapshot) {
  return {
    sessionId: snapshot.sessionId,
    turns: snapshot.turns,
    chatMessages: snapshot.chatMessages,
    latestResponse: snapshot.latestResponse,
  };
}
