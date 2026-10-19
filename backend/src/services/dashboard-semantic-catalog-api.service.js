// Purpose: Builds chatbot-facing semantic catalog responses from the active dashboard database source.
const { resolveDatabaseSource } = require('./dashboard-database-source.service');
const { enrichSchema, introspectSchema } = require('./dashboard-schema-profile.service');
const {
  buildPromptHelpFromCatalog,
  buildSemanticCatalog,
} = require('./dashboard-semantic-catalog.service');
const { resolveMicroorganismLookupContext } = require('./microorganism-dimension.service');
const { discoverMicroorganismCatalog } = require('./microorganism-value-resolver.service');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toPublicCatalogEntry(entry) {
  return {
    key: entry.key,
    table: entry.table,
    column: entry.column,
    label: entry.label,
    type: entry.type,
    aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
    preferred: Boolean(entry.preferred),
    ...(entry.aggregation ? { aggregation: entry.aggregation } : {}),
  };
}

function toPublicMicroorganismCatalog(microorganismCatalog) {
  return {
    version: microorganismCatalog.version,
    source: microorganismCatalog.source,
    table: microorganismCatalog.table,
    lookupTable: microorganismCatalog.lookupTable,
    idColumn: microorganismCatalog.idColumn,
    nameColumn: microorganismCatalog.nameColumn,
    filterColumn: microorganismCatalog.filterColumn,
    filterValueField: microorganismCatalog.filterValueField,
    dimensionColumn: microorganismCatalog.dimensionColumn,
    values: Array.isArray(microorganismCatalog.values)
      ? microorganismCatalog.values.map((value) => ({
        id: value.id,
        name: value.name,
        aliases: Array.isArray(value.aliases) ? value.aliases : [],
      }))
      : [],
  };
}

function toPublicSchema(schemaProfiles) {
  return schemaProfiles.map((table) => ({
    name: table.name,
    rowCount: table.rowCount,
    columns: table.columns.map((column) => ({
      name: column.name,
      type: column.type,
      valueSample: column.valueSample ?? null,
    })),
    numericColumns: table.numericColumns.map((column) => column.name),
    dimensionColumns: table.dimensionColumns.map((column) => column.name),
    temporalColumns: table.temporalColumns.map((column) => column.name),
  }));
}

async function buildDashboardSemanticCatalogResponse({
  databasePath,
  databaseDefinition,
} = {}) {
  const resolvedSource = await resolveDatabaseSource({
    requestedPath: databasePath,
    databaseDefinition,
  });
  const db = resolvedSource.adapter;

  try {
    const rawSchema = await introspectSchema(db);

    if (!rawSchema.length) {
      throw new Error('The database does not contain usable tables.');
    }

    const schemaProfiles = await enrichSchema(db, rawSchema);
    const semanticCatalog = buildSemanticCatalog({
      schemaProfiles,
      databaseDefinition: resolvedSource.databaseDefinition || databaseDefinition,
    });
    const microorganismLookupContext = await resolveMicroorganismLookupContext(db);
    const microorganismCatalog = await discoverMicroorganismCatalog({
      db,
      schemaProfiles,
      primaryTableName: semanticCatalog.primaryTable,
      semanticCatalog,
      lookupContext: microorganismLookupContext,
    });
    const publicMicroorganisms = toPublicMicroorganismCatalog(microorganismCatalog);
    const publicCatalog = {
      version: semanticCatalog.version,
      source: semanticCatalog.source,
      primaryTable: semanticCatalog.primaryTable,
      metrics: semanticCatalog.metrics.map(toPublicCatalogEntry),
      dimensions: semanticCatalog.dimensions.map(toPublicCatalogEntry),
      labels: clone(semanticCatalog.labels),
      promptFields: semanticCatalog.promptFields,
      microorganisms: publicMicroorganisms,
    };

    return {
      semanticCatalog: publicCatalog,
      schema: toPublicSchema(schemaProfiles),
      promptHelp: buildPromptHelpFromCatalog(publicCatalog),
      contract: {
        renderEndpoint: '/api/dashboard/render',
        requiredPayload: ['dashboardDefinition', 'datasets'],
        optionalPayload: ['metadata', 'sessionId'],
        lowConfidenceThreshold: 0.55,
        supportedChartTemplates: ['bar', 'line', 'scatter', 'doughnut', 'polar'],
        supportedTransforms: ['collection', 'keyValue', 'table'],
      },
      metadata: {
        sourceType: resolvedSource.sourceType,
        sourcePath: resolvedSource.sourcePath ?? null,
        databasePath: resolvedSource.databasePath,
        databaseDefinition: resolvedSource.databaseDefinition ? clone(resolvedSource.databaseDefinition) : null,
        selectedTable: semanticCatalog.primaryTable,
      },
    };
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
  buildDashboardSemanticCatalogResponse,
};
