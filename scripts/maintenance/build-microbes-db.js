const fs = require('node:fs/promises');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const projectRoot = path.resolve(__dirname, '../..');
const csvPath = path.join(projectRoot, 'backend/sql/microbes.csv');
const defaultDatabasePath = path.join(projectRoot, 'backend/sql/microbes.db');

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function parseCsv(contents) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];

    if (inQuotes) {
      if (character === '"' && contents[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && contents[index + 1] === '\n') {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value !== '')) {
        rows.push(row);
      }
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error('The CSV contains an unterminated quoted field.');
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function openDatabase(databasePath) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(
      databasePath,
      sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
      (error) => (error ? reject(error) : resolve(database)),
    );
  });
}

function run(database, sql, values = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, values, function onRun(error) {
      if (error) {
        reject(error);
      } else {
        resolve(this);
      }
    });
  });
}

function insertRows(database, sql, rows) {
  return new Promise((resolve, reject) => {
    database.serialize(() => {
      const statement = database.prepare(sql);
      let firstError = null;

      for (const values of rows) {
        statement.run(values, (error) => {
          if (error && !firstError) {
            firstError = error;
          }
        });
      }

      statement.finalize((error) => {
        if (firstError || error) {
          reject(firstError || error);
        } else {
          resolve();
        }
      });
    });
  });
}

function closeDatabase(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => (error ? reject(error) : resolve()));
  });
}

async function buildDatabase(databasePath) {
  const csvContents = await fs.readFile(csvPath, 'utf8');
  const [rawHeaders, ...records] = parseCsv(csvContents.replace(/^\uFEFF/, ''));

  if (!rawHeaders || records.length === 0) {
    throw new Error('The CSV must contain a header and at least one data row.');
  }

  const headers = rawHeaders.map((header, index) => {
    if (index === 0 && header === '') {
      return 'source_index';
    }
    return header.trim();
  });

  if (!headers.includes('microorganisms')) {
    throw new Error('The CSV must contain a microorganisms column.');
  }
  if (new Set(headers).size !== headers.length || headers.some((header) => !header)) {
    throw new Error('The CSV contains an empty or duplicate column name.');
  }

  const microorganismNames = new Map();
  const preparedRows = records.map((record, index) => {
    if (record.length !== headers.length) {
      throw new Error(`CSV row ${index + 2} has ${record.length} fields; expected ${headers.length}.`);
    }

    const values = Object.fromEntries(headers.map((header, columnIndex) => [header, record[columnIndex]]));
    const name = values.microorganisms.trim();
    if (!name) {
      throw new Error(`CSV row ${index + 2} has no microorganism name.`);
    }

    if (!microorganismNames.has(name)) {
      microorganismNames.set(name, microorganismNames.size + 1);
    }

    const normalized = headers.map((header) => {
      const value = values[header].trim();
      if (header === 'microorganisms') {
        return value;
      }
      if (!value) {
        return null;
      }
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) {
        throw new Error(`CSV row ${index + 2} has a non-numeric value in "${header}".`);
      }
      return numericValue;
    });

    return [microorganismNames.get(name), ...normalized];
  });

  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  let database;
  let createdDatabase = false;

  try {
    database = await openDatabase(databasePath);
    createdDatabase = true;
    await run(database, 'BEGIN TRANSACTION');

    const tableColumns = [
      '"microorganism_id" INTEGER NOT NULL',
      ...headers.map((header) => `${quoteIdentifier(header)} ${header === 'microorganisms' ? 'TEXT' : (header === 'source_index' ? 'INTEGER' : 'REAL')}`),
    ];
    await run(database, `CREATE TABLE "microbes" (${tableColumns.join(', ')})`);
    await run(database, `
      CREATE TABLE "microorganism_dim" (
        "microorganism_id" INTEGER PRIMARY KEY,
        "microorganism_name" TEXT NOT NULL UNIQUE
      )
    `);

    const dimensionRows = [...microorganismNames.entries()].map(([name, id]) => [id, name]);
    await insertRows(database, 'INSERT INTO "microorganism_dim" ("microorganism_id", "microorganism_name") VALUES (?, ?)', dimensionRows);

    const columnNames = ['microorganism_id', ...headers];
    const placeholders = columnNames.map(() => '?').join(', ');
    const insertSql = `INSERT INTO "microbes" (${columnNames.map(quoteIdentifier).join(', ')}) VALUES (${placeholders})`;
    await insertRows(database, insertSql, preparedRows);
    await run(database, 'CREATE INDEX "idx_microbes_microorganism_id" ON "microbes" ("microorganism_id")');
    await run(database, 'COMMIT');
    await closeDatabase(database);
    database = null;
  } catch (error) {
    if (database) {
      try {
        await run(database, 'ROLLBACK');
      } catch (rollbackError) {
        console.error('Could not roll back the database setup:', rollbackError);
      }
      try {
        await closeDatabase(database);
      } catch (closeError) {
        console.error('Could not close the database after setup failed:', closeError);
      }
    }
    if (createdDatabase) {
      try {
        await fs.rm(databasePath, { force: true });
      } catch (removeError) {
        console.error(`Could not remove the incomplete database at ${databasePath}:`, removeError);
      }
    }
    throw error;
  }

  return { rowCount: preparedRows.length, microorganismCount: microorganismNames.size };
}

async function main() {
  const databasePath = path.resolve(process.argv[2] || defaultDatabasePath);

  try {
    await fs.access(databasePath);
    throw new Error(`Database already exists at ${databasePath}; move or remove it before rebuilding.`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const result = await buildDatabase(databasePath);
  console.log(`Created ${databasePath}: ${result.rowCount} records, ${result.microorganismCount} microorganisms.`);
}

main().catch((error) => {
  console.error('Failed to build the microbiology database:', error.message);
  process.exitCode = 1;
});
