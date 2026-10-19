// Purpose: Handles simple microbiology data HTTP requests.
const microbeService = require('../services/microbe.service');

async function listCategories(req, res) {
  try {
    const categories = await microbeService.listCategories();
    res.json(categories || []);
  } catch (error) {
    console.error('/categories error:', error);
    res.status(500).json({ error: error.message });
  }
}

async function getDistribution(req, res) {
  try {
    const concept = String(req.query?.concept ?? '').trim();
    const limit = Number(req.query?.limit) || 20;

    if (!concept) {
      res.status(400).json({ error: 'concept query param is required' });
      return;
    }

    const data = await microbeService.getDistribution(concept, { limit });
    res.json(data || []);
  } catch (error) {
    console.error('/distribution error:', error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getDistribution,
  listCategories,
};
