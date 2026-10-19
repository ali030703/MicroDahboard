// Purpose: Persists dashboard conversation sessions and turn history for incremental generation.
const fs = require('fs/promises');
const path = require('path');

const SESSION_STORE_PATH = path.resolve(__dirname, '../../.runtime/dashboard-sessions.json');
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const MAX_STORED_TURNS = 30;
const MAX_STORED_CHAT_MESSAGES = 200;

let storeCache = null;
let persistQueue = Promise.resolve();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function formatValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (Array.isArray(value)) {
    return value.map((entry) => formatValue(entry)).filter(Boolean).join(', ');
  }

  return String(value).trim();
}

function formatFilterSummary(filter) {
  if (!filter || typeof filter !== 'object') {
    return '';
  }

  const column = formatValue(filter.column);
  const operator = String(filter.operator || '=').trim().toLowerCase();
  const value = filter.value;

  if (!column) {
    return '';
  }

  if (operator === 'contains') {
    return `${column} contains ${formatValue(value)}`;
  }

  if (operator === 'in' && Array.isArray(value)) {
    return `${column} in (${formatValue(value)})`;
  }

  if (operator === 'between' && Array.isArray(value) && value.length >= 2) {
    return `${column} between ${formatValue(value[0])} and ${formatValue(value[1])}`;
  }

  return `${column} ${operator} ${formatValue(value)}`.trim();
}

function summarizeFilters(filters) {
  if (!Array.isArray(filters) || !filters.length) {
    return '';
  }

  const summary = filters.slice(0, 3).map((filter) => formatFilterSummary(filter)).filter(Boolean).join('; ');
  const remaining = filters.length - 3;

  if (remaining > 0) {
    return `${summary}${summary ? '; ' : ''}+${remaining} more`;
  }

  return summary;
}

function createEmptyStore() {
  return {
    version: 1,
    sessions: {},
  };
}

function normalizeSessionId(sessionId) {
  const normalized = String(sessionId || '').trim();

  if (!normalized) {
    throw new Error('sessionId is required.');
  }

  if (!SESSION_ID_PATTERN.test(normalized)) {
    throw new Error('Invalid sessionId. Use 8-128 chars with letters, numbers, underscores, or dashes.');
  }

  return normalized;
}

function createEmptySession(sessionId) {
  const now = new Date().toISOString();

  return {
    id: sessionId,
    createdAt: now,
    updatedAt: now,
    turns: [],
    chatMessages: [],
  };
}

function buildSessionSnapshot(session) {
  return {
    sessionId: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    turnCount: session.turns.length,
    turns: clone(session.turns),
    chatMessages: clone(session.chatMessages),
    latestResponse: session.turns[0]?.response ?? null,
  };
}

async function persistStore() {
  if (!storeCache) {
    return;
  }

  persistQueue = persistQueue
    .catch(() => undefined)
    .then(async () => {
      await fs.mkdir(path.dirname(SESSION_STORE_PATH), { recursive: true });
      await fs.writeFile(SESSION_STORE_PATH, JSON.stringify(storeCache, null, 2), 'utf8');
    });

  await persistQueue;
}

async function loadStore() {
  if (storeCache) {
    return storeCache;
  }

  try {
    const raw = await fs.readFile(SESSION_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object' || !parsed.sessions || typeof parsed.sessions !== 'object') {
      storeCache = createEmptyStore();
    } else {
      storeCache = {
        version: 1,
        sessions: parsed.sessions,
      };
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      storeCache = createEmptyStore();
      await persistStore();
      return storeCache;
    }

    throw error;
  }

  return storeCache;
}

function createTurnId() {
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTurnSummary(response, parentIterationId) {
  const selectedEntity = response?.metadata?.generation?.promptIntent?.selectedEntity ?? response?.metadata?.generation?.promptIntent?.semanticIntent?.entity;

  const summaryParts = [
    response?.metadata?.selectedTemplateFamily,
    selectedEntity,
    response?.metadata?.generation?.selectedDataBindings?.aggregation,
    (response?.metadata?.generation?.renderedComponentKinds ?? []).join(', '),
  ];

  const filterSummary = summarizeFilters(response?.metadata?.generation?.selectedDataBindings?.filters);

  if (filterSummary) {
    summaryParts.splice(2, 0, filterSummary);
  }

  if (parentIterationId) {
    summaryParts.push(`fork ${parentIterationId.slice(0, 10)}`);
  }

  return summaryParts.filter(Boolean).join(' · ');
}

function resolveStoredDatabasePath({ requestedDatabasePath, response }) {
  const candidate = String(
    requestedDatabasePath
      || response?.metadata?.sourcePath
      || response?.metadata?.databasePath
      || '',
  ).trim();

  return candidate;
}

function createEngineMessage(snapshot, turnCount, mode) {
  const templateFamily = snapshot.response?.metadata?.selectedTemplateFamily ?? 'balanced';
  const selectedEntity = snapshot.response?.metadata?.generation?.promptIntent?.selectedEntity
    ?? snapshot.response?.metadata?.generation?.promptIntent?.semanticIntent?.entity
    ?? 'n/a';
  const aggregation = snapshot.response?.metadata?.generation?.selectedDataBindings?.aggregation;

  return {
    id: `msg-engine-${snapshot.id}`,
    role: 'engine',
    text: `Dashboard ready: ${templateFamily} · ${selectedEntity}${aggregation ? ` · ${aggregation}` : ''}`,
    meta: `Turn ${turnCount} · ${mode}`,
    createdAt: snapshot.createdAt,
  };
}

function createUserMessage(snapshot, requestedTemplateFamily, mode) {
  const style = requestedTemplateFamily || 'auto';

  return {
    id: `msg-user-${snapshot.id}`,
    role: 'user',
    text: snapshot.prompt,
    meta: `Style: ${style} · ${mode}`,
    createdAt: snapshot.createdAt,
  };
}

async function ensureDashboardSession(sessionId) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const store = await loadStore();

  if (!store.sessions[normalizedSessionId]) {
    store.sessions[normalizedSessionId] = createEmptySession(normalizedSessionId);
    await persistStore();
  }

  return buildSessionSnapshot(store.sessions[normalizedSessionId]);
}

async function getDashboardSessionSnapshot(sessionId) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const store = await loadStore();
  const session = store.sessions[normalizedSessionId];

  if (!session) {
    return null;
  }

  return buildSessionSnapshot(session);
}

async function resetDashboardSession(sessionId) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const store = await loadStore();
  const existingSession = store.sessions[normalizedSessionId];
  const session = existingSession ?? createEmptySession(normalizedSessionId);
  const now = new Date().toISOString();

  session.turns = [];
  session.chatMessages = [];
  session.updatedAt = now;

  if (!existingSession) {
    session.createdAt = now;
  }

  store.sessions[normalizedSessionId] = session;
  await persistStore();

  return buildSessionSnapshot(session);
}

async function recordDashboardSessionTurn({
  sessionId,
  prompt,
  requestedTemplateFamily,
  requestedDatabasePath,
  mode,
  response,
}) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const normalizedMode = mode === 'incremental' ? 'incremental' : 'stateless';
  const store = await loadStore();
  const session = store.sessions[normalizedSessionId] ?? createEmptySession(normalizedSessionId);
  const parentIterationId = session.turns[0]?.id ?? null;
  const turnId = createTurnId();
  const now = new Date().toISOString();
  const turnCount = session.turns.length + 1;
  const responseWithSession = clone(response);

  responseWithSession.metadata = {
    ...responseWithSession.metadata,
    session: {
      sessionId: normalizedSessionId,
      turnId,
      turnCount,
      mode: normalizedMode,
      continuedFromTurnId: parentIterationId,
    },
  };

  const turnSnapshot = {
    id: turnId,
    parentIterationId,
    prompt: String(prompt || '').trim(),
    templateFamily: responseWithSession.metadata.selectedTemplateFamily,
    databasePath: resolveStoredDatabasePath({
      requestedDatabasePath,
      response: responseWithSession,
    }),
    createdAt: now,
    summary: formatTurnSummary(responseWithSession, parentIterationId),
    response: responseWithSession,
  };

  session.turns.unshift(turnSnapshot);
  if (session.turns.length > MAX_STORED_TURNS) {
    session.turns = session.turns.slice(0, MAX_STORED_TURNS);
  }

  session.chatMessages.push(
    createUserMessage(turnSnapshot, requestedTemplateFamily, normalizedMode),
    createEngineMessage(turnSnapshot, turnCount, normalizedMode),
  );

  if (session.chatMessages.length > MAX_STORED_CHAT_MESSAGES) {
    session.chatMessages = session.chatMessages.slice(-MAX_STORED_CHAT_MESSAGES);
  }

  session.updatedAt = now;
  store.sessions[normalizedSessionId] = session;

  await persistStore();

  return {
    response: responseWithSession,
    turnSnapshot: clone(turnSnapshot),
    sessionSnapshot: buildSessionSnapshot(session),
  };
}

module.exports = {
  ensureDashboardSession,
  getDashboardSessionSnapshot,
  recordDashboardSessionTurn,
  resetDashboardSession,
};
