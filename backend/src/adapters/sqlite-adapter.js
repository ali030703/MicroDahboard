// Purpose: Implements the runtime SQLite adapter for schema introspection, queries, and temporary databases.
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { DatabaseAdapter } = require('./database-adapter');

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function normalizeSqliteValue(value) {
  return value === undefined ? null : value;
}

function normalizeMode(mode) {
  if (mode === 'readonly') {
    return sqlite3.OPEN_READONLY;
  }

  if (mode === 'readwrite-create') {
    return sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE;
  }

  if (mode === 'readwrite') {
    return sqlite3.OPEN_READWRITE;
  }

  return Number.isFinite(mode) ? mode : sqlite3.OPEN_READWRITE;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildColumnDefinition(column) {
  const definitionParts = [quoteIdentifier(column.name)];
  const type = String(column.type || '').trim();

  if (type) {
    definitionParts.push(type);
  }

  if (column.primary_key || column.primaryKey) {
    definitionParts.push('PRIMARY KEY');
  }

  if (column.not_null || column.notNull || column.required) {
    definitionParts.push('NOT NULL');
  }

  if (column.unique) {
    definitionParts.push('UNIQUE');
  }

  if (typeof column.default !== 'undefined') {
    const defaultValue = typeof column.default === 'number' || typeof column.default === 'boolean'
      ? column.default
      : `'${String(column.default).replace(/'/g, "''")}'`;
    definitionParts.push(`DEFAULT ${defaultValue}`);
  }

  if (isObject(column.foreign_key)) {
    const foreignTable = String(column.foreign_key.table ?? '').trim();
    const foreignColumn = String(column.foreign_key.column ?? '').trim();

    if (foreignTable && foreignColumn) {
      definitionParts.push(`REFERENCES ${quoteIdentifier(foreignTable)}(${quoteIdentifier(foreignColumn)})`);
    }
  }

  return definitionParts.join(' ');
}

function buildCreateTableStatement(table) {
  const columnDefinitions = Array.isArray(table.columns) ? table.columns.map((column) => buildColumnDefinition(column)) : [];
  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table.name)} (${columnDefinitions.join(', ')});`;
}

class SQLiteAdapter extends DatabaseAdapter {
  constructor({ databasePath, mode = sqlite3.OPEN_READWRITE } = {}) {
    super({ dialect: 'sqlite', databasePath });
    this.mode = normalizeMode(mode);
    this.connection = null;
    this.connectionPromise = null;
    this.cleanup = null;
  }

  static async fromSourcePath(requestedPath) {
    const resolvedPath = String(requestedPath || '').trim();

    if (!resolvedPath) {
      throw new Error('Database path is required.');
    }

    if (resolvedPath.toLowerCase().endsWith('.sql')) {
      const sqlScript = await fs.readFile(resolvedPath, 'utf8');

      if (!sqlScript.trim()) {
        throw new Error('The SQL file is empty.');
      }

      const tempDbPath = path.join(
        os.tmpdir(),
        `microdash-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
      );

      const adapter = new SQLiteAdapter({ databasePath: tempDbPath, mode: 'readwrite-create' });
      await adapter.open();
      await adapter.exec(sqlScript);
      await adapter.close();

      adapter.cleanup = async () => {
        await fs.unlink(tempDbPath).catch(() => undefined);
      };

      return {
        adapter,
        databasePath: tempDbPath,
        cleanup: adapter.cleanup,
        sourceType: 'sql',
        sourcePath: resolvedPath,
      };
    }

    const adapter = new SQLiteAdapter({ databasePath: resolvedPath, mode: 'readwrite' });
    return {
      adapter,
      databasePath: resolvedPath,
      cleanup: null,
      sourceType: 'db',
      sourcePath: resolvedPath,
    };
  }

  static async fromDatabaseDefinition(databaseDefinition) {
    const normalizedDefinition = Array.isArray(databaseDefinition?.tables)
      ? databaseDefinition
      : null;

    if (!normalizedDefinition) {
      throw new Error('The database definition is invalid.');
    }

    const tempDbPath = path.join(
      os.tmpdir(),
      `microdash-json-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );

    const adapter = new SQLiteAdapter({ databasePath: tempDbPath, mode: 'readwrite-create' });
    await adapter.open();

    let committed = false;

    try {
      await adapter.exec('PRAGMA foreign_keys = OFF; BEGIN TRANSACTION;');

      for (const table of normalizedDefinition.tables) {
        await adapter.run(buildCreateTableStatement(table));
      }

      for (const table of normalizedDefinition.tables) {
        if (!Array.isArray(table.data) || !table.data.length) {
          continue;
        }

        const columnNames = table.columns.map((column) => column.name);
        const placeholders = columnNames.map(() => '?').join(', ');
        const insertStatement = `INSERT INTO ${quoteIdentifier(table.name)} (${columnNames.map((columnName) => quoteIdentifier(columnName)).join(', ')}) VALUES (${placeholders})`;

        for (const row of table.data) {
          const values = columnNames.map((columnName) => normalizeSqliteValue(row[columnName]));
          await adapter.run(insertStatement, values);
        }
      }

      await adapter.exec('COMMIT;');
      committed = true;
    } finally {
      if (!committed) {
        await adapter.exec('ROLLBACK;').catch(() => undefined);
        await fs.unlink(tempDbPath).catch(() => undefined);
      }

      await adapter.close().catch(() => undefined);
    }

    adapter.cleanup = async () => {
      await fs.unlink(tempDbPath).catch(() => undefined);
    };

    return {
      adapter,
      databasePath: tempDbPath,
      sourcePath: normalizedDefinition.database || null,
      sourceType: 'json',
      databaseDefinition: normalizedDefinition,
      cleanup: adapter.cleanup,
    };
  }

  async open() {
    if (this.connection) {
      return this.connection;
    }

    if (!this.connectionPromise) {
      this.connectionPromise = new Promise((resolve, reject) => {
        const handle = new sqlite3.Database(this.databasePath, this.mode, (error) => {
          if (error) {
            reject(error);
            return;
          }

          this.connection = handle;
          resolve(handle);
        });
      });
    }

    return this.connectionPromise;
  }

  async close() {
    if (!this.connection) {
      return;
    }

    await new Promise((resolve, reject) => {
      this.connection.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    this.connection = null;
    this.connectionPromise = null;
  }

  async all(query, params = []) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      db.all(query, params, (error, rows) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(rows);
      });
    });
  }

  async get(query, params = []) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      db.get(query, params, (error, row) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(row ?? null);
      });
    });
  }

  async run(query, params = []) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      db.run(query, params, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  async exec(sqlScript) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      db.exec(sqlScript, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  quoteIdentifier(identifier) {
    return quoteIdentifier(identifier);
  }

  async getTables() {
    return this.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  }

  async getColumns(tableName) {
    return this.all(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
  }

  async countRows(tableName) {
    return this.get(`SELECT COUNT(*) AS c FROM ${quoteIdentifier(tableName)}`);
  }

  async getDistinctValues(tableName, columnName, limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    return this.all(`SELECT DISTINCT ${quoteIdentifier(columnName)} AS value FROM ${quoteIdentifier(tableName)} LIMIT ${safeLimit}`);
  }

  buildAggregation({ fn, column, tableAlias } = {}) {
    const normalizedFn = String(fn || 'avg').toLowerCase();
    const identifier = quoteIdentifier(column);
    const target = tableAlias ? `${tableAlias}.${identifier}` : identifier;

    switch (normalizedFn) {
      case 'count':
        return 'COUNT(*)';
      case 'sum':
        return `SUM(${target})`;
      case 'min':
        return `MIN(${target})`;
      case 'max':
        return `MAX(${target})`;
      case 'avg':
      default:
        return `AVG(${target})`;
    }
  }

  async cleanupTempFile() {
    if (typeof this.cleanup === 'function') {
      await this.cleanup();
    }
  }
}

module.exports = {
  SQLiteAdapter,
};