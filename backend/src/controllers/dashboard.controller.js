// Purpose: Handles dashboard HTTP requests and delegates dashboard work to services.
const {
  createDashboardDefinition,
  getDashboardDefinitionById,
  listDashboardDefinitions,
  readDashboardEngineRegistry,
  updateDashboardDefinition,
} = require('../services/dashboard-definition.service');
const { generateDashboardFromPrompt } = require('../services/dashboard-generation.service');
const { renderDashboardPayload } = require('../services/dashboard-render.service');
const { buildDashboardSemanticCatalogResponse } = require('../services/dashboard-semantic-catalog-api.service');

function resolveRequestDatabaseDefinition(body = {}) {
  return body?.databaseDefinition
    ?? (body?.tables && typeof body.tables === 'object' && !Array.isArray(body.tables)
      ? {
        database: body?.database,
        tables: body.tables,
        semanticHints: body?.semanticHints,
        semanticCatalog: body?.semanticCatalog,
        labels: body?.labels,
        displayLabels: body?.displayLabels,
        aliases: body?.aliases,
      }
      : undefined);
}

function shouldLogDashboardError(error) {
  return !['INVALID_PROMPT', 'INVALID_DASHBOARD_PAYLOAD'].includes(error.code);
}

async function getDashboardSchema(req, res) {
  try {
    const registry = await readDashboardEngineRegistry();
    res.json(registry);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function listDashboards(req, res) {
  try {
    const definitions = await listDashboardDefinitions();
    res.json(definitions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getDashboardById(req, res) {
  try {
    const definition = await getDashboardDefinitionById(req.params.id);

    if (!definition) {
      res.status(404).json({ error: `Dashboard "${req.params.id}" not found` });
      return;
    }

    res.json(definition);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function createDashboard(req, res) {
  try {
    const created = await createDashboardDefinition(req.body);
    res.status(201).json(created);
  } catch (error) {
    const statusCode = error.message.includes('already exists') ? 409 : 400;
    res.status(statusCode).json({ error: error.message });
  }
}

async function updateDashboard(req, res) {
  try {
    const updated = await updateDashboardDefinition(req.params.id, req.body);
    res.json(updated);
  } catch (error) {
    console.error('FULL ERROR:', error);
    res.status(400).json({ error: error.message });
  }
}

async function generateDashboard(req, res) {
  try {
    const databaseDefinition = resolveRequestDatabaseDefinition(req.body);

    const generated = await generateDashboardFromPrompt({
      prompt: req.body?.prompt ?? '',
      databasePath: req.body?.databasePath,
      databaseDefinition,
      templateFamily: req.body?.templateFamily,
      sessionId: req.body?.sessionId,
      mode: req.body?.mode,
    });

    res.status(201).json(generated);
  } catch (error) {
    if (shouldLogDashboardError(error)) {
      console.error('FULL ERROR:', error);
    }

    if (error.code === 'INVALID_PROMPT') {
      res.status(422).json({
        error: error.message,
        code: error.code,
        promptHelp: error.promptHelp,
      });
      return;
    }

    res.status(400).json({ error: error.message });
  }
}

async function getSemanticCatalog(req, res) {
  try {
    const catalog = await buildDashboardSemanticCatalogResponse({
      databasePath: req.query?.databasePath,
    });

    res.json(catalog);
  } catch (error) {
    console.error('FULL ERROR:', error);
    res.status(400).json({
      error: error.message,
      code: 'SEMANTIC_CATALOG_ERROR',
    });
  }
}

async function createSemanticCatalog(req, res) {
  try {
    const catalog = await buildDashboardSemanticCatalogResponse({
      databasePath: req.body?.databasePath,
      databaseDefinition: resolveRequestDatabaseDefinition(req.body),
    });

    res.status(201).json(catalog);
  } catch (error) {
    console.error('FULL ERROR:', error);
    res.status(400).json({
      error: error.message,
      code: 'SEMANTIC_CATALOG_ERROR',
    });
  }
}

async function renderDashboard(req, res) {
  try {
    const rendered = await renderDashboardPayload({
      dashboardDefinition: req.body?.dashboardDefinition,
      datasets: req.body?.datasets,
      metadata: req.body?.metadata,
      sessionId: req.body?.sessionId,
    });

    res.status(201).json(rendered);
  } catch (error) {
    if (shouldLogDashboardError(error)) {
      console.error('FULL ERROR:', error);
    }

    if (error.code === 'INVALID_PROMPT') {
      res.status(422).json({
        error: error.message,
        code: error.code,
        promptHelp: error.promptHelp,
      });
      return;
    }

    res.status(400).json({
      error: error.message,
      code: error.code || 'INVALID_DASHBOARD_PAYLOAD',
      ...(error.details ? { details: error.details } : {}),
    });
  }
}

module.exports = {
  createDashboard,
  createSemanticCatalog,
  generateDashboard,
  getDashboardById,
  getDashboardSchema,
  getSemanticCatalog,
  listDashboards,
  renderDashboard,
  updateDashboard,
};
