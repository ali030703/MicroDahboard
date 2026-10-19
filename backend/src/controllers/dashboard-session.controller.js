// Purpose: Handles dashboard session HTTP requests and delegates session storage to services.
const {
  ensureDashboardSession,
  getDashboardSessionSnapshot,
  resetDashboardSession,
} = require('../services/dashboard-session.service');

function createSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function startDashboardSession(req, res) {
  try {
    const providedSessionId = String(req.body?.sessionId ?? '').trim();
    const sessionId = providedSessionId || createSessionId();
    const snapshot = await ensureDashboardSession(sessionId);

    res.status(201).json(snapshot);
  } catch (error) {
    console.error('FULL ERROR:', error);
    res.status(400).json({ error: error.message });
  }
}

async function getDashboardSession(req, res) {
  try {
    const snapshot = await getDashboardSessionSnapshot(req.params.sessionId);

    if (!snapshot) {
      res.status(404).json({ error: `Session "${req.params.sessionId}" not found.` });
      return;
    }

    res.json(snapshot);
  } catch (error) {
    console.error('FULL ERROR:', error);
    res.status(400).json({ error: error.message });
  }
}

async function resetDashboardSessionById(req, res) {
  try {
    const sessionId = String(req.body?.sessionId ?? '').trim();

    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required.' });
      return;
    }

    const snapshot = await resetDashboardSession(sessionId);
    res.json(snapshot);
  } catch (error) {
    console.error('FULL ERROR:', error);
    res.status(400).json({ error: error.message });
  }
}

module.exports = {
  getDashboardSession,
  resetDashboardSessionById,
  startDashboardSession,
};
