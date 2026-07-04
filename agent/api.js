'use strict';

const axios = require('axios');
const config = require('./config');

// Axios instance pointed at the backend
const http = axios.create({
  baseURL: config.BACKEND_URL,
  timeout: 8000,
  headers: {
    'Content-Type': 'application/json',
    'X-Agent-Secret': config.AGENT_SECRET,
  },
});

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

async function logEvent(eventType, mac, ip, detail = {}) {
  try {
    await http.post('/agent/log-event', {
      eventType,
      mac,
      ip,
      detail,
    });
  } catch (err) {
    // Non-critical - log locally if backend unreachable
    console.warn('[API] logEvent failed:', err.message);
  }
}

async function reportInterfaceStats(stats) {
  try {
    await http.post('/agent/interface-stats', stats);
  } catch (err) {
    console.warn('[API] reportInterfaceStats failed:', err.message);
  }
}

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
