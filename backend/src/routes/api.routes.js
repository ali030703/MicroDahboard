// Purpose: Aggregates API route modules under the /api mount point.
const express = require('express');
const { dashboardRouter } = require('./dashboard.routes');
const { dashboardSessionRouter } = require('./dashboard-session.routes');
const { microbeRouter } = require('./microbe.routes');

const router = express.Router();

router.use(dashboardRouter);
router.use(dashboardSessionRouter);
router.use(microbeRouter);

module.exports = {
  apiRouter: router,
};
