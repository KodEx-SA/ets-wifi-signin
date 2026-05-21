'use strict';

const crypto = require('crypto');
require('dotenv').config();

const ALGO     = 'aes-256-gcm';
const IV_BYTES = 12;

// Load a key from .env and convert it from hex to bytes
function loadKey(envVar) {
  const hex = process.env[envVar];
  if (!hex || hex.length !== 64) {
    throw new Error(`${envVar} must be a 64-character hex string in your .env file`);
  }
  return Buffer.from(hex, 'hex');
}

// Encrypt any string value
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const key    = loadKey('ENCRYPTION_KEY');
  const iv     = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct     = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

// Decrypt a value encrypted with encrypt()
function decrypt(payload) {
  if (!payload) return null;
  const key            = loadKey('ENCRYPTION_KEY');
  const [ivH, tagH, ctH] = payload.split(':');
  const decipher       = crypto.createDecipheriv(ALGO, key, Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ctH, 'hex')), decipher.final()]).toString('utf8');
}

// Grand Admin versions — use the separate GA key
function encryptGA(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const key    = loadKey('GRAND_ADMIN_KEY');
  const iv     = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct     = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

function decryptGA(payload) {
  if (!payload) return null;
  const key            = loadKey('GRAND_ADMIN_KEY');
  const [ivH, tagH, ctH] = payload.split(':');
  const decipher       = crypto.createDecipheriv(ALGO, key, Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ctH, 'hex')), decipher.final()]).toString('utf8');
}

// Hash — used for searching encrypted fields without exposing the value
function hashLookup(value) {
  if (!value) return null;
  return crypto
    .createHmac('sha256', loadKey('ENCRYPTION_KEY'))
    .update(String(value).toLowerCase().trim())
    .digest('hex');
}

// Normalise and hash a MAC address
function normaliseMac(mac) {
  const clean = mac.replace(/[^a-fA-F0-9]/g, '');
  if (clean.length !== 12) throw new Error('Invalid MAC address');
  return clean.match(/.{2}/g).join(':').toUpperCase();
}

function hashMac(mac) {
  return hashLookup(normaliseMac(mac));
}

module.exports = { encrypt, decrypt, encryptGA, decryptGA, hashLookup, normaliseMac, hashMac };
