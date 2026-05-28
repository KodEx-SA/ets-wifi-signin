'use strict';

const express = require('express');
const db      = require('../db/database');
const enc     = require('../utils/encryption');

const router  = express.Router();

// ── Agent Authentication Middleware ───────────────────────────
// The Agent sends X-Agent-Secret header with every request.
// This prevents random clients from calling agent endpoints.

function requireAgentSecret(req, res, next) {
  const secret = req.headers['x-agent-secret'];
  if (!secret || secret !== process.env.AGENT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized agent request.' });
  }
  next();
}

router.use(requireAgentSecret);

// ── POST /api/agent/check-device ──────────────────────────────
// Agent asks: is this MAC address allowed to use the internet?
// Returns { allowed, sessionToken, userId, planName }

router.post('/check-device', (req, res) => {
  const { mac, ip } = req.body;
  if (!mac) return res.status(400).json({ error: 'MAC address required.' });

  try {
    const macHash = enc.hashMac(mac);

    // Check if device is blocked
    const device = db.queryOne(
      'SELECT * FROM devices WHERE mac_hash = ?',
      [macHash]
    );

    if (device?.is_blocked) {
      return res.json({ allowed: false, reason: 'device_blocked' });
    }

    if (!device) {
      return res.json({ allowed: false, reason: 'unknown_device' });
    }

    // Check if device has an active session
    const session = db.queryOne(
      `SELECT s.*, p.name as plan_name
       FROM sessions s
       LEFT JOIN plans p ON s.plan_id = p.id
       WHERE s.device_id = ?
       AND s.status = 'active'
       AND s.expires_at > datetime('now')
       ORDER BY s.created_at DESC LIMIT 1`,
      [device.id]
    );

    if (!session) {
      return res.json({ allowed: false, reason: 'no_active_session' });
    }

    // Check data limit
    if (session.data_used_mb >= session.data_limit_mb) {
      return res.json({
        allowed      : false,
        reason       : 'data_exhausted',
        sessionToken : session.session_token,
      });
    }

    // Update device last seen and IP
    db.run(
      'UPDATE devices SET last_seen = datetime("now") WHERE id = ?',
      [device.id]
    );

    return res.json({
      allowed      : true,
      sessionToken : session.session_token,
      userId       : session.user_id,
      planName     : session.plan_name,
      dataUsedMb   : session.data_used_mb,
      dataLimitMb  : session.data_limit_mb,
    });

  } catch (err) {
    console.error('[Agent] check-device error:', err.message);
    return res.status(500).json({ error: 'Check failed.', allowed: false });
  }
});

// ── POST /api/agent/register-device ──────────────────────────
// Agent reports a newly discovered device on the network.
// Creates a device record if it doesn't exist yet.

router.post('/register-device', (req, res) => {
  const { mac, ip, deviceInfo } = req.body;
  if (!mac) return res.status(400).json({ error: 'MAC address required.' });

  try {
    const macHash = enc.hashMac(mac);
    const existing = db.queryOne(
      'SELECT id, is_blocked FROM devices WHERE mac_hash = ?',
      [macHash]
    );

    if (existing) {
      // Update last seen
      db.run(
        'UPDATE devices SET last_seen = datetime("now") WHERE id = ?',
        [existing.id]
      );
      return res.json({
        deviceId  : existing.id,
        isNew     : false,
        isBlocked : !!existing.is_blocked,
      });
    }

    // Create new device record
    const result = db.run(
      `INSERT INTO devices
         (mac_hash, mac_enc, mac_ga, device_info_enc, last_seen)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [
        macHash,
        enc.encrypt(mac),
        enc.encryptGA(mac),
        enc.encrypt(JSON.stringify(deviceInfo || {})),
      ]
    );

    // Log the new device event
    db.run(
      `INSERT INTO logs (event_type, mac_hash, ip_enc, detail_enc, detail_ga)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'device_seen',
        macHash,
        ip ? enc.encrypt(ip) : null,
        enc.encrypt(JSON.stringify({ mac, ip, ...deviceInfo })),
        enc.encryptGA(JSON.stringify({ mac, ip, ...deviceInfo })),
      ]
    );

    console.log(`[Agent Route] New device registered: ${mac} (${ip})`);

    return res.status(201).json({
      deviceId  : result.lastID,
      isNew     : true,
      isBlocked : false,
    });

  } catch (err) {
    console.error('[Agent] register-device error:', err.message);
    return res.status(500).json({ error: 'Registration failed.' });
  }
});

// ── POST /api/agent/log-event ─────────────────────────────────
// Agent logs a network event to the audit log.

router.post('/log-event', (req, res) => {
  const { eventType, mac, ip, detail } = req.body;
  if (!eventType) return res.status(400).json({ error: 'eventType required.' });

  try {
    const macHash   = mac ? enc.hashMac(mac) : null;
    const detailStr = JSON.stringify(detail || {});

    db.run(
      `INSERT INTO logs
         (event_type, mac_hash, ip_enc, detail_enc, detail_ga)
       VALUES (?, ?, ?, ?, ?)`,
      [
        eventType,
        macHash,
        ip ? enc.encrypt(ip) : null,
        enc.encrypt(detailStr),
        enc.encryptGA(detailStr),
      ]
    );

    return res.json({ message: 'Event logged.' });
  } catch (err) {
    console.error('[Agent] log-event error:', err.message);
    return res.status(500).json({ error: 'Logging failed.' });
  }
});

// ── POST /api/agent/interface-stats ──────────────────────────
// Agent reports network interface statistics.
// Stored for the dashboard bandwidth chart.

router.post('/interface-stats', (req, res) => {
  const { interface: iface, rxMb, txMb, totalMb, timestamp } = req.body;

  try {
    // Store in logs as a stats event for the dashboard to read
    db.run(
      `INSERT INTO logs (event_type, detail_enc, detail_ga)
       VALUES (?, ?, ?)`,
      [
        'interface_stats',
        enc.encrypt(JSON.stringify({ iface, rxMb, txMb, totalMb, timestamp })),
        enc.encryptGA(JSON.stringify({ iface, rxMb, txMb, totalMb, timestamp })),
      ]
    );

    return res.json({ message: 'Stats recorded.' });
  } catch (err) {
    console.error('[Agent] interface-stats error:', err.message);
    return res.status(500).json({ error: 'Stats recording failed.' });
  }
});

module.exports = router;
