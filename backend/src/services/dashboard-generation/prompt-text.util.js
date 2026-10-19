function normalizePromptText(value) {
  return normalizePromptTextCore(value, { preserveDecimals: true });
}

function normalizeFilterPrompt(value) {
  return normalizePromptTextCore(value, { preserveDecimals: true, preserveCommas: false });
}

function normalizePromptTextCore(value, options = {}) {
  const preserveDecimals = options.preserveDecimals !== false;
  const preserveCommas = options.preserveCommas === true;

  let normalized = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[;:!?()[\]{}]/g, ' ');

  if (!preserveCommas) {
    normalized = normalized.replace(/,(?=\s|$)/g, ' ');
  }

  if (preserveDecimals) {
    normalized = normalized
      .replace(/(?<!\d)\.(?!\d)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } else {
    normalized = normalized
      .replace(/[.,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return normalized;
}
function tokenizePromptText(value) {
  return normalizePromptText(value)
    .split(' ')
    .filter(Boolean)
    .map((token) => PROMPT_TOKEN_ALIASES.get(token) ?? token)
    .filter((token) => !PROMPT_STOP_WORDS.has(token));
}
function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPromptTokenSet(value) {
  return new Set(tokenizePromptText(value));
}

function hasAllPromptTokens(promptTokens, tokens) {
  return tokens.every((token) => promptTokens.has(token));
}

function matchesPromptConcept(promptTokens, value) {
  const conceptTokens = tokenizePromptText(value);

  return conceptTokens.length > 0 && hasAllPromptTokens(promptTokens, conceptTokens);
}

function findPromptMatchIndex(normalizedPrompt, ...values) {
  const indexes = values
    .map((value) => normalizePromptText(value))
    .filter(Boolean)
    .map((value) => normalizedPrompt.indexOf(value))
    .filter((index) => index >= 0);

  return indexes.length ? Math.min(...indexes) : Number.MAX_SAFE_INTEGER;
}
const PROMPT_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'be',
  'build',
  'by',
  'can',
  'could',
  'count',
  'counts',
  'create',
  'display',
  'average',
  'do',
  'for',
  'from',
  'give',
  'go',
  'have',
  'i',
  'in',
  'is',
  'it',
  'make',
  'me',
  'please',
  'show',
  'tell',
  'that',
  'the',
  'this',
  'those',
  'to',
  'us',
  'use',
  'using',
  'we',
  'with',
  'without',
  'would',
  'you',
  'your',
]);const { SCHEMA, buildPromptTokenAliasMap } = require('../../config/schema');

const MICROORGANISM_SCHEMA = SCHEMA.microorganism;


const PROMPT_TOKEN_ALIASES = buildPromptTokenAliasMap(MICROORGANISM_SCHEMA);
module.exports = {
  normalizePromptText,
  normalizeFilterPrompt,
  escapeRegExp,
  tokenizePromptText,
  buildPromptTokenSet,
  hasAllPromptTokens,
  matchesPromptConcept,
  findPromptMatchIndex,
  PROMPT_STOP_WORDS,
  PROMPT_TOKEN_ALIASES,
};