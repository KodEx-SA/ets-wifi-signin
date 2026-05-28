'use strict';

const axios  = require('axios');
const config = require('./config');

// Axios instance pointed at the backend
const http = axios.create({
  baseURL        : config.BACKEND_URL,
  timeout        : 8000,
  headers        : {
    'Content-Type' : 'application/json',
    'X-Agent-Secret': config.AGENT_SECRET,
  },
});

/**
 * Check if a device is allowed to access the internet.
 * The backend checks the devices table and active sessions.
 *
 * @param {string} mac  - normalised MAC address
 * @param {string} ip   - current IP of the device
 * @returns {object}    - { allowed, sessionToken, userId, planName }
 */
async function checkDevice(mac, ip) {
  try {
    const res = await http.post('/agent/check-device', { mac, ip });
    return res.data;
  } catch (err) {
    // If backend is unreachable, fail closed (block the device)
    console.error('[API] checkDevice failed:', err.message);
    return { allowed: false };
  }
}

/**
 * Report data usage for a device to the backend.
 * The backend updates the session and checks if data is exhausted.
 *
 * @param {string} sessionToken
 * @param {number} usedMb - MB used since last report
 * @returns {object} - { status, dataUsedMb }
 */
async function reportDataUsage(sessionToken, usedMb) {
  try {
    const res = await http.put('/auth/session/data', {
      sessionToken,
      usedMb,
    });
    return res.data;
  } catch (err) {
    console.error('[API] reportDataUsage failed:', err.message);
    return { status: 'error' };
  }
}

/**
 * Register a newly discovered device with the backend.
 * Creates a device record if it doesn't exist.
 *
 * @param {string} mac
 * @param {string} ip
 * @param {object} deviceInfo - { os, hostname }
 */
async function registerDevice(mac, ip, deviceInfo = {}) {
  try {
    const res = await http.post('/agent/register-device', {
      mac,
      ip,
      deviceInfo,
    });
    return res.data;
  } catch (err) {
    console.error('[API] registerDevice failed:', err.message);
    return null;
  }
}

/**
 * Report a network event to the backend audit log.
 *
 * @param {string} eventType - connect|disconnect|blocked|data_exhausted
 * @param {string} mac
 * @param {string} ip
 * @param {object} detail
 */
async function logEvent(eventType, mac, ip, detail = {}) {
  try {
    await http.post('/agent/log-event', {
      eventType,
      mac,
      ip,
      detail,
    });
  } catch (err) {
    // Non-critical — log locally if backend unreachable
    console.warn('[API] logEvent failed:', err.message);
  }
}

/**
 * Report full interface stats to the backend.
 * Used for the dashboard data usage chart.
 *
 * @param {object} stats - { interface, rxMb, txMb, totalMb }
 */
async function reportInterfaceStats(stats) {
  try {
    await http.post('/agent/interface-stats', stats);
  } catch (err) {
    console.warn('[API] reportInterfaceStats failed:', err.message);
  }
}

/**
 * Health check — verify backend is reachable.
 * Returns true if reachable, false otherwise.
 */
async function ping() {
  try {
    const res = await http.get('/health');
    return res.data?.status === 'ok';
  } catch {
    return false;
  }
}

module.exports = {
  checkDevice,
  reportDataUsage,
  registerDevice,
  logEvent,
  reportInterfaceStats,
  ping,
};
