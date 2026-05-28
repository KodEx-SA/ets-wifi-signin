'use strict';

const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const db = require('../db/database');
const enc = require('../utils/encryption');

const router = express.Router();
router.use(requireAdmin);

// Helper: safely decrypt a value
function safeDecrypt(val) {
  try { return enc.decrypt(val); } catch { return null; }
}

// ================================================================
// GET /api/admin/stats
// ================================================================
router.get('/stats', (req, res) => {
  const totalUsers = db.queryOne('SELECT COUNT(*) as n FROM users')?.n ?? 0;
  const activeUsers = db.queryOne(`SELECT COUNT(*) as n FROM sessions WHERE status = 'active'`)?.n ?? 0;
  const blockedUsers = db.queryOne(`SELECT COUNT(*) as n FROM users WHERE status = 'blocked'`)?.n ?? 0;
  const totalDevices = db.queryOne('SELECT COUNT(*) as n FROM devices')?.n ?? 0;
  const dataUsedMb = db.queryOne(`SELECT COALESCE(SUM(data_used_mb),0) as mb FROM sessions`)?.mb ?? 0;

  const authBreakdown = db.query(
    'SELECT auth_method, COUNT(*) as count FROM users GROUP BY auth_method'
  );

  const recentLogs = db.query(
    `SELECT id, event_type, auth_method, created_at, detail_enc
     FROM logs ORDER BY created_at DESC LIMIT 15`
  ).map(l => ({
    ...l,
    detail: safeDecrypt(l.detail_enc)
  }));

  return res.json({
    totalUsers,
    activeUsers,
    blockedUsers,
    totalDevices,
    dataUsedGb: (dataUsedMb / 1024).toFixed(2),
    authBreakdown,
    recentLogs
  });
});

// ================================================================
// GET /api/admin/users
// ================================================================
router.get('/users', (req, res) => {
  const { status, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let sql = 'SELECT * FROM users WHERE 1=1';
  const params = [];

  if (status && status !== 'all') {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);

  const users = db.query(sql, params).map(u => ({
    id: u.id,
    authMethod: u.auth_method,
    status: u.status,
    planId: u.plan_id,
    createdAt: u.created_at,
    fullName: safeDecrypt(u.full_name_enc),
    email: safeDecrypt(u.email_enc),
    phone: safeDecrypt(u.phone_enc),
    saId: '**REDACTED**'
  }));

  const total = db.queryOne('SELECT COUNT(*) as n FROM users')?.n ?? 0;

  return res.json({ users, total });
});

// ================================================================
// GET /api/admin/users/:id
// ================================================================
router.get('/users/:id', (req, res) => {
  const user = db.queryOne('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const sessions = db.query(
    `SELECT s.*, p.name as plan_name FROM sessions s
     LEFT JOIN plans p ON s.plan_id = p.id
     WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 10`,
    [user.id]
  );

  const devices = db.query(
    'SELECT id, is_blocked, first_seen, last_seen FROM devices WHERE user_id = ?',
    [user.id]
  );

  return res.json({
    user: {
      id: user.id,
      authMethod: user.auth_method,
      status: user.status,
      planId: user.plan_id,
      createdAt: user.created_at,
      fullName: safeDecrypt(user.full_name_enc),
      email: safeDecrypt(user.email_enc),
      phone: safeDecrypt(user.phone_enc),
      saId: '**REDACTED**'
    },
    sessions,
    devices
  });
});

// ================================================================
// POST /api/admin/users/:id/block
// ================================================================
router.post('/users/:id/block', (req, res) => {
  const { reason } = req.body;
  const user = db.queryOne('SELECT id FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  db.run(`UPDATE users SET status = 'blocked' WHERE id = ?`, [user.id]);
  db.run(
    `UPDATE sessions SET status = 'blocked' WHERE user_id = ? AND status = 'active'`,
    [user.id]
  );

  db.run(
    `INSERT INTO logs (user_id, event_type, detail_enc, detail_ga)
     VALUES (?, 'blocked', ?, ?)`,
    [
      user.id,
      enc.encrypt(reason || 'Blocked by admin'),
      enc.encryptGA(reason || 'Blocked by admin')
    ]
  );

  return res.json({ message: 'User blocked.' });
});

// ================================================================
// POST /api/admin/users/:id/unblock
// ================================================================
router.post('/users/:id/unblock', (req, res) => {
  db.run(`UPDATE users SET status = 'active' WHERE id = ?`, [req.params.id]);
  db.run(
    `INSERT INTO logs (user_id, event_type, detail_enc, detail_ga)
     VALUES (?, 'unblocked', ?, ?)`,
    [
      req.params.id,
      enc.encrypt('Unblocked by admin'),
      enc.encryptGA('Unblocked by admin')
    ]
  );
  return res.json({ message: 'User unblocked.' });
});

// ================================================================
// GET /api/admin/sessions
// ================================================================
router.get('/sessions', (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT s.*, p.name as plan_name
    FROM sessions s
    LEFT JOIN plans p ON s.plan_id = p.id
    WHERE 1=1
  `;
  const params = [];
  if (status && status !== 'all') {
    sql += ' AND s.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY s.created_at DESC LIMIT 100';

  return res.json({ sessions: db.query(sql, params) });
});

// ================================================================
// POST /api/admin/sessions/:id/disconnect
// ================================================================
router.post('/sessions/:id/disconnect', (req, res) => {
  db.run(
    `UPDATE sessions SET status = 'disconnected' WHERE id = ?`,
    [req.params.id]
  );
  return res.json({ message: 'Session disconnected.' });
});

// ================================================================
// GET /api/admin/devices
// ================================================================
router.get('/devices', (req, res) => {
  const devices = db.query(
    'SELECT id, user_id, is_blocked, first_seen, last_seen FROM devices ORDER BY last_seen DESC LIMIT 200'
  );
  return res.json({ devices });
});

// ================================================================
// POST /api/admin/devices/:id/block
// ================================================================
router.post('/devices/:id/block', (req, res) => {
  db.run('UPDATE devices SET is_blocked = 1 WHERE id = ?', [req.params.id]);
  return res.json({ message: 'Device blocked.' });
});

// ================================================================
// POST /api/admin/devices/:id/unblock
// ================================================================
router.post('/devices/:id/unblock', (req, res) => {
  db.run('UPDATE devices SET is_blocked = 0 WHERE id = ?', [req.params.id]);
  return res.json({ message: 'Device unblocked.' });
});

// ================================================================
// GET /api/admin/logs
// ================================================================
router.get('/logs', (req, res) => {
  const { eventType, page = 1, limit = 100 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let sql = 'SELECT * FROM logs WHERE 1=1';
  const params = [];
  if (eventType && eventType !== 'all') {
    sql += ' AND event_type = ?';
    params.push(eventType);
  }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);

  const logs = db.query(sql, params).map(l => ({
    ...l,
    detail: safeDecrypt(l.detail_enc)
  }));

  return res.json({ logs });
});

// ================================================================
// GET /api/admin/plans
// ================================================================
router.get('/plans', (req, res) => {
  return res.json({ plans: db.query('SELECT * FROM plans ORDER BY duration_hours') });
});

// ================================================================
// POST /api/admin/plans
// ================================================================
router.post('/plans', (req, res) => {
  const { name, durationHours, dataMb, description } = req.body;
  if (!name || !durationHours || !dataMb) {
    return res.status(400).json({ error: 'name, durationHours and dataMb are required.' });
  }
  const r = db.run(
    'INSERT INTO plans (name, duration_hours, data_limit_mb, description) VALUES (?, ?, ?, ?)',
    [name, parseFloat(durationHours), parseFloat(dataMb), description || '']
  );
  return res.status(201).json({ message: 'Plan created.', id: r.lastID });
});

// ================================================================
// PUT /api/admin/plans/:id
// ================================================================
router.put('/plans/:id', (req, res) => {
  const { name, durationHours, dataMb, isActive } = req.body;
  db.run(
    `UPDATE plans SET
       name           = COALESCE(?, name),
       duration_hours = COALESCE(?, duration_hours),
       data_limit_mb  = COALESCE(?, data_limit_mb),
       is_active      = COALESCE(?, is_active)
     WHERE id = ?`,
    [name, durationHours, dataMb, isActive, req.params.id]
  );
  return res.json({ message: 'Plan updated.' });
});

module.exports = router;
