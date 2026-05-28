'use strict';

const express = require('express');
const { requireGrandAdmin } = require('../middleware/auth');
const db = require('../db/database');
const enc = require('../utils/encryption');

const router = express.Router();
router.use(requireGrandAdmin);

// Helper: safely decrypt with GA key
function safeGA(val) {
  try { return enc.decryptGA(val); } catch { return null; }
}

// Helper: safely decrypt with main key
function safeDecrypt(val) {
  try { return enc.decrypt(val); } catch { return null; }
}

// ================================================================
// GET /api/grand/users
// Full decryption of all user fields including SA ID
// ================================================================
router.get('/users', (req, res) => {
  const users = db.query('SELECT * FROM users ORDER BY created_at DESC');

  return res.json({
    users: users.map(u => ({
      id: u.id,
      authMethod: u.auth_method,
      status: u.status,
      planId: u.plan_id,
      createdAt: u.created_at,
      fullName: safeGA(u.full_name_ga),
      email: safeGA(u.email_ga),
      phone: safeGA(u.phone_ga),
      saId: safeGA(u.sa_id_ga),
      _encrypted: {
        full_name_enc: u.full_name_enc,
        email_enc: u.email_enc,
        sa_id_enc: u.sa_id_enc
      }
    }))
  });
});

// ================================================================
// GET /api/grand/devices
// Full MAC addresses decrypted
// ================================================================
router.get('/devices', (req, res) => {
  const devices = db.query('SELECT * FROM devices ORDER BY last_seen DESC');

  return res.json({
    devices: devices.map(d => ({
      id: d.id,
      userId: d.user_id,
      macAddress: safeGA(d.mac_ga),
      isBlocked: !!d.is_blocked,
      firstSeen: d.first_seen,
      lastSeen: d.last_seen,
      _encrypted: { mac_enc: d.mac_enc }
    }))
  });
});

// ================================================================
// GET /api/grand/logs
// Full log details decrypted with GA key
// ================================================================
router.get('/logs', (req, res) => {
  const logs = db.query(
    'SELECT * FROM logs ORDER BY created_at DESC LIMIT 500'
  );

  return res.json({
    logs: logs.map(l => ({
      id: l.id,
      userId: l.user_id,
      adminId: l.admin_id,
      eventType: l.event_type,
      authMethod: l.auth_method,
      macHash: l.mac_hash,
      createdAt: l.created_at,
      ip: safeGA(l.ip_enc),
      detail: safeGA(l.detail_ga),
      _encrypted: {
        ip_enc: l.ip_enc,
        detail_enc: l.detail_enc
      }
    }))
  });
});

// ================================================================
// GET /api/grand/admins
// List all admin accounts
// ================================================================
router.get('/admins', (req, res) => {
  const admins = db.query(
    'SELECT id, username_enc, username_ga, role, is_active, last_login_at, created_at FROM admins'
  );

  return res.json({
    admins: admins.map(a => ({
      id: a.id,
      role: a.role,
      isActive: !!a.is_active,
      lastLoginAt: a.last_login_at,
      createdAt: a.created_at,
      username: safeGA(a.username_ga),
      _encrypted: { username_enc: a.username_enc }
    }))
  });
});

// ================================================================
// POST /api/grand/decrypt
// Manually decrypt any payload for audit purposes
// ================================================================
router.post('/decrypt', (req, res) => {
  const { payload, keyType } = req.body;
  if (!payload) return res.status(400).json({ error: 'payload is required.' });

  try {
    const plaintext = keyType === 'main'
      ? safeDecrypt(payload)
      : safeGA(payload);

    if (plaintext === null) {
      return res.status(400).json({ error: 'Decryption failed.' });
    }

    return res.json({ plaintext });
  } catch (err) {
    return res.status(400).json({ error: 'Decryption failed: ' + err.message });
  }
});

module.exports = router;
