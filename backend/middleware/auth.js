'use strict';

const jwt = require('jsonwebtoken');
require('dotenv').config();

// Verify the Bearer token in the Authorization header
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No token provided.' });
  }

  try {
    req.token = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError'
      ? 'Token expired. Please log in again.'
      : 'Invalid token.';
    return res.status(401).json({ error: msg });
  }
}

// Allow only admin or grand_admin
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!['admin', 'grand_admin'].includes(req.token?.role)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
  });
}

// Allow only grand_admin
function requireGrandAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.token?.role !== 'grand_admin') {
      return res.status(403).json({ error: 'Grand Admin access required.' });
    }
    next();
  });
}

module.exports = { requireAuth, requireAdmin, requireGrandAdmin };
