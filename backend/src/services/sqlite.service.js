// Purpose: Exposes small shared SQLite query helpers backed by the default database adapter.
const { databaseAdapter } = require('../config/database');

function runAll(query, params = []) {
  return databaseAdapter.all(query, params);
}

function runGet(query, params = []) {
  return databaseAdapter.get(query, params);
}

module.exports = {
  runAll,
  runGet,
};
