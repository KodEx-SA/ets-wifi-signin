'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const db  = require('../db/database');
const enc = require('../utils/encryption');

const router = express.Router();

// --- Helper: issue a JWT access token
function issueToken(payload) {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m'
  });
}

// --- Helper: add hours to now
function addHours(hours) {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

// --- Helper: write to audit log
function logEvent(userId, eventType, detail, ip) {
  try {
    db.run(
      `INSERT INTO logs (user_id, event_type, ip_enc, detail_enc, detail_ga)
       VALUES (?, ?, ?, ?, ?)`,
      [
        userId || null,
        eventType,
        ip ? enc.encrypt(ip) : null,
        enc.encrypt(JSON.stringify(detail)),
        enc.encryptGA(JSON.stringify(detail))
      ]
    );
  } catch (e) {
    console.error('[Log Error]', e.message);
  }
}

// --- Helper: find or create a device record from MAC address
function upsertDevice(macHash, macRaw, userId) {
  const existing = db.queryOne(
    'SELECT id FROM devices WHERE mac_hash = ?', [macHash]
  );
  if (existing) {
    db.run(
      'UPDATE devices SET user_id = ?, last_seen = datetime("now") WHERE id = ?',
      [userId, existing.id]
    );
    return existing.id;
  }
  const r = db.run(
    `INSERT INTO devices (mac_hash, mac_enc, mac_ga, user_id, last_seen)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [macHash, enc.encrypt(macRaw), enc.encryptGA(macRaw), userId]
  );
  return r.lastID;
}

// --- Helper: create a session for a user
function createSession(userId, planId, deviceId, ip) {
  const plan = db.queryOne('SELECT * FROM plans WHERE id = ?', [planId]);
  if (!plan) throw new Error('Plan not found.');

  const token     = uuidv4();
  const expiresAt = addHours(plan.duration_hours);

  db.run(
    `INSERT INTO sessions
       (user_id, device_id, session_token, plan_id, ip_enc,
        expires_at, data_limit_mb, period_end)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      deviceId || null,
      token,
      planId,
      ip ? enc.encrypt(ip) : null,
      expiresAt,
      plan.data_limit_mb,
      expiresAt
    ]
  );

  return { token, plan, expiresAt };
}

// ================================================================
// POST /api/auth/register
// ================================================================
router.post('/register', async (req, res) => {
  try {
    const {
      authMethod, fullName, email, saId,
      password, macAddress, planId
    } = req.body;

    if (!authMethod) {
      return res.status(400).json({ error: 'authMethod is required.' });
    }
    if (!fullName?.trim()) {
      return res.status(400).json({ error: 'Full name is required.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    let emailHash = null, emailEnc = null, emailGa = null;
    let saIdHash  = null, saIdEnc  = null, saIdGa  = null;

    if (authMethod === 'email') {
      if (!email) return res.status(400).json({ error: 'Email is required.' });
      emailHash = enc.hashLookup(email);
      const dup = db.queryOne('SELECT id FROM users WHERE email_hash = ?', [emailHash]);
      if (dup) return res.status(409).json({ error: 'An account with this email already exists.' });
      emailEnc = enc.encrypt(email);
      emailGa  = enc.encryptGA(email);
    }

    if (authMethod === 'sa_id') {
      if (!saId) return res.status(400).json({ error: 'SA ID is required.' });
      saIdHash = enc.hashLookup(saId);
      const dup = db.queryOne('SELECT id FROM users WHERE sa_id_hash = ?', [saIdHash]);
      if (dup) return res.status(409).json({ error: 'An account with this ID already exists.' });
      saIdEnc = enc.encrypt(saId);
      saIdGa  = enc.encryptGA(saId);
      if (email) {
        emailHash = enc.hashLookup(email);
        emailEnc  = enc.encrypt(email);
        emailGa   = enc.encryptGA(email);
      }
    }

    const activePlanId = planId || 3;

    const userResult = db.run(
      `INSERT INTO users
         (full_name_enc, full_name_ga, email_enc, email_ga, email_hash,
          sa_id_enc, sa_id_ga, sa_id_hash, auth_method, plan_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        enc.encrypt(fullName.trim()),
        enc.encryptGA(fullName.trim()),
        emailEnc, emailGa, emailHash,
        saIdEnc,  saIdGa,  saIdHash,
        authMethod, activePlanId
      ]
    );

    const userId = userResult.lastID;
    const pwHash = await bcrypt.hash(password, 12);
    db.run(
      'INSERT INTO credentials (user_id, password_hash) VALUES (?, ?)',
      [userId, pwHash]
    );

    // Handle MAC address
    let deviceId = null;
    if (macAddress) {
      try {
        const normMac = enc.normaliseMac(macAddress);
        const macHash = enc.hashMac(normMac);
        const blocked = db.queryOne(
          'SELECT is_blocked FROM devices WHERE mac_hash = ?', [macHash]
        );
        if (blocked?.is_blocked) {
          return res.status(403).json({ error: 'This device is blocked.' });
        }
        deviceId = upsertDevice(macHash, normMac, userId);
      } catch (_) {}
    }

    const { token, plan, expiresAt } = createSession(userId, activePlanId, deviceId, req.ip);

    logEvent(userId, 'connect', { method: authMethod }, req.ip);

    return res.status(201).json({
      message      : 'Account created. You are now connected.',
      sessionToken : token,
      accessToken  : issueToken({ sub: userId, role: 'user' }),
      expiresAt,
      plan: {
        name          : plan.name,
        durationHours : plan.duration_hours,
        dataMb        : plan.data_limit_mb
      }
    });

  } catch (err) {
    console.error('[POST /register]', err);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ================================================================
// POST /api/auth/login
// ================================================================
router.post('/login', async (req, res) => {
  try {
    const { authMethod, email, saId, password, macAddress } = req.body;

    let user = null;

    if (authMethod === 'email') {
      user = db.queryOne(
        'SELECT * FROM users WHERE email_hash = ?',
        [enc.hashLookup(email)]
      );
    } else if (authMethod === 'sa_id') {
      user = db.queryOne(
        'SELECT * FROM users WHERE sa_id_hash = ?',
        [enc.hashLookup(saId)]
      );
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    if (user.status === 'blocked') {
      return res.status(403).json({ error: 'Your account has been blocked.' });
    }

    const cred = db.queryOne(
      'SELECT password_hash FROM credentials WHERE user_id = ?', [user.id]
    );
    const pwOk = cred && await bcrypt.compare(password, cred.password_hash);
    if (!pwOk) {
      logEvent(user.id, 'failed_auth', { method: authMethod }, req.ip);
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    let deviceId = null;
    if (macAddress) {
      try {
        const normMac = enc.normaliseMac(macAddress);
        const macHash = enc.hashMac(normMac);
        const blocked = db.queryOne(
          'SELECT is_blocked FROM devices WHERE mac_hash = ?', [macHash]
        );
        if (blocked?.is_blocked) {
          return res.status(403).json({ error: 'This device is blocked.' });
        }
        deviceId = upsertDevice(macHash, normMac, user.id);
      } catch (_) {}
    }

    const planId = user.plan_id || 3;
    const { token, plan, expiresAt } = createSession(user.id, planId, deviceId, req.ip);

    logEvent(user.id, 'connect', { method: authMethod }, req.ip);

    return res.json({
      message      : 'Signed in successfully.',
      sessionToken : token,
      accessToken  : issueToken({ sub: user.id, role: 'user' }),
      expiresAt,
      plan: {
        name          : plan.name,
        durationHours : plan.duration_hours,
        dataMb        : plan.data_limit_mb
      }
    });

  } catch (err) {
    console.error('[POST /login]', err);
    return res.status(500).json({ error: 'Login failed.' });
  }
});

// ================================================================
// POST /api/auth/otp/request
// ================================================================
router.post('/otp/request', async (req, res) => {
  try {
    const { phone, dialCode } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number is required.' });

    const fullPhone = (dialCode || '+27') + phone.replace(/\D/g, '');
    const phoneHash = enc.hashLookup(fullPhone);
    const code      = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash  = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 300_000).toISOString();

    db.run('UPDATE otp_codes SET used = 1 WHERE phone_hash = ?', [phoneHash]);
    db.run(
      'INSERT INTO otp_codes (phone_hash, code_hash, expires_at) VALUES (?, ?, ?)',
      [phoneHash, codeHash, expiresAt]
    );

    console.log(`[OTP] Code for ${phone}: ${code}`);

    return res.json({
      message   : 'OTP sent.',
      expiresAt,
      _devCode  : code
    });

  } catch (err) {
    console.error('[POST /otp/request]', err);
    return res.status(500).json({ error: 'Could not send OTP.' });
  }
});

// ================================================================
// POST /api/auth/otp/verify
// ================================================================
router.post('/otp/verify', async (req, res) => {
  try {
    const { phone, dialCode, code, macAddress, planId } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ error: 'Phone and code are required.' });
    }

    const fullPhone = (dialCode || '+27') + phone.replace(/\D/g, '');
    const phoneHash = enc.hashLookup(fullPhone);

    const otpRow = db.queryOne(
      `SELECT * FROM otp_codes
       WHERE phone_hash = ? AND used = 0 AND expires_at > datetime('now')
       ORDER BY created_at DESC LIMIT 1`,
      [phoneHash]
    );

    if (!otpRow) {
      return res.status(400).json({ error: 'No valid OTP found. Request a new one.' });
    }

    const codeOk = await bcrypt.compare(code, otpRow.code_hash);
    if (!codeOk) {
      return res.status(401).json({ error: 'Incorrect OTP.' });
    }

    db.run('UPDATE otp_codes SET used = 1 WHERE id = ?', [otpRow.id]);

    let user = db.queryOne('SELECT * FROM users WHERE phone_hash = ?', [phoneHash]);
    if (!user) {
      const r = db.run(
        `INSERT INTO users (phone_enc, phone_ga, phone_hash, auth_method, plan_id)
         VALUES (?, ?, ?, 'phone', ?)`,
        [enc.encrypt(fullPhone), enc.encryptGA(fullPhone), phoneHash, planId || 3]
      );
      user = db.queryOne('SELECT * FROM users WHERE id = ?', [r.lastID]);
    }

    let deviceId = null;
    if (macAddress) {
      try {
        const normMac = enc.normaliseMac(macAddress);
        const macHash = enc.hashMac(normMac);
        deviceId = upsertDevice(macHash, normMac, user.id);
      } catch (_) {}
    }

    const activePlanId = planId || user.plan_id || 3;
    const { token, plan, expiresAt } = createSession(user.id, activePlanId, deviceId, req.ip);

    logEvent(user.id, 'otp_verified', { method: 'phone' }, req.ip);

    return res.json({
      message      : 'OTP verified. You are now connected.',
      sessionToken : token,
      accessToken  : issueToken({ sub: user.id, role: 'user' }),
      expiresAt,
      plan: {
        name          : plan.name,
        durationHours : plan.duration_hours,
        dataMb        : plan.data_limit_mb
      }
    });

  } catch (err) {
    console.error('[POST /otp/verify]', err);
    return res.status(500).json({ error: 'OTP verification failed.' });
  }
});

// ================================================================
// POST /api/auth/admin/login
// ================================================================
router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const usernameHash = enc.hashLookup(username);
    const admin = db.queryOne(
      'SELECT * FROM admins WHERE username_hash = ? AND is_active = 1',
      [usernameHash]
    );

    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const pwOk = await bcrypt.compare(password, admin.password_hash);
    if (!pwOk) {
      logEvent(null, 'failed_auth', { method: 'admin', username }, req.ip);
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    db.run(
      'UPDATE admins SET last_login_at = datetime("now") WHERE id = ?',
      [admin.id]
    );

    logEvent(null, 'admin_login', { adminId: admin.id }, req.ip);

    return res.json({
      message     : 'Admin authenticated.',
      accessToken : issueToken({ sub: admin.id, role: admin.role }),
      role        : admin.role
    });

  } catch (err) {
    console.error('[POST /admin/login]', err);
    return res.status(500).json({ error: 'Admin login failed.' });
  }
});

// ================================================================
// GET /api/auth/session
// ================================================================
router.get('/session', (req, res) => {
  try {
    const token = req.headers['x-session-token'] || req.query.token;
    if (!token) return res.status(400).json({ error: 'Session token required.' });

    const session = db.queryOne(
      `SELECT s.*, p.name as plan_name, p.duration_hours
       FROM sessions s
       LEFT JOIN plans p ON s.plan_id = p.id
       WHERE s.session_token = ?`,
      [token]
    );

    if (!session) return res.status(404).json({ error: 'Session not found.' });

    const now = new Date();

    // Check if the period has reset
    if (session.status === 'active' && new Date(session.period_end) <= now) {
      const newEnd = new Date(
        Date.now() + session.duration_hours * 3_600_000
      ).toISOString();

      db.run(
        `UPDATE sessions
         SET data_used_mb = 0,
             period_start  = datetime('now'),
             period_end    = ?,
             period_number = period_number + 1
         WHERE session_token = ?`,
        [newEnd, token]
      );

      logEvent(session.user_id, 'period_reset', {}, null);

      return res.json({
        status          : 'active',
        periodReset     : true,
        dataUsedMb      : 0,
        dataLimitMb     : session.data_limit_mb,
        dataRemainingMb : session.data_limit_mb,
        periodEnd       : newEnd,
        expiresAt       : session.expires_at,
        periodNumber    : (session.period_number || 1) + 1,
        planName        : session.plan_name
      });
    }

    // Check if data is exhausted
    if (session.status === 'active' &&
        session.data_used_mb >= session.data_limit_mb) {
      db.run(
        `UPDATE sessions SET status = 'data_exhausted' WHERE session_token = ?`,
        [token]
      );
      logEvent(session.user_id, 'data_exhausted', {}, null);
    }

    return res.json({
      status          : session.status,
      dataUsedMb      : session.data_used_mb,
      dataLimitMb     : session.data_limit_mb,
      dataRemainingMb : Math.max(0, session.data_limit_mb - session.data_used_mb),
      periodEnd       : session.period_end,
      expiresAt       : session.expires_at,
      periodNumber    : session.period_number,
      planName        : session.plan_name
    });

  } catch (err) {
    console.error('[GET /session]', err);
    return res.status(500).json({ error: 'Session check failed.' });
  }
});

// ================================================================
// POST /api/auth/logout
// ================================================================
router.post('/logout', (req, res) => {
  try {
    const { sessionToken } = req.body;
    if (sessionToken) {
      db.run(
        `UPDATE sessions SET status = 'disconnected' WHERE session_token = ?`,
        [sessionToken]
      );
    }
    return res.json({ message: 'Logged out.' });
  } catch (err) {
    return res.status(500).json({ error: 'Logout failed.' });
  }
});

module.exports = router;
