// Purpose: Centralizes backend ports and filesystem paths used by API services.
const path = require('path'); 

const PORT = Number(process.env.PORT) || 3000; // Port used by the Express server to listen for requests
const DATABASE_PATH = path.join(__dirname, '../../sql/microbes.db'); 
const DASHBOARD_DEFINITIONS_PATH = path.join(__dirname, '../content/dashboard-definitions');
const DASHBOARD_ENGINE_REGISTRY_PATH = path.join(__dirname, '../content/dashboard-engine.registry.json');

module.exports = {
  PORT,
  DATABASE_PATH,
  DASHBOARD_DEFINITIONS_PATH,
  DASHBOARD_ENGINE_REGISTRY_PATH,
};
