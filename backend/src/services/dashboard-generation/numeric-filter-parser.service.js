const { escapeRegExp, normalizeFilterPrompt } = require('./prompt-text.util');
const { normalizeColumnKey } = require('../dashboard-schema-profile.service');
const { getReadableColumnLabel } = require('./column-resolution.service');

function parseNumericFilterForColumn(normalizedPrompt, columnName) {
  const columnNormalized = normalizeColumnKey(columnName);
  const columnLabel = getReadableColumnLabel(columnName);
  
  // Pattern: "between X and Y"
  const betweenPattern = new RegExp(
    `(?:${escapeRegExp(columnLabel)}|${escapeRegExp(columnName)})\\s+(?:between|from)\\s+(\\d+(?:\\.\\d+)?)\\s+(?:and|to)\\s+(\\d+(?:\\.\\d+)?)`,
    'i'
  );
  const betweenMatch = normalizedPrompt.match(betweenPattern);
  
  if (betweenMatch) {
    return {
      column: columnName,
      operator: 'between',
      value: [Number(betweenMatch[1]), Number(betweenMatch[2])]
    };
  }
  
  // Pattern: "greater than X", "is over X", or "> X"
  const greaterPattern = new RegExp(
    `(?:${escapeRegExp(columnLabel)}|${escapeRegExp(columnName)})\\s+(?:is\\s+|are\\s+)?(?:greater than|more than|>|above|over)\\s+(\\d+(?:\\.\\d+)?)`,
    'i'
  );
  const greaterMatch = normalizedPrompt.match(greaterPattern);
  
  if (greaterMatch) {
    return {
      column: columnName,
      operator: '>',
      value: Number(greaterMatch[1])
    };
  }
  
  // Pattern: "less than X", "is under X", or "< X"
  const lessPattern = new RegExp(
    `(?:${escapeRegExp(columnLabel)}|${escapeRegExp(columnName)})\\s+(?:is\\s+|are\\s+)?(?:less than|<|below|under)\\s+(\\d+(?:\\.\\d+)?)`,
    'i'
  );
  const lessMatch = normalizedPrompt.match(lessPattern);
  
  if (lessMatch) {
    return {
      column: columnName,
      operator: '<',
      value: Number(lessMatch[1])
    };
  }
  
  // Pattern: "equals X" or "= X"
  const equalsPattern = new RegExp(
    `(?:${escapeRegExp(columnLabel)}|${escapeRegExp(columnName)})\\s+(?:equals?|=|is)\\s+(\\d+(?:\\.\\d+)?)`,
    'i'
  );
  const equalsMatch = normalizedPrompt.match(equalsPattern);
  
  if (equalsMatch) {
    return {
      column: columnName,
      operator: '=',
      value: Number(equalsMatch[1])
    };
  }
  
  return null;
}

function findColumnMentionRanges(normalizedPrompt, columnName) {
  const names = [
    String(columnName || ''),
    getReadableColumnLabel(columnName),
  ]
    .map((name) => normalizePromptText(name))
    .filter(Boolean);
  const uniqueNames = [...new Set(names)].sort((left, right) => right.length - left.length);
  const ranges = [];

  for (const name of uniqueNames) {
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi');
    let match;

    while ((match = pattern.exec(normalizedPrompt)) !== null) {
      ranges.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      });
    }
  }

  return ranges;
}

function getFilterColumnProximityScore(normalizedPrompt, columnName, operatorIndex) {
  const ranges = findColumnMentionRanges(normalizedPrompt, columnName);
  if (!ranges.length) {
    return null;
  }

  return ranges
    .map((range) => {
      const isBeforeOperator = range.end <= operatorIndex;
      const distance = isBeforeOperator
        ? operatorIndex - range.end
        : range.start - operatorIndex;

      return {
        score: (isBeforeOperator ? 1000 : 0) - Math.max(distance, 0),
        distance: Math.max(distance, 0),
      };
    })
    .sort((left, right) => right.score - left.score)[0];
}

function extractNumericFilters(normalizedPrompt, numericColumns) {
  const text = normalizeFilterPrompt(normalizedPrompt);

  if (!text || !Array.isArray(numericColumns) || !numericColumns.length) {
    return [];
  }

  const filters = [];
  const seen = new Set();

  for (const entry of numericColumns) {
    const columnName = String(entry?.column ?? entry?.name ?? '').trim();

    if (!columnName) {
      continue;
    }

    const match = parseNumericFilterForColumn(text, columnName);

    if (!match) {
      continue;
    }

    const key = `${normalizeColumnKey(columnName)}:${match.operator}:${JSON.stringify(match.value)}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    filters.push(match);
  }

  return filters;
}

module.exports = {
  parseNumericFilterForColumn,
  findColumnMentionRanges,
  getFilterColumnProximityScore,
  extractNumericFilters,
};
