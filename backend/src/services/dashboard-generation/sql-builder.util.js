function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}
function buildSqlLiteral(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  return `'${escapeSqlLiteral(String(value))}'`;
}
function escapeSqlLiteral(value) {
  return String(value).replace(/'/g, "''");
}


function escapeSqlLikePattern(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

function buildSqlFilterClause(filter, tableName) {
  if (!filter || typeof filter !== 'object' || !filter.column || !filter.operator) {
    return null;
  }

  const column = tableName
    ? `${quoteIdentifier(tableName)}.${quoteIdentifier(filter.column)}`
    : quoteIdentifier(filter.column);
  const operator = String(filter.operator).trim().toLowerCase();
  const value = filter.value;

  if (operator === 'contains') {
    const cleanValue = String(value ?? '').toLowerCase();
    const safeValue = escapeSqlLikePattern(escapeSqlLiteral(cleanValue));
    return `LOWER(CAST(${column} AS TEXT)) LIKE '%${safeValue}%'`;
  }

  if (operator === 'between') {
    const values = Array.isArray(value) ? value : [value];
    if (values.length < 2) return null;
    return `${column} BETWEEN ${buildSqlLiteral(values[0])} AND ${buildSqlLiteral(values[1])}`;
  }

  if (operator === 'in') {
    const values = Array.isArray(value) ? value : [value];
    const filteredValues = values.filter((entry) => entry !== null && entry !== undefined && String(entry).trim() !== '');
    if (!filteredValues.length) return null;
    return `${column} IN (${filteredValues.map((entry) => buildSqlLiteral(entry)).join(', ')})`;
  }

  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    if (operator === '=' || operator === 'eq') {
      return `${column} IS NULL`;
    }
    if (operator === '!=' || operator === 'neq') {
      return `${column} IS NOT NULL`;
    }
    return null;
  }

  return `${column} ${operator} ${buildSqlLiteral(value)}`;
}

function buildSqlWhereClause(filters, tableName) {
  if (!Array.isArray(filters) || !filters.length) {
    return '';
  }

  const clauses = filters
    .map((filter) => buildSqlFilterClause(filter, tableName))
    .filter(Boolean);

  if (!clauses.length) {
    return '';
  }

  return `WHERE ${clauses.join(' AND ')}`;
}

module.exports = {
  quoteIdentifier,
  buildSqlLiteral,
  escapeSqlLiteral,
  escapeSqlLikePattern,
  buildSqlFilterClause,
  buildSqlWhereClause,
};