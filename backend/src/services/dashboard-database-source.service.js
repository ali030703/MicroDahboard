// Purpose: Resolves dashboard generation database sources from paths, SQL files, JSON definitions, or defaults.
const fs = require('fs/promises');
const path = require('path');
const { DATABASE_PATH } = require('../config/constants');
const { SQLiteAdapter } = require('../adapters/sqlite-adapter');

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeDatabaseDefinition(databaseDefinition) {
  if (!isObject(databaseDefinition) || !isObject(databaseDefinition.tables)) {
    return null;
  }

  const databaseName = String(databaseDefinition.database ?? databaseDefinition.name ?? 'dataset').trim() || 'dataset';
  const tables = Object.entries(databaseDefinition.tables).map(([tableName, tableDefinition]) => {
    const normalizedTableName = String(tableName || '').trim();

    if (!normalizedTableName) {
      throw new Error('The database definition contains a table without a name.');
    }

    if (!isObject(tableDefinition)) {
      throw new Error(`Table "${normalizedTableName}" must be an object.`);
    }

    if (!Array.isArray(tableDefinition.columns) || !tableDefinition.columns.length) {
      throw new Error(`Table "${normalizedTableName}" must include a non-empty columns array.`);
    }

    const columns = tableDefinition.columns.map((column, index) => {
      if (!isObject(column)) {
        throw new Error(`Column ${index + 1} in table "${normalizedTableName}" must be an object.`);
      }

      const columnName = String(column.name ?? '').trim();

      if (!columnName) {
        throw new Error(`Column ${index + 1} in table "${normalizedTableName}" is missing a name.`);
      }

      return {
        ...column,
        name: columnName,
        type: String(column.type ?? 'TEXT').trim() || 'TEXT',
      };
    });

    const data = Array.isArray(tableDefinition.data)
      ? tableDefinition.data.map((row, index) => {
        if (!isObject(row)) {
          throw new Error(`Row ${index + 1} in table "${normalizedTableName}" must be an object.`);
        }

        return { ...row };
      })
      : [];

    return {
      name: normalizedTableName,
      columns,
      data,
    };
  });

  if (!tables.length) {
    throw new Error('The database definition does not contain any tables.');
  }

  const semanticHints = isObject(databaseDefinition.semanticHints) ? databaseDefinition.semanticHints : undefined;
  const semanticCatalog = isObject(databaseDefinition.semanticCatalog) ? databaseDefinition.semanticCatalog : undefined;
  const labels = isObject(databaseDefinition.labels) ? databaseDefinition.labels : undefined;
  const displayLabels = isObject(databaseDefinition.displayLabels) ? databaseDefinition.displayLabels : undefined;
  const aliases = isObject(databaseDefinition.aliases) ? databaseDefinition.aliases : undefined;

  return {
    database: databaseName,
    tables,
    ...(semanticHints ? { semanticHints } : {}),
    ...(semanticCatalog ? { semanticCatalog } : {}),
    ...(labels ? { labels } : {}),
    ...(displayLabels ? { displayLabels } : {}),
    ...(aliases ? { aliases } : {}),
  };
}

async function resolveDatabaseSource({ requestedPath, databaseDefinition }) {
  const normalizedDatabaseDefinition = Array.isArray(databaseDefinition?.tables)
    ? databaseDefinition
    : normalizeDatabaseDefinition(databaseDefinition);

  if (normalizedDatabaseDefinition) {
    return SQLiteAdapter.fromDatabaseDefinition(normalizedDatabaseDefinition);
  }

  if (!requestedPath) {
    return {
      adapter: new SQLiteAdapter({ databasePath: DATABASE_PATH, mode: 'readonly' }),
      databasePath: DATABASE_PATH,
      cleanup: null,
      persistent: true,
      sourceType: 'db',
    };
  }

  const candidatePaths = path.isAbsolute(requestedPath)
    ? [requestedPath]
    : [path.resolve(process.cwd(), requestedPath), path.resolve(__dirname, '../../../', requestedPath)];

  let resolved = null;

  for (const candidatePath of candidatePaths) {
    try {
      await fs.access(candidatePath);
      resolved = candidatePath;
      break;
    } catch {
      continue;
    }
  }

  if (!resolved) {
    throw new Error(`Database path not found. Tried: ${candidatePaths.join(', ')}`);
  }

  if (resolved.toLowerCase().endsWith('.sql')) {
    return SQLiteAdapter.fromSourcePath(resolved);
  }

  return {
    adapter: new SQLiteAdapter({ databasePath: resolved, mode: 'readwrite' }),
    databasePath: resolved,
    cleanup: null,
    persistent: false,
    sourceType: 'db',
    sourcePath: resolved,
  };
}

module.exports = {
  normalizeDatabaseDefinition,
  resolveDatabaseSource,
};
