'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const db = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Security headers
app.use(helmet({ contentSecurityPolicy: false }));

// --- Allow frontend to talk to backend
app.use(cors());

// --- Parse incoming JSON
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));

// Auth endpoints — strict limit (protects against brute force)
app.use('/api/auth', rateLimit({
  windowMs : 15 * 60 * 1000,
  max      : 30,
  message  : { error: 'Too many attempts. Please wait 15 minutes.' }
}));

// Admin endpoints — moderate limit
app.use('/api/admin', rateLimit({
  windowMs : 15 * 60 * 1000,
  max      : 200,
  message  : { error: 'Too many requests. Please slow down.' }
}));

// --- Serve frontend files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// --- Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// --- Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/grand', require('./routes/grandAdmin'));
app.use('/api/agent', require('./routes/agent')); // <-- Agent routes (e.g. /api/agent/report-usage)
app.use('/api/agent', (req, res, next) => next()); // <-- Placeholder for future agent routes

// --- Fallback — serve portal for any unknown route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'ets-portal.html'));
});

// --- Global error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({ error: 'Something went wrong.' });
});

// --- Start server
(async () => {
  await db.init();
  app.listen(PORT, () => {
    console.log(`\n Server running at http://localhost:${PORT}`);
    console.log(`   Portal: http://localhost:${PORT}/ets-portal.html`);
    console.log(`   Admin:  http://localhost:${PORT}/ets-admin.html`);
    console.log(`   Health: http://localhost:${PORT}/api/health\n`);
  });
})();
