// Purpose: Defines the shared database adapter interface and SQLite-only factory.
class DatabaseAdapter {
  constructor({ dialect, databasePath } = {}) {
    this.dialect = dialect || 'unknown';
    this.databasePath = databasePath || null;
  }

  async getTables() {
    throw new Error(`${this.dialect} adapter does not implement getTables()`);
  }

  async getColumns() {
    throw new Error(`${this.dialect} adapter does not implement getColumns()`);
  }

  buildAggregation() {
    throw new Error(`${this.dialect} adapter does not implement buildAggregation()`);
  }
}

function createDatabaseAdapter({ dialect = 'sqlite', databasePath, options } = {}) {
  const normalizedDialect = String(dialect || '').toLowerCase();

  if (normalizedDialect && normalizedDialect !== 'sqlite') {
    throw new Error(`Unsupported database dialect "${dialect}". SQLite is the only supported adapter for now.`);
  }

  const { SQLiteAdapter } = require('./sqlite-adapter');
  return new SQLiteAdapter({ databasePath, ...options });
}

module.exports = {
  DatabaseAdapter,
  createDatabaseAdapter,
};
