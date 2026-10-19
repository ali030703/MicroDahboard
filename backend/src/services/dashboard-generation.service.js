// Purpose: Orchestrates dashboard generation from natural-language prompts.
const { validateDashboardDefinition } = require('./dashboard-definition.service');
const {
  getDashboardSessionSnapshot,
  recordDashboardSessionTurn,
} = require('./dashboard-session.service');
const { resolveDatabaseSource } = require('./dashboard-database-source.service');
const { buildSemanticCatalog } = require('./dashboard-semantic-catalog.service');
const { enrichSchema, introspectSchema } = require('./dashboard-schema-profile.service');
const { resolveMicroorganismLookupContext } = require('./microorganism-dimension.service');
const {
  discoverMicroorganismCatalog,
  resolveMicroorganismsFromPrompt,
} = require('./microorganism-value-resolver.service');
const { SCHEMA, resolveMetric } = require('../config/schema');
const { clone, isObject } = require('./dashboard-generation/format.util');
const {
  parsePromptIntent,
  normalizeTemplateFamily,
  resolveBiologicalConcepts,
} = require('./dashboard-generation/prompt-intent-parser.service');
const { normalizePromptText, buildPromptTokenSet } = require('./dashboard-generation/prompt-text.util');
const { resolveMultiMeasureColumns } = require('./dashboard-generation/microorganism-binding.service');
const {
  augmentIntentWithDynamicColumns,
  augmentIntentWithSemanticCatalog,
  applyTemporalResolutionToIntent,
  applyMicroorganismResolutionToIntent,
  applyPromptBiologicalConceptFilter,
  isCircularMicroorganismGroupingRequest,
  getSingleMicroorganismUnderspecifiedViewType,
  mergeIntentWithSession,
} = require('./dashboard-generation/intent-enrichment.service');
const {
  buildDatasetPlan,
  resolvePhysicalPlanFromSemanticIntent,
  resolveTemplateFamily,
} = require('./dashboard-generation/dataset-plan-builder.service');
const {
  buildDashboardDefinition,
  buildBlueprint,
  buildDefinitionId,
  formatMeasureSeriesRows,
} = require('./dashboard-generation/dashboard-definition-builder.service');
const { buildGenerationExplanation } = require('./dashboard-generation/generation-explanation.service');
const {
  ensureCategoryMapsLoaded,
  validateDashboardPrompt,
  assertPromptRequirementsAvailable,
  quickDiagnosis,
  createAmbiguousMicroorganismPromptError,
  createCircularMicroorganismGroupingError,
  createSingleMicroorganismChartError,
  createSingleMicroorganismTableError,
  createLowConfidencePromptError,
} = require('./dashboard-generation/prompt-validation.service');

const EXCLUDED_DASHBOARD_TABLES = new Set();
const MICROORGANISM_SCHEMA = SCHEMA.microorganism;

// Recomputes the biological-concept fields (concept, microbeConcept,
// broadMicrobeView, biologicalConcepts) scoped to a single visual request's
// clause text, instead of inheriting the values resolved over the whole
// prompt. Without this, a concept mentioned only in one clause (e.g. "Yeast"
// in the chart clause) leaked into every other request (e.g. the table)
// via the `...intent` spread, because resolveBiologicalConcepts() was only
// ever called once, globally, in parsePromptIntent().
function buildRequestScopedBiologicalConcept(rawClauseText) {
  const clauseNormalized = normalizePromptText(rawClauseText || '');
  const clauseTokens = buildPromptTokenSet(clauseNormalized);
  const clauseBiologicalConcepts = resolveBiologicalConcepts(clauseNormalized, clauseTokens);

  return {
    concept: {
      primary: clauseBiologicalConcepts.primaryConcept,
      broad: clauseBiologicalConcepts.broadMicrobeView,
      groups: clauseBiologicalConcepts.concepts.map((entry) => ({
        key: entry.key,
        meaning: entry.meaning,
        members: Array.isArray(entry.members) ? entry.members : [],
        expandsTo: Array.isArray(entry.expandsTo) ? entry.expandsTo : [],
      })),
    },
    microbeConcept: clauseBiologicalConcepts.primaryConcept,
    broadMicrobeView: clauseBiologicalConcepts.broadMicrobeView,
    biologicalConcepts: clauseBiologicalConcepts.concepts.map((item) => item.key),
  };
}

async function generateDashboardFromPrompt({
  prompt,
  databasePath,
  databaseDefinition,
  templateFamily,
  sessionId,
  mode,
}) {
  await ensureCategoryMapsLoaded();
  const normalizedPrompt = String(prompt || '').trim();
  validateDashboardPrompt(normalizedPrompt);
  if (!normalizedPrompt) {
    throw new Error('Prompt is required.');
  }

  const normalizedMode = mode === 'incremental' ? 'incremental' : 'stateless';
  const sessionSnapshot = sessionId ? await getDashboardSessionSnapshot(sessionId) : null;
  const previousTurn = sessionSnapshot?.turns?.[0] ?? null;
  const previousPromptIntent = previousTurn?.response?.metadata?.generation?.promptIntent ?? null;
  const currentDatabaseDefinition = isObject(databaseDefinition) ? databaseDefinition : null;
  const previousDatabaseDefinition = isObject(previousTurn?.response?.metadata?.databaseDefinition)
    ? previousTurn.response.metadata.databaseDefinition
    : null;
  const explicitDatabasePath = String(databasePath || '').trim() || null;
  
  const fallbackDatabaseDefinition = currentDatabaseDefinition || (!explicitDatabasePath ? previousDatabaseDefinition : null);
  const fallbackDatabasePath = fallbackDatabaseDefinition
    ? null
    : (explicitDatabasePath || String(
      previousTurn?.databasePath
        || previousTurn?.response?.metadata?.sourcePath
        || previousTurn?.response?.metadata?.databasePath
        || '',
    ).trim() || null);

  const resolvedSource = await resolveDatabaseSource({
    requestedPath: fallbackDatabasePath,
    databaseDefinition: fallbackDatabaseDefinition,
  });

  const db = resolvedSource.adapter;

  try {
    const schema = await introspectSchema(db, { excludedTables: EXCLUDED_DASHBOARD_TABLES });

    if (!schema.length) {
      throw new Error('The database does not contain usable tables.');
    }

    const parsedIntent = parsePromptIntent(normalizedPrompt);
    const isCorrelationQuery = /correlat|relationship|affect|impact/i.test(normalizedPrompt);
    parsedIntent.analysisMode = isCorrelationQuery ? 'correlation' : 'standard';

    const schemaProfiles = await enrichSchema(db, schema);
    const semanticCatalog = buildSemanticCatalog({
      schemaProfiles,
      databaseDefinition: resolvedSource.databaseDefinition || fallbackDatabaseDefinition,
    });
    const microorganismLookupContext = await resolveMicroorganismLookupContext(db);
    const microorganismCatalog = await discoverMicroorganismCatalog({
      db,
      schemaProfiles,
      primaryTableName: semanticCatalog.primaryTable,
      semanticCatalog,
      lookupContext: microorganismLookupContext,
    });
    semanticCatalog.microorganisms = {
      version: microorganismCatalog.version,
      source: microorganismCatalog.source,
      table: microorganismCatalog.table,
      lookupTable: microorganismCatalog.lookupTable,
      idColumn: microorganismCatalog.idColumn,
      nameColumn: microorganismCatalog.nameColumn,
      filterColumn: microorganismCatalog.filterColumn,
      filterValueField: microorganismCatalog.filterValueField,
      dimensionColumn: microorganismCatalog.dimensionColumn,
      values: microorganismCatalog.values,
    };
    assertPromptRequirementsAvailable({
      normalizedPrompt,
      schemaProfiles,
      semanticCatalog,
    });
    const intentSeed = parsedIntent;

    const usedPreviousSessionIntent = false;
    let intent = normalizedMode === 'incremental'
      ? mergeIntentWithSession(intentSeed, previousPromptIntent)
      : intentSeed;

    intent.analysisMode = parsedIntent.analysisMode || intent.analysisMode;

    const resolvedTemplateFamily = resolveTemplateFamily(
      templateFamily,
      intent,
      previousTurn?.response?.metadata?.selectedTemplateFamily,
    );
    let executionPlan = resolvePhysicalPlanFromSemanticIntent(schemaProfiles, intent, semanticCatalog);
    let semanticQuery = executionPlan.semanticQuery;
    let primaryTable = executionPlan.primaryTable;

    if (!primaryTable) {
      throw new Error('Unable to identify a table to use for the dashboard.');
    }

    intent = augmentIntentWithDynamicColumns(intent, primaryTable);
    intent = augmentIntentWithSemanticCatalog(intent, primaryTable, semanticCatalog);
    intent = applyTemporalResolutionToIntent(intent, primaryTable, semanticCatalog);
    const microorganismResolution = resolveMicroorganismsFromPrompt(normalizedPrompt, microorganismCatalog);

    if (microorganismResolution.status === 'ambiguous') {
      throw createAmbiguousMicroorganismPromptError(microorganismResolution, semanticCatalog);
    }

    intent = applyMicroorganismResolutionToIntent({
      intent,
      resolution: microorganismResolution,
      microorganismCatalog,
    });

    if (isCircularMicroorganismGroupingRequest(intent)) {
      throw createCircularMicroorganismGroupingError(intent, semanticCatalog);
    }

    const underspecifiedSingleMicroorganismView = getSingleMicroorganismUnderspecifiedViewType(intent);

    if (underspecifiedSingleMicroorganismView === 'chart') {
      throw createSingleMicroorganismChartError(intent, semanticCatalog);
    }

    if (underspecifiedSingleMicroorganismView === 'table') {
      throw createSingleMicroorganismTableError(intent, semanticCatalog);
    }

    executionPlan = resolvePhysicalPlanFromSemanticIntent(schemaProfiles, intent, semanticCatalog);
    semanticQuery = executionPlan.semanticQuery;
    primaryTable = executionPlan.primaryTable || primaryTable;

    intent = await applyPromptBiologicalConceptFilter({
      db,
      prompt: normalizedPrompt,
      intent,
      primaryTable,
    });

    executionPlan = resolvePhysicalPlanFromSemanticIntent(schemaProfiles, intent, semanticCatalog);
    semanticQuery = executionPlan.semanticQuery;
    primaryTable = executionPlan.primaryTable || primaryTable;

    const dimensionColumn = executionPlan.dimensionColumn;
    
    await quickDiagnosis(db, intent, primaryTable, dimensionColumn);

    const measureColumn = executionPlan.measureColumn;
    
    const baseMeasureColumns = resolveMultiMeasureColumns(primaryTable, intent, measureColumn);
    const { categoryLimit, queries, previewColumns } = buildDatasetPlan({
      primaryTable,
      dimensionColumn,
      measureColumn,
      measureColumns: baseMeasureColumns,
      templateFamily: resolvedTemplateFamily,
      intent,
      microorganismLookupContext,
    });

    const [overview, categoryCounts, measureByDimension, categoryMetrics, preview] = await Promise.all([
      db.get(queries.stats),
      queries.category ? db.all(queries.category) : Promise.resolve([]),
      queries.measureByDimension ? db.all(queries.measureByDimension) : Promise.resolve([]),
      queries.categoryMetrics ? db.all(queries.categoryMetrics) : Promise.resolve([]),
      db.all(queries.preview),
    ]);

    const visualRequests = Array.isArray(intent.visualRequests) ? intent.visualRequests.filter(Boolean) : [];
    const requestScopedDatasets = {};
    const enrichedVisualRequests = [];

    for (const [requestIndex, request] of visualRequests.entries()) {
      const requestMetricKeys = [
        ...(Array.isArray(request?.semanticMetricKeys) ? request.semanticMetricKeys : []),
        request?.semanticMetricKey,
      ]
        .filter(Boolean)
        .filter((value, index, list) => list.indexOf(value) === index);

      // Scope biological-concept fields (concept/microbeConcept/broadMicrobeView/
      // biologicalConcepts) to this request's own clause text, instead of the
      // `...intent` spread leaking whatever was resolved over the full prompt.
      const requestScopedConcept = buildRequestScopedBiologicalConcept(request?.rawPrompt);

      let requestIntent = {
        ...intent,
        ...requestScopedConcept,
        visualRequests: [request],
        filters: Array.isArray(request?.filters) ? request.filters : [],
        aggregation: request?.aggregation || intent.aggregation,
        chartTemplate: request?.chartTemplate || intent.chartTemplate,
        comparisonQuery: requestMetricKeys.length >= 2
          ? {
            type: 'comparison',
            measures: requestMetricKeys.map((metricKey) => ({ semanticMetric: metricKey, column: metricKey })),
          }
          : null,
        allMeasureComparison: requestMetricKeys.length >= 2,
      };

      if (requestMetricKeys.length > 0) {
        requestIntent.selectedMetric = resolveMetric(requestMetricKeys[0], MICROORGANISM_SCHEMA) || requestIntent.selectedMetric;
      }

      const requestMicroorganismResolution = resolveMicroorganismsFromPrompt(request?.rawPrompt || '', microorganismCatalog);
      if (requestMicroorganismResolution.status === 'ambiguous') {
        throw createAmbiguousMicroorganismPromptError(requestMicroorganismResolution, semanticCatalog);
      }

      requestIntent = applyMicroorganismResolutionToIntent({
        intent: requestIntent,
        resolution: requestMicroorganismResolution,
        microorganismCatalog,
      });

      const requestMeasureColumns = resolveMultiMeasureColumns(primaryTable, requestIntent, measureColumn);
      const requestPlan = buildDatasetPlan({
        primaryTable,
        dimensionColumn,
        measureColumn,
        measureColumns: requestMeasureColumns,
        templateFamily: resolvedTemplateFamily,
        intent: requestIntent,
        microorganismLookupContext,
      });
      enrichedVisualRequests.push({
        ...request,
        semanticMetricKeys: requestMetricKeys,
        resolvedMeasureColumns: requestMeasureColumns.map((column) => column?.name).filter(Boolean),
        previewColumns: requestPlan.previewColumns,
        microorganismNames: (requestMicroorganismResolution.matches || []).map((match) => match?.name).filter(Boolean),
      });

      const [requestOverview, requestCategoryCounts, requestMeasureByDimension, requestCategoryMetrics, requestPreview] = await Promise.all([
        db.get(requestPlan.queries.stats),
        requestPlan.queries.category ? db.all(requestPlan.queries.category) : Promise.resolve([]),
        requestPlan.queries.measureByDimension ? db.all(requestPlan.queries.measureByDimension) : Promise.resolve([]),
        requestPlan.queries.categoryMetrics ? db.all(requestPlan.queries.categoryMetrics) : Promise.resolve([]),
        db.all(requestPlan.queries.preview),
      ]);

      requestScopedDatasets[`request_${requestIndex}`] = {
        overview: requestOverview ?? {},
        categoryCounts: requestCategoryCounts,
        categoryMetrics: requestCategoryMetrics,
        measureByDimension: formatMeasureSeriesRows(requestMeasureByDimension, requestMeasureColumns),
        preview: requestPreview,
        stats: requestOverview ?? {},
        byType: requestCategoryCounts,
        microbes: requestPreview,
        sizes: requestCategoryCounts,
      };
    }

    if (enrichedVisualRequests.length >= 2) {
      intent = {
        ...intent,
        visualRequests: enrichedVisualRequests,
      };
    }

    const id = buildDefinitionId(normalizedPrompt || primaryTable.name);
    
    const dashboardDefinition = buildDashboardDefinition({
      prompt: normalizedPrompt,
      id,
      primaryTable,
      dimensionColumn,
      measureColumn,
      measureColumns: resolveMultiMeasureColumns(primaryTable, intent, measureColumn),
      previewRows: preview,
      templateFamily: resolvedTemplateFamily,
      intent,
      categoryLimit,
      hasCategoryData: Boolean(queries.category),
      hasMeasureByDimensionData: Boolean(queries.measureByDimension || queries.categoryMetrics),
      previewColumns,
    });

    await validateDashboardDefinition(dashboardDefinition);

    const blueprint = buildBlueprint(resolvedTemplateFamily, intent, {
      hasCategoryChart: Boolean(queries.category),
      hasMeasureChart: Boolean(queries.measureByDimension || queries.categoryMetrics),
      hasTable: Object.keys(preview[0] ?? {}).length > 0,
    });

    const generation = buildGenerationExplanation({
      requestedTemplateFamily: normalizeTemplateFamily(templateFamily),
      selectedTemplateFamily: resolvedTemplateFamily,
      intent,
      primaryTable,
      dimensionColumn,
      measureColumn,
      categoryLimit,
      blueprint,
      sessionMode: normalizedMode,
      usedPreviousSessionIntent,
      sourceType: resolvedSource.sourceType,
      sourcePath: resolvedSource.sourcePath ?? null,
    });

    if (generation.promptConfidence?.label === 'Low') {
      throw createLowConfidencePromptError(generation.promptConfidence, semanticCatalog);
    }

    const responsePayload = {
      dashboardDefinition,
      datasets: {
        dataset: {
          overview: overview ?? {},
          categoryCounts,
          categoryMetrics,
          measureByDimension: formatMeasureSeriesRows(measureByDimension, baseMeasureColumns),
          preview,
          stats: overview ?? {},
          byType: categoryCounts,
          microbes: preview,
          sizes: categoryCounts,
          ...requestScopedDatasets,
        },
      },
      metadata: {
        databasePath: resolvedSource.databasePath,
        sourceType: resolvedSource.sourceType,
        sourcePath: resolvedSource.sourcePath ?? null,
        databaseDefinition: resolvedSource.databaseDefinition ? clone(resolvedSource.databaseDefinition) : null,
        selectedTable: primaryTable.name,
        resolvedTable: primaryTable.name,
        selectedTemplateFamily: resolvedTemplateFamily,

        executedQueries: queries,
        schema,
        semanticCatalog,
        promptStructure: {
          concept: parsedIntent.concept,
          semanticIntent: parsedIntent.semanticIntent,
          filters: parsedIntent.filters,
          instruction: parsedIntent.instruction,
          visualRequests: parsedIntent.visualRequests ?? [],
        },
        generation,
        semanticQuery,
      },
    };

    let resultPayload = responsePayload;

    if (sessionId) {
      const sessionRecord = await recordDashboardSessionTurn({
        sessionId,
        prompt: normalizedPrompt,
        requestedTemplateFamily: normalizeTemplateFamily(templateFamily),
        requestedDatabasePath: resolvedSource.sourcePath ?? fallbackDatabasePath,
        mode: normalizedMode,
        response: responsePayload,
      });
      resultPayload = sessionRecord.response;
    }

    return JSON.parse(JSON.stringify(resultPayload));

  } catch (error) {
    if (error?.code !== 'INVALID_PROMPT') {
      console.error('ERROR during dashboard generation:', error);
    }
    throw error;
  } finally {
    if (db && typeof db.close === 'function' && !resolvedSource.persistent) {
      await db.close();
    }
    if (resolvedSource.cleanup) {
      await resolvedSource.cleanup();
    }
  }
}

module.exports = {
  generateDashboardFromPrompt,
};