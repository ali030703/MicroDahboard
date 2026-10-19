// Purpose: Discovers microorganism values from the active database and resolves prompt mentions dynamically.
const { normalizeColumnKey } = require('./dashboard-schema-profile.service');

const MICROORGANISM_COLUMN_KEYS = [
  'microorganism',
  'microorganisms',
  'microorganismname',
  'organism',
  'organismname',
  'species',
  'strain',
  'taxon',
  'taxonomy',
  'pathogen',
  'pathogenname',
];

const PROMPT_FILLER_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'bar',
  'by',
  'chart',
  'compare',
  'dashboard',
  'data',
  'for',
  'from',
  'graph',
  'in',
  'line',
  'of',
  'over',
  'plot',
  'records',
  'show',
  'table',
  'the',
  'to',
  'trend',
  'with',
]);

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function normalizeMicroorganismText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactMicroorganismText(value) {
  return normalizeMicroorganismText(value).replace(/\s+/g, '');
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = normalizeMicroorganismText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(String(value).trim());
  }

  return result;
}

function buildNameAliases(name) {
  const normalized = normalizeMicroorganismText(name);
  const tokens = normalized.split(' ').filter(Boolean);
  const aliases = [name, normalized, compactMicroorganismText(name)];

  if (tokens.length >= 2) {
    const [genus, species] = tokens;
    aliases.push(genus);
    aliases.push(`${genus[0]} ${species}`);
    aliases.push(`${genus[0]}${species}`);

    if (genus.length >= 5) {
      aliases.push(`${genus.slice(0, 5)} ${species}`);
      aliases.push(`${genus.slice(0, 5)}${species}`);
    }

    if (genus.length >= 6) {
      aliases.push(`${genus.slice(0, 6)} ${species}`);
      aliases.push(`${genus.slice(0, 6)}${species}`);
    }
  }

  return uniqueStrings(aliases);
}

function isMicroorganismNameColumn(column) {
  if (!column?.name) {
    return false;
  }

  const normalized = normalizeColumnKey(column.name);
  const isTextLike = /CHAR|CLOB|TEXT|VARCHAR|STRING/i.test(column.type || '') || typeof column.valueSample === 'string';

  if (!isTextLike || /(^id$|_id$|identifier|uuid)/i.test(column.name)) {
    return false;
  }

  return MICROORGANISM_COLUMN_KEYS.some((key) => normalized.includes(key));
}

function scoreNameColumn(column) {
  const normalized = normalizeColumnKey(column?.name);

  if (!normalized) {
    return 0;
  }

  if (normalized.includes('microorganism')) return 100;
  if (normalized.includes('pathogen')) return 95;
  if (normalized.includes('organism')) return 90;
  if (normalized.includes('species')) return 80;
  if (normalized.includes('strain')) return 70;
  return 50;
}

function findPrimaryTable(schemaProfiles, primaryTableName) {
  const normalized = normalizeColumnKey(primaryTableName);
  const profiles = Array.isArray(schemaProfiles) ? schemaProfiles : [];

  return profiles.find((table) => normalizeColumnKey(table.name) === normalized)
    || profiles[0]
    || null;
}

function findColumn(table, columnName) {
  const normalized = normalizeColumnKey(columnName);

  if (!table || !normalized) {
    return null;
  }

  return (table.columns || []).find((column) => normalizeColumnKey(column.name) === normalized) || null;
}

function findBestNameColumn(primaryTable, semanticCatalog) {
  const dimensions = Array.isArray(semanticCatalog?.dimensions) ? semanticCatalog.dimensions : [];
  const hintedDimension = dimensions
    .filter((entry) => normalizeColumnKey(entry?.table) === normalizeColumnKey(primaryTable?.name))
    .find((entry) => {
      const values = [entry.key, entry.column, entry.label, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]
        .map((value) => normalizeColumnKey(value));
      return values.some((value) => MICROORGANISM_COLUMN_KEYS.some((key) => value.includes(key)));
    });

  const hintedColumn = findColumn(primaryTable, hintedDimension?.column);
  if (hintedColumn && isMicroorganismNameColumn(hintedColumn)) {
    return hintedColumn;
  }

  return [...(primaryTable?.columns || [])]
    .filter(isMicroorganismNameColumn)
    .sort((left, right) => scoreNameColumn(right) - scoreNameColumn(left))[0] || null;
}

async function readLookupValues(db, lookupContext) {
  if (!lookupContext?.tableName || !lookupContext?.nameColumn) {
    return [];
  }

  const idColumn = lookupContext.idColumn || null;
  const selectId = idColumn ? `${quoteIdentifier(idColumn)} AS id,` : '';
  const rows = await db.all(`
    SELECT ${selectId} ${quoteIdentifier(lookupContext.nameColumn)} AS name
    FROM ${quoteIdentifier(lookupContext.tableName)}
    WHERE ${quoteIdentifier(lookupContext.nameColumn)} IS NOT NULL
    ORDER BY ${quoteIdentifier(lookupContext.nameColumn)} ASC
  `).catch(() => []);

  return rows
    .map((row) => ({
      id: row.id ?? null,
      name: String(row.name || '').trim(),
    }))
    .filter((row) => row.name);
}

async function readDistinctNameValues(db, tableName, columnName) {
  if (!tableName || !columnName) {
    return [];
  }

  const rows = await db.getDistinctValues(tableName, columnName, 1000).catch(() => []);

  return rows
    .map((row) => ({
      id: null,
      name: String(row.value || '').trim(),
    }))
    .filter((row) => row.name)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildCandidates(values) {
  return values
    .filter((value) => value?.name)
    .map((value) => ({
      id: value.id ?? null,
      name: value.name,
      normalized: normalizeMicroorganismText(value.name),
      compact: compactMicroorganismText(value.name),
      aliases: buildNameAliases(value.name),
    }))
    .filter((candidate, index, list) => {
      const key = candidate.id !== null ? `id:${candidate.id}` : `name:${candidate.normalized}`;
      return list.findIndex((entry) => {
        const entryKey = entry.id !== null ? `id:${entry.id}` : `name:${entry.normalized}`;
        return entryKey === key;
      }) === index;
    });
}

async function discoverMicroorganismCatalog({
  db,
  schemaProfiles,
  primaryTableName,
  semanticCatalog,
  lookupContext,
} = {}) {
  const primaryTable = findPrimaryTable(schemaProfiles, primaryTableName || semanticCatalog?.primaryTable);
  const lookupIdColumn = findColumn(primaryTable, lookupContext?.idColumn);
  const directNameColumn = findBestNameColumn(primaryTable, semanticCatalog);
  const lookupValues = await readLookupValues(db, lookupContext);
  const directValues = lookupValues.length
    ? []
    : await readDistinctNameValues(db, primaryTable?.name, directNameColumn?.name);
  const values = lookupValues.length ? lookupValues : directValues;
  const candidates = buildCandidates(values);
  const source = lookupValues.length ? 'lookup-table' : directNameColumn ? 'primary-table-column' : 'none';
  const filterColumn = lookupValues.length && lookupIdColumn
    ? lookupIdColumn.name
    : directNameColumn?.name || null;
  const filterValueField = lookupValues.length && lookupIdColumn ? 'id' : 'name';
  const dimensionColumn = lookupValues.length && lookupIdColumn
    ? lookupIdColumn.name
    : directNameColumn?.name || null;

  return {
    version: 1,
    source,
    table: primaryTable?.name || null,
    lookupTable: lookupValues.length ? lookupContext?.tableName || null : null,
    idColumn: lookupValues.length ? lookupContext?.idColumn || null : null,
    nameColumn: lookupValues.length ? lookupContext?.nameColumn || directNameColumn?.name || null : directNameColumn?.name || null,
    filterColumn,
    filterValueField,
    dimensionColumn,
    values: candidates.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      aliases: candidate.aliases,
    })),
    candidates,
  };
}

function levenshteinDistance(left, right) {
  const a = compactMicroorganismText(left);
  const b = compactMicroorganismText(right);

  if (a === b) {
    return 0;
  }

  if (!a.length) {
    return b.length;
  }

  if (!b.length) {
    return a.length;
  }

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }

    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function scorePhraseAgainstCandidate(phrase, candidate) {
  const normalizedPhrase = normalizeMicroorganismText(phrase);
  const compactPhrase = compactMicroorganismText(phrase);

  if (!normalizedPhrase || compactPhrase.length < 4) {
    return 0;
  }

  let score = 0;

  for (const alias of candidate.aliases || []) {
    const normalizedAlias = normalizeMicroorganismText(alias);
    const compactAlias = compactMicroorganismText(alias);

    if (normalizedPhrase === normalizedAlias) {
      score = Math.max(score, 1);
      continue;
    }

    if (compactPhrase === compactAlias) {
      score = Math.max(score, 0.98);
      continue;
    }

    if (compactPhrase.length >= 5 && compactAlias.startsWith(compactPhrase)) {
      score = Math.max(score, 0.86);
    }

    const distance = levenshteinDistance(compactPhrase, compactAlias);
    if (compactPhrase.length >= 8 && distance <= 2) {
      score = Math.max(score, 0.84);
    } else if (compactPhrase.length >= 5 && distance <= 1) {
      score = Math.max(score, 0.88);
    }
  }

  return score;
}

function buildPromptPhrases(prompt) {
  const normalized = normalizeMicroorganismText(prompt);
  const tokens = normalized.split(' ').filter(Boolean);
  const phrases = [];
  const maxTokens = Math.min(4, tokens.length);

  for (let start = 0; start < tokens.length; start += 1) {
    for (let size = maxTokens; size >= 1; size -= 1) {
      const end = start + size;
      if (end > tokens.length) {
        continue;
      }

      const phraseTokens = tokens.slice(start, end);
      if (phraseTokens.every((token) => PROMPT_FILLER_WORDS.has(token))) {
        continue;
      }

      const phrase = phraseTokens.join(' ');
      if (compactMicroorganismText(phrase).length < 4) {
        continue;
      }

      phrases.push({
        phrase,
        start,
        end,
        tokenCount: size,
      });
    }
  }

  return phrases;
}

function resolveMicroorganismsFromPrompt(prompt, microorganismCatalog) {
  const candidates = Array.isArray(microorganismCatalog?.candidates)
    ? microorganismCatalog.candidates
    : [];

  if (!prompt || !candidates.length) {
    return {
      status: 'none',
      matches: [],
      ambiguous: [],
      candidates: [],
    };
  }

  const phraseMatches = [];

  for (const phrase of buildPromptPhrases(prompt)) {
    const scored = candidates
      .map((candidate) => ({
        candidate,
        score: scorePhraseAgainstCandidate(phrase.phrase, candidate),
      }))
      .filter((entry) => entry.score >= 0.84)
      .sort((left, right) => right.score - left.score);

    if (!scored.length) {
      continue;
    }

    const bestScore = scored[0].score;
    const topMatches = scored.filter((entry) => Math.abs(entry.score - bestScore) <= 0.03);

    phraseMatches.push({
      ...phrase,
      score: bestScore,
      matches: topMatches.map((entry) => entry.candidate),
    });
  }

  phraseMatches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return right.tokenCount - left.tokenCount;
  });

  const selected = [];
  const ambiguous = [];
  const occupied = [];
  const seenCandidates = new Set();

  for (const match of phraseMatches) {
    const overlaps = occupied.some((range) => match.start < range.end && match.end > range.start);
    if (overlaps) {
      continue;
    }

    if (match.matches.length > 1) {
      ambiguous.push({
        phrase: match.phrase,
        candidates: match.matches.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
        })),
      });
      occupied.push({ start: match.start, end: match.end });
      continue;
    }

    const candidate = match.matches[0];
    const candidateKey = candidate.id !== null ? `id:${candidate.id}` : `name:${candidate.normalized}`;

    if (!seenCandidates.has(candidateKey)) {
      seenCandidates.add(candidateKey);
      selected.push({
        id: candidate.id,
        name: candidate.name,
        matchedText: match.phrase,
        score: Number(match.score.toFixed(2)),
      });
    }

    occupied.push({ start: match.start, end: match.end });
  }

  if (ambiguous.length) {
    return {
      status: 'ambiguous',
      matches: selected,
      ambiguous,
      candidates: candidates.map((candidate) => ({ id: candidate.id, name: candidate.name })),
    };
  }

  return {
    status: selected.length ? 'matched' : 'none',
    matches: selected,
    ambiguous: [],
    candidates: candidates.map((candidate) => ({ id: candidate.id, name: candidate.name })),
  };
}

module.exports = {
  discoverMicroorganismCatalog,
  normalizeMicroorganismText,
  resolveMicroorganismsFromPrompt,
};
