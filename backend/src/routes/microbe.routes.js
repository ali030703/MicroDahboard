// Purpose: Maps simple microbiology data endpoints.
const express = require('express');
const microbeController = require('../controllers/microbe.controller');

const router = express.Router();

router.get('/categories', microbeController.listCategories);
router.get('/distribution', microbeController.getDistribution);

module.exports = {
  microbeRouter: router,
};
