// Purpose: Maps dashboard session endpoints.
const express = require('express');
const dashboardSessionController = require('../controllers/dashboard-session.controller');

const router = express.Router();

router.post('/dashboard/session/start', dashboardSessionController.startDashboardSession);
router.get('/dashboard/session/:sessionId', dashboardSessionController.getDashboardSession);
router.post('/dashboard/session/reset', dashboardSessionController.resetDashboardSessionById);

module.exports = {
  dashboardSessionRouter: router,
};
