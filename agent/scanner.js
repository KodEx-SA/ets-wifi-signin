'use strict';

const { exec } = require('child_process');
const config   = require('./config');

/**
 * Parses the ARP table and returns connected devices.
 * Works on both Linux and Windows.
 *
 * Returns an array of:
 * { ip, mac, iface, firstSeen, lastSeen }
 */

// In-memory store of known devices
const knownDevices = new Map();  // mac → device object

/**
 * Run a shell command and return stdout as a string.
 */
function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

/**
 * Read the ARP table on Linux.
 * Returns array of { ip, mac, iface }
 */
async function scanLinux() {
  try {
    const output = await run('ip neigh show');
    const devices = [];

    for (const line of output.split('\n')) {
      // Example line:
      // 192.168.100.10 dev ap0 lladdr aa:bb:cc:dd:ee:ff REACHABLE
      const match = line.match(
        /^(\d+\.\d+\.\d+\.\d+)\s+dev\s+(\S+)\s+lladdr\s+([0-9a-f:]{17})\s+(\S+)/i
      );
      if (!match) continue;

      const [, ip, iface, mac, state] = match;

      // Only include devices on our AP interface
      // or on the upstream interface (for testing before AP is up)
      if (state === 'FAILED') continue;

      devices.push({
        ip   : ip,
        mac  : mac.toUpperCase(),
        iface: iface,
        state: state,
      });
    }

    return devices;
  } catch (err) {
    console.error('[Scanner] Linux ARP scan failed:', err.message);
    return [];
  }
}

/**
 * Read the ARP table on Windows.
 * Returns array of { ip, mac, iface }
 */
async function scanWindows() {
  try {
    const output = await run('arp -a');
    const devices = [];

    for (const line of output.split('\n')) {
      // Example line:
      //   192.168.137.5         aa-bb-cc-dd-ee-ff     dynamic
      const match = line.match(
        /(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f\-]{17})\s+dynamic/i
      );
      if (!match) continue;

      const [, ip, macRaw] = match;
      const mac = macRaw.replace(/-/g, ':').toUpperCase();

      devices.push({ ip, mac, iface: 'hotspot', state: 'REACHABLE' });
    }

    return devices;
  } catch (err) {
    console.error('[Scanner] Windows ARP scan failed:', err.message);
    return [];
  }
}

/**
 * Get the hostname of a device by IP (best effort).
 */
async function getHostname(ip) {
  try {
    const out = await run(
      config.IS_LINUX
        ? `host ${ip} 2>/dev/null | awk '{print $NF}'`
        : `nslookup ${ip} 2>nul`
    );
    return out.split('\n')[0].trim() || null;
  } catch {
    return null;
  }
}

/**
 * Main scan function — called every SCAN_INTERVAL_MS.
 * Returns the current list of connected devices with history.
 */
async function scan() {
  const raw = config.IS_LINUX
    ? await scanLinux()
    : await scanWindows();

  const now = new Date().toISOString();

  for (const device of raw) {
    if (knownDevices.has(device.mac)) {
      // Update existing device
      const existing = knownDevices.get(device.mac);
      existing.ip       = device.ip;
      existing.lastSeen = now;
      existing.state    = device.state;
    } else {
      // New device — add to known list
      knownDevices.set(device.mac, {
        mac      : device.mac,
        ip       : device.ip,
        iface    : device.iface,
        state    : device.state,
        firstSeen: now,
        lastSeen : now,
        allowed  : false,   // blocked until authenticated
        dataUsed : 0,       // bytes used this session
      });

      console.log(`[Scanner] New device: ${device.mac} (${device.ip})`);
    }
  }

  return Array.from(knownDevices.values());
}

/**
 * Get a single device by MAC address.
 */
function getDevice(mac) {
  return knownDevices.get(mac.toUpperCase()) || null;
}

/**
 * Mark a device as allowed (authenticated).
 */
function allowDevice(mac) {
  const device = knownDevices.get(mac.toUpperCase());
  if (device) {
    device.allowed = true;
    console.log(`[Scanner] Device allowed: ${mac}`);
  }
}

/**
 * Mark a device as blocked.
 */
function blockDevice(mac) {
  const device = knownDevices.get(mac.toUpperCase());
  if (device) {
    device.allowed = false;
    console.log(`[Scanner] Device blocked: ${mac}`);
  }
}

/**
 * Get all currently known devices.
 */
function getAllDevices() {
  return Array.from(knownDevices.values());
}

/**
 * Update data usage for a device.
 */
function updateDataUsed(mac, bytes) {
  const device = knownDevices.get(mac.toUpperCase());
  if (device) device.dataUsed += bytes;
}

module.exports = {
  scan,
  getDevice,
  allowDevice,
  blockDevice,
  getAllDevices,
  updateDataUsed,
};
