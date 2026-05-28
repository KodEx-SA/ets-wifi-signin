'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const initSql = require('sql.js');
require('dotenv').config();

const { encrypt, encryptGA, hashLookup } = require('../utils/encryption');

const DB_PATH = path.resolve(__dirname, process.env.DB_PATH || './ets-wifi.db');
const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

let db = null;

// Save the in-memory database to disk after every write
function save() {
  const data = db.export();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Run a SELECT — returns an array of row objects
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  stmt.bind(params);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// Run a SELECT — returns only the first row or null
function queryOne(sql, params = []) {
  return query(sql, params)[0] ?? null;
}

// Run INSERT / UPDATE / DELETE — saves to disk automatically
function run(sql, params = []) {
  db.run(sql, params);
  const meta = db.exec('SELECT last_insert_rowid() as id, changes() as ch');
  save();
  const row = meta[0]?.values[0];
  return { lastID: row?.[0] ?? 0, changes: row?.[1] ?? 0 };
}

// Seed default plans and admin accounts on first boot
async function seed() {
  console.log('[DB] Seeding initial data...');

  const plans = [
    { name: 'Guest (30min / 50MB)', hours: 0.5, mb: 50 },
    { name: 'Basic (1h / 200MB)', hours: 1, mb: 200 },
    { name: 'Standard (4h / 500MB)', hours: 4, mb: 500 },
    { name: 'Extended (8h / 1GB)', hours: 8, mb: 1024 },
    { name: 'Daily (24h / 3GB)', hours: 24, mb: 3072 },
  ];

  for (const p of plans) {
    run(
      'INSERT INTO plans (name, duration_hours, data_limit_mb) VALUES (?, ?, ?)',
      [p.name, p.hours, p.mb]
    );
  }

  const adminUser = process.env.ADMIN_USERNAME || 'admin@ets.local';
  const adminPass = process.env.ADMIN_PASSWORD || 'ETS@Admin2025!';
  const grandUser = process.env.GRAND_ADMIN_USERNAME || 'ga@ets.internal';
  const grandPass = process.env.GRAND_ADMIN_PASSWORD || 'GA@SuperSecret2025!';

  const adminHash = await bcrypt.hash(adminPass, 14);
  const grandHash = await bcrypt.hash(grandPass, 14);

  run(
    'INSERT INTO admins (username_hash, username_enc, username_ga, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    [hashLookup(adminUser), encrypt(adminUser), encryptGA(adminUser), adminHash, 'admin']
  );

  run(
    'INSERT INTO admins (username_hash, username_enc, username_ga, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    [hashLookup(grandUser), encrypt(grandUser), encryptGA(grandUser), grandHash, 'grand_admin']
  );

  console.log('[DB] Seeded plans and admin accounts.');
}

// Initialise — load existing DB or create a fresh one
async function init() {
  const SQL = await initSql();

  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
    console.log('[DB] Loaded existing database.');
  } else {
    db = new SQL.Database();
    db.run(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    console.log('[DB] Created new database.');
    await seed();
    save();
  }

  db.run('PRAGMA foreign_keys = ON;');
  return db;
}

module.exports = { init, query, queryOne, run, save };

