// Purpose: Creates the default readonly SQLite adapter for the bundled microbes database.
const { DATABASE_PATH } = require('./constants');
const { SQLiteAdapter } = require('../adapters/sqlite-adapter');

const databaseAdapter = new SQLiteAdapter({
  databasePath: DATABASE_PATH,
  mode: 'readonly',
});

module.exports = { 
  databaseAdapter,
};
