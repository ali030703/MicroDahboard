// Purpose: Defines microorganism semantic schema metadata, prompt aliases, and schema helper functions.
const MICROORGANISM_DIMENSION_META = {
  area: { column: 'Area', label: 'Area', categoryId: 1, aliases: ['area'] },
  perimeter: { column: 'Perimeter', label: 'Perimeter', categoryId: 2, aliases: ['perimeter'] },
  eccentricity: { column: 'Eccentricity', label: 'Eccentricity', categoryId: 3, aliases: ['eccentricity'] },
  solidity: { column: 'Solidity', label: 'Solidity', categoryId: 4, aliases: ['solidity'] },
  radius: { column: 'raddi', label: 'Radius', categoryId: 5, aliases: ['radius', 'raddi'] },
  equivdiameter: { column: 'EquivDiameter', label: 'Equivalent Diameter', categoryId: 6, aliases: ['equivdiameter', 'equivalentdiameter', 'equivalent diameter'] },
  extrema: { column: 'Extrema', label: 'Extrema', categoryId: 25, aliases: ['extrema', 'extreme points'] },
  filledarea: { column: 'FilledArea', label: 'Filled Area', categoryId: 7, aliases: ['filledarea', 'filled area'] },
  extent: { column: 'Extent', label: 'Extent', categoryId: 8, aliases: ['extent'] },
  orientation: { column: 'Orientation', label: 'Orientation', categoryId: 9, aliases: ['orientation'] },
  eulernumber: { column: 'EulerNumber', label: 'Euler Number', categoryId: 10, aliases: ['eulernumber', 'euler number'] },
  boundingbox1: { column: 'BoundingBox1', label: 'Bounding Box 1', categoryId: 11, aliases: ['boundingbox1', 'bounding box 1'] },
  boundingbox2: { column: 'BoundingBox2', label: 'Bounding Box 2', categoryId: 12, aliases: ['boundingbox2', 'bounding box 2'] },
  boundingbox3: { column: 'BoundingBox3', label: 'Bounding Box 3', categoryId: 13, aliases: ['boundingbox3', 'bounding box 3'] },
  boundingbox4: { column: 'BoundingBox4', label: 'Bounding Box 4', categoryId: 14, aliases: ['boundingbox4', 'bounding box 4'] },
  convexhull1: { column: 'ConvexHull1', label: 'Convex Hull 1', categoryId: 15, aliases: ['convexhull1', 'convex hull 1'] },
  convexhull2: { column: 'ConvexHull2', label: 'Convex Hull 2', categoryId: 16, aliases: ['convexhull2', 'convex hull 2'] },
  convexhull3: { column: 'ConvexHull3', label: 'Convex Hull 3', categoryId: 17, aliases: ['convexhull3', 'convex hull 3'] },
  convexhull4: { column: 'ConvexHull4', label: 'Convex Hull 4', categoryId: 18, aliases: ['convexhull4', 'convex hull 4'] },
  majoraxislength: { column: 'MajorAxisLength', label: 'Major Axis Length', categoryId: 19, aliases: ['majoraxislength', 'major axis length'] },
  minoraxislength: { column: 'MinorAxisLength', label: 'Minor Axis Length', categoryId: 20, aliases: ['minoraxislength', 'minor axis length'] },
  convexarea: { column: 'ConvexArea', label: 'Convex Area', categoryId: 21, aliases: ['convexarea', 'convex area'] },
  centroid1: { column: 'Centroid1', label: 'Centroid X', categoryId: 22, aliases: ['centroid1', 'centroid x'] },
  centroid2: { column: 'Centroid2', label: 'Centroid Y', categoryId: 23, aliases: ['centroid2', 'centroid y'] },
  microorganisms: { column: 'microorganisms', label: 'Microorganism', categoryId: 24, aliases: ['microorganism', 'microorganisms', 'microbe', 'microbes', 'organism', 'organisms', 'species'] },
};

const SEMANTIC_ENTITIES = {
  organism: {
    label: 'Organism',
    description: 'Biological organism observed in the dataset',
    defaultDimension: 'species',
    defaultMetric: 'count',
    aliases: ['organism', 'organisms', 'microorganism', 'microorganisms', 'microbe', 'microbes', 'bacteria', 'fungi', 'species'],
  },
};

const SEMANTIC_METRICS = {
  count: {
    label: 'Count',
    kind: 'quantitative',
    defaultAggregation: 'count',
    aliases: ['count', 'counts', 'number', 'frequency', 'occurrence', 'total'],
  },
  area: {
    label: 'Area',
    kind: 'quantitative',
    defaultAggregation: 'avg',
    aliases: ['area'],
  },
  perimeter: {
    label: 'Perimeter',
    kind: 'quantitative',
    defaultAggregation: 'avg',
    aliases: ['perimeter'],
  },
  eccentricity: {
    label: 'Eccentricity',
    kind: 'quantitative',
    defaultAggregation: 'avg',
    aliases: ['eccentricity'],
  },
  solidity: {
    label: 'Solidity',
    kind: 'quantitative',
    defaultAggregation: 'avg',
    aliases: ['solidity'],
  },
  radius: {
    label: 'Radius',
    kind: 'quantitative',
    defaultAggregation: 'avg',
    aliases: ['radius', 'raddi'],
  },
  extrema: {
    label: 'Extrema',
    kind: 'quantitative',
    defaultAggregation: 'avg',
    aliases: ['extrema', 'extreme points'],
  },
};

// Expose morphology categories as semantic metrics so every measurable
// category can be referenced like area, perimeter, or solidity in prompts.
Object.entries(MICROORGANISM_DIMENSION_META).forEach(([dimKey, dimMeta]) => {
  const metricKey = normalizeSchemaKey(dimKey);
  if (!SEMANTIC_METRICS[metricKey]) {
    const isOrganismLabelMetric = metricKey === 'microorganisms';
    SEMANTIC_METRICS[metricKey] = {
      label: dimMeta.label || String(dimMeta.column || dimKey),
      kind: isOrganismLabelMetric ? 'categorical' : 'quantitative',
      defaultAggregation: isOrganismLabelMetric ? 'count' : 'avg',
      aliases: Array.isArray(dimMeta.aliases) ? dimMeta.aliases.concat([dimKey]) : [dimKey],
    };
  }
});

const SEMANTIC_DIMENSIONS = {
  species: {
    label: 'Species',
    entity: 'organism',
    grain: 'category',
    aliases: ['species', 'type', 'class', 'taxonomy', 'group', 'category', 'microorganism', 'microbe'],
  },
  fungi: {
    label: 'Fungi',
    entity: 'organism',
    grain: 'category',
    aliases: ['fungi', 'fungus', 'yeast'],
  },
  size: {
    label: 'Size',
    entity: 'organism',
    grain: 'numeric',
    aliases: ['size', 'size group', 'sizegroup'],
  },
  time: {
    label: 'Time',
    entity: 'organism',
    grain: 'temporal',
    aliases: ['time', 'date', 'timeline', 'trend'],
  },
};

const SEMANTIC_PHYSICAL_BINDINGS = {
  defaultTable: 'microbes',
  entities: {
    organism: {
      table: 'microbes',
      idColumn: 'microorganism_id',
      labelColumn: 'microorganisms',
    },
  },
  dimensions: {
    species: {
      table: 'microbes',
      column: 'microorganism_id',
      labelColumn: 'microorganism_name',
      join: {
        type: 'left',
        table: 'microorganism_dim',
        on: [{ leftColumn: 'microorganism_id', rightColumn: 'microorganism_id' }],
      },
    },
    fungi: {
      table: 'microbes',
      column: 'microorganism_id',
      labelColumn: 'microorganism_name',
      join: {
        type: 'left',
        table: 'microorganism_dim',
        on: [{ leftColumn: 'microorganism_id', rightColumn: 'microorganism_id' }],
      },
    },
    size: {
      table: 'microbes',
      column: 'Area',
      labelColumn: 'Area',
    },
  },
  metrics: {
    count: {
      column: null,
      aggregation: 'count',
    },
    area: {
      column: 'Area',
      aggregation: 'avg',
    },
    perimeter: {
      column: 'Perimeter',
      aggregation: 'avg',
    },
    eccentricity: {
      column: 'Eccentricity',
      aggregation: 'avg',
    },
    solidity: {
      column: 'Solidity',
      aggregation: 'avg',
    },
    radius: {
      column: 'raddi',
      aggregation: 'avg',
    },
    extrema: {
      column: 'Extrema',
      aggregation: 'avg',
    },
  },
};

// Ensure physical bindings include all morphology category metrics.
Object.entries(MICROORGANISM_DIMENSION_META).forEach(([dimKey, dimMeta]) => {
  const metricKey = normalizeSchemaKey(dimKey);
  if (!SEMANTIC_PHYSICAL_BINDINGS.metrics[metricKey]) {
    const isOrganismLabelMetric = metricKey === 'microorganisms';
    SEMANTIC_PHYSICAL_BINDINGS.metrics[metricKey] = {
      column: dimMeta.column || null,
      aggregation: isOrganismLabelMetric ? 'count' : 'avg',
    };
  }
});

const MICROORGANISM_CATEGORIES = Object.entries(MICROORGANISM_DIMENSION_META).map(([key, meta]) => ({
  category_id: meta.categoryId,
  category_name: meta.column,
  key,
  column: meta.column,
  label: meta.label,
}));

function buildSemanticLookup(registry) {
  const byKey = new Map();
  const byAlias = new Map();

  Object.entries(registry || {}).forEach(([key, entry]) => {
    const normalizedKey = normalizeSchemaKey(key);
    byKey.set(normalizedKey, { key, ...entry });

    for (const alias of entry.aliases || []) {
      byAlias.set(normalizeSchemaKey(alias), { key, ...entry });
    }
  });

  return { byKey, byAlias };
}

const SCHEMA = {
  microorganism: {
    table: 'microbes',
    id: 'microorganism_id',
    labelColumn: 'microorganisms',
    tableLabel: 'Microbe Records',
    lookup: {
      table: 'microorganism_dim',
      id: 'microorganism_id',
      name: 'microorganism_name',
    },
    dimensions: Object.fromEntries(
      Object.entries(MICROORGANISM_DIMENSION_META).map(([key, meta]) => [key, meta.column]),
    ),
    dimensionMeta: MICROORGANISM_DIMENSION_META,
    categories: MICROORGANISM_CATEGORIES,
    preferredMeasures: [
      'area',
      'perimeter',
      'solidity',
      'eccentricity',
      'radius',
      'equivdiameter',
      'extrema',
      'majoraxislength',
      'minoraxislength',
      'convexarea',
      'extent',
      'orientation',
      'eulernumber',
      'filledarea',
    ],
    excludedDimensionKeys: [
      'orientation',
      'centroid1',
      'centroid2',
      'boundingbox1',
      'boundingbox2',
      'boundingbox3',
      'boundingbox4',
      'convexhull1',
      'convexhull2',
      'convexhull3',
      'convexhull4',
      'extrema',
      'eulernumber',
      'a',
      'centroid',
      'boundingbox',
      'convexhull',
    ],
    dimensionKeywords: ['microorganism', 'microbe', 'organism', 'species', 'fungi', 'fungus', 'yeast'],
    promptAliases: {
      microorganism: 'microorganism',
      microorganisms: 'microorganism',
      microbe: 'microorganism',
      microbes: 'microorganism',
      organism: 'microorganism',
      organisms: 'microorganism',
      species: 'microorganism',
      yeast: 'yeast',
      yeasts: 'yeast',
      fungi: 'fungi',
      fungus: 'fungi',
      fungal: 'fungi',
      avg: 'average',
      mean: 'average',
      min: 'minimum',
      minimum: 'minimum',
      max: 'maximum',
      maximum: 'maximum',
      trend: 'trend',
      trends: 'trend',
      time: 'time',
      series: 'series',
      line: 'line',
      progression: 'trend',
      evolution: 'trend',
      chart: 'chart',
      charts: 'chart',
      graph: 'chart',
      graphs: 'chart',
      plot: 'chart',
      plots: 'chart',
      table: 'table',
      tables: 'table',
      row: 'row',
      rows: 'row',
      record: 'record',
      records: 'record',
      preview: 'preview',
      summary: 'summary',
      overview: 'summary',
      metrics: 'metric',
      metric: 'metric',
      stats: 'metric',
      kpi: 'metric',
      comparison: 'comparison',
      compare: 'comparison',
      versus: 'comparison',
      vs: 'comparison',
      compact: 'compact',
      minimal: 'compact',
      lean: 'compact',
      small: 'compact',
      essential: 'compact',
      lightweight: 'compact',
      fast: 'compact',
      analytical: 'analytical',
      detailed: 'analytical',
      deep: 'analytical',
      investigative: 'analytical',
      diagnostic: 'analytical',
      visual: 'visual',
      storytelling: 'visual',
      balanced: 'balanced',
      standard: 'balanced',
      executive: 'balanced',
      managerial: 'balanced',
      top: 'top',
      limit: 'top',
      first: 'top',
      last: 'top',
      radius: 'radius',
      raddi: 'radius',
      equivalent: 'equivdiameter',
      diameter: 'equivdiameter',
      equivalentdiameter: 'equivdiameter',
      extrema: 'extrema',
      extreme: 'extrema',
      filled: 'filledarea',
      filledarea: 'filledarea',
      centroidx: 'centroid1',
      centroidy: 'centroid2',
    },
    entities: SEMANTIC_ENTITIES,
    metrics: SEMANTIC_METRICS,
    dimensions: SEMANTIC_DIMENSIONS,
    physicalBindings: SEMANTIC_PHYSICAL_BINDINGS,
  },
};

function normalizeSchemaKey(value) {
  return String(value || '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
}

function buildPromptTokenAliasMap(schema = SCHEMA.microorganism) {
  const map = new Map();
  const aliases = schema?.promptAliases || {};

  Object.entries(aliases).forEach(([rawToken, canonicalToken]) => {
    map.set(normalizeSchemaKey(rawToken), normalizeSchemaKey(canonicalToken));
  });

  return map;
}

function buildCategoryIdLookup(schema = SCHEMA.microorganism) {
  const byKey = new Map();
  const byLabel = new Map();
  const byId = new Map();

  for (const category of schema?.categories || []) {
    const key = normalizeSchemaKey(category.key || category.column || category.category_name);
    const label = normalizeSchemaKey(category.label || category.category_name);
    byKey.set(key, category.category_id);
    byLabel.set(label, category.category_id);
    byId.set(category.category_id, category);
  }

  return { byKey, byLabel, byId };
}

function getReadableColumnLabel(columnName, schema = SCHEMA.microorganism) {
  const normalized = normalizeSchemaKey(columnName);
  const meta = schema?.dimensionMeta?.[normalized];

  if (meta?.label) {
    return meta.label;
  }

  if (normalized === 'category_id') {
    return 'Category';
  }

  if (normalized === 'label') {
    return 'Category';
  }

  if (normalized === 'value') {
    return 'Value';
  }

  return String(columnName || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function getReadableTableLabel(tableName, schema = SCHEMA.microorganism) {
  if (normalizeSchemaKey(tableName) === normalizeSchemaKey(schema.table)) {
    return schema.tableLabel;
  }

  return getReadableColumnLabel(tableName, schema);
}

function getCategoryIdForColumn(columnName, schema = SCHEMA.microorganism) {
  const normalized = normalizeSchemaKey(columnName);
  const { byKey, byLabel } = buildCategoryIdLookup(schema);
  return byKey.get(normalized) ?? byLabel.get(normalized) ?? null;
}

function getPreferredMeasureIndex(columnName, schema = SCHEMA.microorganism) {
  const normalized = normalizeSchemaKey(columnName);
  return schema?.preferredMeasures?.indexOf(normalized) ?? -1;
}

function isMicroorganismDimensionColumn(columnName, schema = SCHEMA.microorganism) {
  const normalized = normalizeSchemaKey(columnName);

  if (!normalized) {
    return false;
  }

  return Boolean(schema?.dimensionMeta?.[normalized])
    || (schema?.dimensionKeywords || []).some((keyword) => normalized.includes(normalizeSchemaKey(keyword)));
}

function getMicroorganismDimensionKeywords(schema = SCHEMA.microorganism) {
  return Array.isArray(schema?.dimensionKeywords) ? schema.dimensionKeywords : [];
}

function buildCategoryListQuery(schema = SCHEMA.microorganism) {
  const categories = Array.isArray(schema?.categories) ? schema.categories : [];
  if (!categories.length) {
    return 'SELECT 1 AS category_id, "Category" AS category_name WHERE 0';
  }

  const rows = categories
    .map((category, index) => {
      const id = Number.isInteger(category.category_id) ? category.category_id : index + 1;
      const name = String(category.category_name || category.column || category.label || 'Category').replace(/'/g, "''");
      return `${index === 0 ? 'SELECT' : 'UNION ALL SELECT'} ${id} AS category_id, '${name}' AS category_name`;
    })
    .join('\n  ');

  return `WITH categories AS (\n  ${rows}\n)\nSELECT category_id, category_name\nFROM categories\nORDER BY category_id ASC`;
}

function normalizeSemanticKey(value) {
  return normalizeSchemaKey(value);
}

function resolveSemanticEntry(registry, value) {
  const normalized = normalizeSemanticKey(value);
  if (!normalized || !registry) {
    return null;
  }

  const lookup = buildSemanticLookup(registry);
  return lookup.byKey.get(normalized) ?? lookup.byAlias.get(normalized) ?? null;
}

function resolveEntity(name, schema = SCHEMA.microorganism) {
  return resolveSemanticEntry(schema.entities, name);
}

function resolveMetric(name, schema = SCHEMA.microorganism) {
  return resolveSemanticEntry(schema.metrics, name);
}

function resolveDimension(name, schema = SCHEMA.microorganism) {
  return resolveSemanticEntry(schema.dimensions, name);
}

function normalizeSelectedSemanticKey(selected, fallback) {
  if (selected && typeof selected === 'object' && selected.key) {
    return normalizeSemanticKey(selected.key);
  }

  if (typeof selected === 'string' && selected.trim()) {
    return normalizeSemanticKey(selected);
  }

  return normalizeSemanticKey(fallback);
}

function resolveSemanticQuery(intent = {}, schema = SCHEMA.microorganism) {
  const selectedEntityKey = normalizeSelectedSemanticKey(intent.selectedEntity, 'organism');
  const entity = resolveEntity(selectedEntityKey, schema) || resolveEntity('organism', schema);
  const entityKey = entity?.key || 'organism';

  const fallbackMetric = intent?.aggregation === 'count' ? 'count' : (entity?.defaultMetric || 'count');
  const selectedMetricKey = normalizeSelectedSemanticKey(intent.selectedMetric, fallbackMetric);
  const metric = resolveMetric(selectedMetricKey, schema) || resolveMetric(fallbackMetric, schema) || resolveMetric('count', schema);
  const metricKey = metric?.key || 'count';

  const fallbackDimension = entity?.defaultDimension || 'species';
  const selectedDimensionKey = normalizeSelectedSemanticKey(intent.selectedDimension, fallbackDimension);
  const dimension = resolveDimension(selectedDimensionKey, schema) || resolveDimension(fallbackDimension, schema);
  const dimensionKey = dimension?.key || 'species';

  const action = intent?.semanticIntent?.action || (intent?.prefersTrend ? 'trend' : 'distribution');
  const bindings = schema?.physicalBindings || SEMANTIC_PHYSICAL_BINDINGS;

  const entityBinding = bindings.entities?.[entityKey] || bindings.entities?.organism || null;
  const dimensionBinding = bindings.dimensions?.[dimensionKey] || bindings.dimensions?.species || null;
  const metricBinding = bindings.metrics?.[metricKey] || bindings.metrics?.count || null;

  const table = dimensionBinding?.table || entityBinding?.table || bindings.defaultTable;
  const aggregation = metricBinding?.aggregation || metric?.defaultAggregation || intent?.aggregation || 'count';
  const measureColumn = metricBinding?.column || null;
  const dimensionColumn = dimensionBinding?.column || entityBinding?.idColumn || null;

  const joins = [];
  if (dimensionBinding?.join) {
    joins.push({
      type: dimensionBinding.join.type || 'left',
      fromTable: table,
      toTable: dimensionBinding.join.table,
      on: Array.isArray(dimensionBinding.join.on) ? dimensionBinding.join.on : [],
    });
  }

  return {
    entityKey,
    metricKey,
    dimensionKey,
    action,
    table,
    joins,
    aggregations: {
      metric: aggregation,
    },
    columns: {
      entityId: entityBinding?.idColumn || null,
      entityLabel: entityBinding?.labelColumn || null,
      dimension: dimensionColumn,
      dimensionLabel: dimensionBinding?.labelColumn || entityBinding?.labelColumn || null,
      metric: measureColumn,
    },
    physical: {
      table,
      dimensionColumn,
      measureColumn,
    },
  };
}

module.exports = {
  SCHEMA,
  buildCategoryIdLookup,
  buildCategoryListQuery,
  buildPromptTokenAliasMap,
  resolveDimension,
  resolveEntity,
  resolveMetric,
  resolveSemanticQuery,
  getCategoryIdForColumn,
  getMicroorganismDimensionKeywords,
  getPreferredMeasureIndex,
  getReadableColumnLabel,
  getReadableTableLabel,
  isMicroorganismDimensionColumn,
};
