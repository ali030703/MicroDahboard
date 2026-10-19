// Purpose: Builds SQL queries for microbe comparisons, category counts, and category lookup data.
// Queries for microbe-related endpoints. These are built from the canonical
// schema so backend SQL stays aligned with the rest of the system.

const { SCHEMA, buildCategoryListQuery } = require('../config/schema');

const MICROORGANISM_SCHEMA = SCHEMA.microorganism;

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function resolveLookupContext(lookupContext = MICROORGANISM_SCHEMA.lookup) {
  return {
    tableName: lookupContext?.tableName || lookupContext?.table || MICROORGANISM_SCHEMA.lookup.table,
    idColumn: lookupContext?.idColumn || lookupContext?.id || MICROORGANISM_SCHEMA.lookup.id,
    nameColumn: lookupContext?.nameColumn || lookupContext?.name || MICROORGANISM_SCHEMA.lookup.name,
  };
}

function buildCompareMicrobesQuery(lookupContext = MICROORGANISM_SCHEMA.lookup) {
  const lookup = resolveLookupContext(lookupContext);
  const table = quoteIdentifier(MICROORGANISM_SCHEMA.table);
  const idColumn = quoteIdentifier(MICROORGANISM_SCHEMA.id);
  const lookupTable = quoteIdentifier(lookup.tableName);
  const lookupId = quoteIdentifier(lookup.idColumn);
  const lookupName = quoteIdentifier(lookup.nameColumn);
  const areaColumn = quoteIdentifier(MICROORGANISM_SCHEMA.dimensionMeta.area.column);
  const perimeterColumn = quoteIdentifier(MICROORGANISM_SCHEMA.dimensionMeta.perimeter.column);
  const eccentricityColumn = quoteIdentifier(MICROORGANISM_SCHEMA.dimensionMeta.eccentricity.column);
  const solidityColumn = quoteIdentifier(MICROORGANISM_SCHEMA.dimensionMeta.solidity.column);
  const radiusColumn = quoteIdentifier(MICROORGANISM_SCHEMA.dimensionMeta.radius.column);

  return `
SELECT
  grouped.${idColumn},
  category.${lookupName} AS microorganism_name,
  grouped.count,
  grouped.avgArea,
  grouped.avgPerimeter,
  grouped.avgEccentricity,
  grouped.avgSolidity,
  grouped.avgRadius
FROM (
  SELECT
    microbes.${idColumn},
    COUNT(*) AS count,
    ROUND(AVG(microbes.${areaColumn}), 4) AS avgArea,
    ROUND(AVG(microbes.${perimeterColumn}), 4) AS avgPerimeter,
    ROUND(AVG(microbes.${eccentricityColumn}), 4) AS avgEccentricity,
    ROUND(AVG(microbes.${solidityColumn}), 4) AS avgSolidity,
    ROUND(AVG(microbes.${radiusColumn}), 4) AS avgRadius
  FROM ${table} AS microbes
  WHERE microbes.${idColumn} IN (?, ?)
  GROUP BY microbes.${idColumn}
) AS grouped
INNER JOIN ${lookupTable} AS category
  ON grouped.${idColumn} = category.${lookupId}
ORDER BY category.${lookupId} ASC
`;
}

function buildCategoryCountsQuery(lookupContext = MICROORGANISM_SCHEMA.lookup, limit = 20) {
  const lookup = resolveLookupContext(lookupContext);
  const table = quoteIdentifier(MICROORGANISM_SCHEMA.table);
  const idColumn = quoteIdentifier(MICROORGANISM_SCHEMA.id);
  const lookupTable = quoteIdentifier(lookup.tableName);
  const lookupId = quoteIdentifier(lookup.idColumn);
  const lookupName = quoteIdentifier(lookup.nameColumn);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 500));

  return `
SELECT
  grouped.${idColumn},
  category.${lookupName} AS name,
  grouped.count
FROM (
  SELECT
    microbes.${idColumn},
    COUNT(*) AS count
  FROM ${table} AS microbes
  GROUP BY microbes.${idColumn}
) AS grouped
INNER JOIN ${lookupTable} AS category
  ON grouped.${idColumn} = category.${lookupId}
ORDER BY grouped.count DESC, category.${lookupName} ASC
LIMIT ${safeLimit}
`;
}

function buildCategoryCountsByIdQuery(lookupContext = MICROORGANISM_SCHEMA.lookup) {
  const lookup = resolveLookupContext(lookupContext);
  const table = quoteIdentifier(MICROORGANISM_SCHEMA.table);
  const idColumn = quoteIdentifier(MICROORGANISM_SCHEMA.id);
  const lookupTable = quoteIdentifier(lookup.tableName);
  const lookupId = quoteIdentifier(lookup.idColumn);
  const lookupName = quoteIdentifier(lookup.nameColumn);

  return `
SELECT
  grouped.${idColumn},
  category.${lookupName} AS name,
  grouped.count
FROM (
  SELECT
    microbes.${idColumn},
    COUNT(*) AS count
  FROM ${table} AS microbes
  WHERE microbes.${idColumn} = ?
  GROUP BY microbes.${idColumn}
) AS grouped
INNER JOIN ${lookupTable} AS category
  ON grouped.${idColumn} = category.${lookupId}
ORDER BY grouped.count DESC, category.${lookupName} ASC
`;
}

const LIST_CATEGORIES_QUERY = buildCategoryListQuery(MICROORGANISM_SCHEMA);

module.exports = {
  LIST_CATEGORIES_QUERY,
  buildCategoryCountsByIdQuery,
  buildCategoryCountsQuery,
  buildCompareMicrobesQuery,
};
