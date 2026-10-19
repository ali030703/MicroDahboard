# Micro Dashboard

An interactive microbiology analytics dashboard. Describe an analysis in plain language and the app turns it into a data-backed dashboard with charts and reusable definitions.

## Highlights

- Generate charts and dashboard layouts from natural-language prompts.
- Explore microorganism morphology measurements, including area, perimeter, solidity, and eccentricity.
- Refine a selected chart, inspect chart data points, and create variations from saved generations.
- Use a semantic catalog and versioned JSON definitions to keep data bindings and visual configuration explicit.
- Run the Angular UI and Express API locally against a SQLite dataset.

## Technology

| Layer | Stack |
| --- | --- |
| Frontend | Angular, TypeScript, Chart.js |
| Backend | Node.js, Express |
| Data | SQLite |
| Validation | Node.js validation scripts |

## Get started

Requirements: Node.js 22.12 or newer and npm.

```bash
npm ci
npm run setup:data
npm run dev
```

Open [http://localhost:4200](http://localhost:4200). The API runs at [http://localhost:3000](http://localhost:3000).

`setup:data` builds the local SQLite database from `backend/sql/microbes.csv`. The generated database is ignored by Git; the source CSV is kept in the repository. The setup command refuses to overwrite an existing database. To rebuild it, first move or remove `backend/sql/microbes.db`.

To run the services separately, use `npm run start:frontend` and `npm run start:api` in separate terminals.

## Useful commands

| Command | Description |
| --- | --- |
| `npm run build` | Build the Angular frontend |
| `npm run lint` | Run the repository's JavaScript and TypeScript syntax checks |
| `npm test` | Run the dashboard validation scripts |
| `npm run setup:data` | Create the local SQLite database from the bundled CSV |

## API

The Express API is mounted at `/api`. Its main routes include:

- `POST /api/dashboard/generate` — generate a dashboard from a prompt.
- `GET /api/dashboard/semantic-catalog` — inspect the available data semantics.
- `GET` and `POST /api/dashboards` — list or create saved dashboard definitions.
- `GET /api/categories` and `GET /api/distribution` — query microorganism categories and distributions.
- `/api/dashboard/session/*` — manage dashboard generation sessions.

## Project structure

```text
backend/
  sql/                 CSV source data and SQL migrations
  src/
    adapters/          Database adapters
    config/            Runtime and domain schema
    content/           Dashboard definitions and engine registry
    controllers/        HTTP request handlers
    services/           Dashboard generation and data services
frontend/
  src/app/             Angular application and dashboard engine
scripts/
  maintenance/         Dataset and maintenance utilities
  validation/          Focused dashboard validation scripts
```

## License

Released under the MIT License. See [LICENSE](./LICENSE).
