// Purpose: Discovers the microorganism lookup table context used to label organism IDs.
const contextCache = new WeakMap();
const { SCHEMA } = require('../config/schema');
const { databaseAdapter } = require('../config/database');

const MICROORGANISM_SCHEMA = SCHEMA.microorganism;

function normalizeKey(value) {
	return String(value || '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
}

async function resolveMicroorganismLookupContext(db) {
	const adapter = db || databaseAdapter;

	if (!adapter) {
		return null;
	}

	if (contextCache.has(adapter)) {
		return contextCache.get(adapter);
	}

	const lookupPromise = adapter.getTables()
		.then(async (tables) => {
			for (const table of tables) {
				const tableName = table?.name;
				if (!tableName) continue;

				const columns = await adapter.getColumns(tableName);
				const idColumn = columns.find((column) => normalizeKey(column?.name) === normalizeKey(MICROORGANISM_SCHEMA.id))?.name ?? null;
				if (!idColumn) continue;

				const nameColumn = columns.find((column) => {
					const key = normalizeKey(column?.name);
					return ['microorganismname', 'categoryname', 'name', 'label', 'title'].includes(key)
						|| (key.includes('microorganism') && key.includes('name'));
				})?.name ?? null;

				if (!nameColumn) continue;

				return { tableName, idColumn, nameColumn };
			}

			return null;
		})
		.catch(() => null);

	contextCache.set(adapter, lookupPromise);
	return lookupPromise;
}

async function resolveMicroorganismLookupTableName(db) {
	const context = await resolveMicroorganismLookupContext(db);
	return context?.tableName ?? null;
}

module.exports = {
	resolveMicroorganismLookupContext,
	resolveMicroorganismLookupTableName,
};
