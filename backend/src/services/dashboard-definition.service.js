// Purpose: Loads, validates, and stores dashboard definition JSON files.
// === FILE DESCRIPTION ===
// Handles dashboard definitions.
// Reads, validates, and saves JSON configurations.

const fs = require('fs/promises');
const path = require('path');
const {
  DASHBOARD_DEFINITIONS_PATH,
  DASHBOARD_ENGINE_REGISTRY_PATH,
} = require('../config/constants');

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sanitizeRegistryId(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-');
}

async function readDashboardEngineRegistry() {
  const contents = await fs.readFile(DASHBOARD_ENGINE_REGISTRY_PATH, 'utf8');
  return JSON.parse(contents);
}

function hasRequiredFields(candidate, requiredFields) {
  return requiredFields.every((field) => field in candidate);
}

function isValidTransformDefinition(value, registry) {
  if (!isObject(value) || !isNonEmptyString(value.type)) {
    return false;
  }

  const transformSpec = registry.transforms?.[value.type];
  return Boolean(transformSpec) && hasRequiredFields(value, transformSpec.requiredFields ?? []);
}

function getComponentChartConfig(value) {
  if (isObject(value.chart)) {
    return value.chart;
  }

  if (isNonEmptyString(value.template)) {
    return { template: value.template };
  }

  return null;
}

function getComponentDataBinding(value) {
  if (isObject(value.data)) {
    return value.data;
  }

  if (isNonEmptyString(value.source) && isObject(value.transform)) {
    return {
      source: value.source,
      transform: value.transform,
    };
  }

  return null;
}

function isValidDashboardComponent(value, registry) {
  if (!isObject(value)) {
    return false;
  }

  const widget = isNonEmptyString(value.widget) ? registry.widgets?.[value.widget] : null;

  if (!widget) {
    return false;
  }

  if (!isNonEmptyString(value.type) || widget.componentType !== value.type) {
    return false;
  }

  if (value.type === 'chart') {
    const chartConfig = getComponentChartConfig(value);

    if (!chartConfig || !isNonEmptyString(chartConfig.template) || !widget.supportedTemplates?.includes(chartConfig.template)) {
      return false;
    }
  }

  const dataBinding = getComponentDataBinding(value);

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    Boolean(dataBinding) &&
    isNonEmptyString(dataBinding.source) &&
    isValidTransformDefinition(dataBinding.transform, registry)
  );
}

function isValidDashboardDefinition(value, registry) {
  return (
    isObject(value) &&
    value.schemaVersion === registry.schemaVersion &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    Array.isArray(value.components) &&
    value.components.every((component) => isValidDashboardComponent(component, registry))
  );
}

async function validateDashboardDefinition(value) {
  const registry = await readDashboardEngineRegistry();

  if (!isValidDashboardDefinition(value, registry)) {
    throw new Error(`Dashboard definition is not valid for schema ${registry.schemaVersion}.`);
  }

  return {
    registry,
    definition: value,
  };
}

function getDefinitionFilePathFromId(id) {
  return path.join(DASHBOARD_DEFINITIONS_PATH, `${sanitizeRegistryId(id)}.dashboard.json`);
}

async function readDashboardDefinition(fileName) {
  const filePath = path.join(DASHBOARD_DEFINITIONS_PATH, fileName);
  const contents = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(contents);

  await validateDashboardDefinition(parsed);
  return parsed;
}

async function findDashboardDefinitionFileName(id) {
  const normalizedId = sanitizeRegistryId(id);
  const entries = await fs.readdir(DASHBOARD_DEFINITIONS_PATH, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.dashboard.json'))
    .map((entry) => entry.name)
    .sort();

  for (const fileName of files) {
    const definition = await readDashboardDefinition(fileName);
    const registryId = fileName.replace('.dashboard.json', '');

    if (sanitizeRegistryId(registryId) === normalizedId || sanitizeRegistryId(definition.id) === normalizedId) {
      return fileName;
    }
  }

  return null;
}

async function listDashboardDefinitions() {
  const entries = await fs.readdir(DASHBOARD_DEFINITIONS_PATH, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.dashboard.json'))
    .map((entry) => entry.name)
    .sort();

  const definitions = await Promise.all(
    files.map(async (fileName) => {
      const definition = await readDashboardDefinition(fileName);
      const registryId = fileName.replace('.dashboard.json', '');
      return [registryId, definition];
    }),
  );

  return Object.fromEntries(definitions);
}

async function getDashboardDefinitionById(id) {
  const fileName = await findDashboardDefinitionFileName(id);

  if (!fileName) {
    return null;
  }

  return readDashboardDefinition(fileName);
}

async function createDashboardDefinition(payload) {
  const { definition } = await validateDashboardDefinition(payload);
  const registryId = sanitizeRegistryId(definition.id);
  const filePath = getDefinitionFilePathFromId(registryId);

  try {
    await fs.access(filePath);
    throw new Error(`Dashboard "${registryId}" already exists.`);
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.writeFile(filePath, `${JSON.stringify(definition, null, 2)}\n`, 'utf8');

  return {
    registryId,
    definition,
  };
}

async function updateDashboardDefinition(id, payload) {
  const { definition } = await validateDashboardDefinition(payload);
  const fileName = (await findDashboardDefinitionFileName(id)) ?? `${sanitizeRegistryId(id)}.dashboard.json`;
  const filePath = path.join(DASHBOARD_DEFINITIONS_PATH, fileName);

  await fs.writeFile(filePath, `${JSON.stringify(definition, null, 2)}\n`, 'utf8');

  return {
    registryId: fileName.replace('.dashboard.json', ''),
    definition,
  };
}

module.exports = {
  createDashboardDefinition,
  getDashboardDefinitionById,
  listDashboardDefinitions,
  readDashboardEngineRegistry,
  updateDashboardDefinition,
  validateDashboardDefinition,
};
