// Purpose: Configures the Express application, middleware, and API routes.
// === FILE DESCRIPTION ===
// Configures and starts the Express server with middleware and API routing.

const express = require('express'); // Web framework for Node.js
const cors = require('cors'); // Cross-origin request handling
const { apiRouter } = require('./routes/api.routes'); // Main API router

const app = express();

// Global middleware
app.use(cors()); // Enable cross-origin access
app.use(express.json()); // Parse JSON request bodies

// API routing
app.use('/api', apiRouter); // All API routes live under /api

module.exports = { app };
