// Purpose: Provides microbe-specific service methods for comparisons and category summaries.
const { databaseAdapter } = require('../config/database');
const {
	LIST_CATEGORIES_QUERY,
	buildCategoryCountsQuery,
	buildCompareMicrobesQuery,
} = require('../models/microbe.queries');
const { resolveMicroorganismLookupContext } = require('./microorganism-dimension.service');

function normalizeNumber(value) {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeName(value) {
	return String(value ?? '').trim();
}

function normalizeId(value) {
	const numeric = Number(value);
	return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

async function getMicroorganismLookupTableName() {
	return resolveMicroorganismLookupContext();
}

async function compareMicrobes(left, right) {
	const leftId = normalizeId(left);
	const rightId = normalizeId(right);

	if (!leftId || !rightId || leftId === rightId) {
		return [];
	}

	const lookupContext = await getMicroorganismLookupTableName();
	const rows = await databaseAdapter.all(buildCompareMicrobesQuery(lookupContext), [leftId, rightId]);

	return rows.map((row) => ({
		microorganism_id: normalizeId(row.microorganism_id),
		microorganism_name: normalizeName(row.microorganism_name),
		count: normalizeNumber(row.count),
		avgArea: normalizeNumber(row.avgArea),
		avgPerimeter: normalizeNumber(row.avgPerimeter),
		avgEccentricity: normalizeNumber(row.avgEccentricity),
		avgSolidity: normalizeNumber(row.avgSolidity),
		avgRadius: normalizeNumber(row.avgRadius),
	})).filter((row) => row.microorganism_id !== null && row.microorganism_name);
}

module.exports = {
	compareMicrobes,
};

async function getDistribution(concept, { limit = 20 } = {}) {
	if (String(concept || '').toLowerCase() === 'microorganism') {
		const lookupContext = await getMicroorganismLookupTableName();
		const rows = await databaseAdapter.all(buildCategoryCountsQuery(lookupContext, limit));

		return rows.map((r) => ({ id: normalizeId(r.microorganism_id), name: normalizeName(r.name), value: normalizeNumber(r.count) }))
			.filter((r) => r.id !== null);
	}

	return [];
}

module.exports.getDistribution = getDistribution;

async function listCategories() {
	const rows = await databaseAdapter.all(LIST_CATEGORIES_QUERY);
	return rows
		.map((row) => ({
			category_id: normalizeId(row.category_id),
			category_name: normalizeName(row.category_name),
		}))
		.filter((r) => r.category_id !== null && r.category_name);
}

module.exports.listCategories = listCategories;
