// Purpose: Introspects database tables and enriches columns with type and semantic profile hints.
function normalizeColumnKey(columnName) {
  return String(columnName || '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
}

function looksNumeric(type) {
  return /INT|REAL|FLOA|DOUB|NUM|DEC/i.test(type);
}

function looksText(type) {
  return /CHAR|CLOB|TEXT/i.test(type);
}

function looksTemporal(type, columnName) {
  return /DATE|TIME/i.test(type) || /(date|time|month|year|day)/i.test(columnName);
}

function looksIdentifier(columnName) {
  return /(^id$|_id$|uuid|identifier)/i.test(columnName);
}

async function introspectSchema(db, { excludedTables = new Set() } = {}) {
  const tables = await db.getTables();
  const schema = [];

  for (const table of tables) {
    const tableName = table.name;

    if (excludedTables.has(normalizeColumnKey(tableName))) {
      continue;
    }

    const columns = await db.getColumns(tableName);
    const columnProfiles = [];

    for (const column of columns) {
      const samples = await db.getDistinctValues(tableName, column.name, 100).catch(() => []);

      columnProfiles.push({
        name: column.name,
        type: String(column.type || '').toUpperCase(),
        distinctValues: samples.map((sample) => sample.value),
      });
    }

    schema.push({
      name: tableName,
      columns: columnProfiles,
    });
  }

  return schema;
}

async function enrichSchema(db, schema) {
  if (!Array.isArray(schema)) return [];

  const profiles = [];

  for (const table of schema) {
    const profile = {
      name: table.name,
      columns: table.columns.map((col) => ({
        name: col.name,
        type: col.type,
        distinctValues: Array.isArray(col.distinctValues) ? col.distinctValues : [],
        valueSample: Array.isArray(col.distinctValues) ? col.distinctValues[0] ?? null : null,
      })),
      rowCount: 0,
      numericColumns: [],
      dimensionColumns: [],
      temporalColumns: [],
    };

    try {
      const countRow = await db.countRows(table.name);
      profile.rowCount = Number(countRow?.c ?? 0);
    } catch {
      profile.rowCount = 0;
    }

    for (const col of profile.columns) {
      const isNum = looksNumeric(col.type) || (typeof col.valueSample === 'number');
      const isTemp = looksTemporal(col.type, col.name);
      const isId = looksIdentifier(col.name);
      const isText = looksText(col.type) || typeof col.valueSample === 'string';

      if (isNum) profile.numericColumns.push(col);
      if (isTemp) profile.temporalColumns.push(col);
      if (!isNum && !isTemp && (isText || !isId)) profile.dimensionColumns.push(col);
    }

    profiles.push(profile);
  }

  return profiles;
}

module.exports = {
  enrichSchema,
  introspectSchema,
  looksIdentifier,
  looksNumeric,
  looksTemporal,
  normalizeColumnKey,
};
