// Purpose: Maps dashboard definition, generation, semantic catalog, and render endpoints.
const express = require('express');
const dashboardController = require('../controllers/dashboard.controller');

const router = express.Router();

router.get('/dashboard-schema', dashboardController.getDashboardSchema);
router.get('/dashboards', dashboardController.listDashboards);
router.get('/dashboards/:id', dashboardController.getDashboardById);
router.post('/dashboards', dashboardController.createDashboard);
router.put('/dashboards/:id', dashboardController.updateDashboard);

router.post('/dashboard/generate', dashboardController.generateDashboard);
router.get('/dashboard/semantic-catalog', dashboardController.getSemanticCatalog);
router.post('/dashboard/semantic-catalog', dashboardController.createSemanticCatalog);
router.post('/dashboard/render', dashboardController.renderDashboard);

module.exports = {
  dashboardRouter: router,
};
