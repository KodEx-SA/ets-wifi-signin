'use strict';

const { exec } = require('child_process');
const config = require('./config');

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 5000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

// ===================================== Per device traffic store =====================================
// Keyed by MAC address (permanent) not IP (changes)
// mac { rx, tx, timestamp, ip }
const deviceStats = new Map();

/**
 * Parse iptables byte notation e.g. "1K" "2M" "500" into raw bytes.
 */
function parseBytes(str) {
  if (!str) return 0;
  const num = parseFloat(str);
  if (str.endsWith('K')) return Math.round(num * 1_024);
  if (str.endsWith('M')) return Math.round(num * 1_024 * 1_024);
  if (str.endsWith('G')) return Math.round(num * 1_024 * 1_024 * 1_024);
  return Math.round(num) || 0;
}

/**
 * Get real interface RX/TX byte counts from the OS.
 * Linux: reads /sys/class/net/<iface>/statistics/
 * Windows: uses netstat -e
 */
async function getInterfaceBytesLinux(iface) {
  try {
    const rx = await run(`cat /sys/class/net/${iface}/statistics/rx_bytes`);
    const tx = await run(`cat /sys/class/net/${iface}/statistics/tx_bytes`);
    return {
      rx: parseInt(rx, 10) || 0,
      tx: parseInt(tx, 10) || 0,
    };
  } catch {
    return { rx: 0, tx: 0 };
  }
}

async function getInterfaceBytesWindows() {
  try {
    const out = await run('netstat -e');
    for (const line of out.split('\n')) {
      if (line.includes('Bytes')) {
        const parts = line.trim().split(/\s+/);
        return {
          rx: parseInt(parts[1], 10) || 0,
          tx: parseInt(parts[2], 10) || 0,
        };
      }
    }
    return { rx: 0, tx: 0 };
  } catch {
    return { rx: 0, tx: 0 };
  }
}

/**
 * Register a device for tracking by MAC address.
 * Called whenever the scanner finds a device.
 *
 * @param {string} mac - normalised MAC e.g. AA:BB:CC:DD:EE:FF
 * @param {string} ip  - current IP (stored but not used as key)
 */
async function registerDevice(mac, ip) {
  const normMac = mac.toUpperCase();

  if (deviceStats.has(normMac)) {
    // Device already tracked - just update its current IP
    const existing = deviceStats.get(normMac);
    if (existing.ip !== ip) {
      console.log(
        `[Monitor] IP changed for ${normMac}: ${existing.ip} → ${ip}`
      );
      existing.ip = ip;
    }
    return;
  }

  // New device - read initial byte counts
  const iface = config.IS_LINUX ? config.UPSTREAM_IFACE : config.AP_IFACE;
  const bytes = config.IS_LINUX
    ? await getInterfaceBytesLinux(iface)
    : await getInterfaceBytesWindows();

  deviceStats.set(normMac, {
    mac,
    ip,
    rx: bytes.rx,
    tx: bytes.tx,
    timestamp: Date.now(),
    usedMb: 0, // cumulative MB used this session
  });

  console.log(`[Monitor] Now tracking: ${normMac} (${ip})`); // Log new devices for visibility
}

/**
 * Stop tracking a device (on disconnect or logout).
 */
function unregisterDevice(mac) {
  const normMac = mac.toUpperCase();
  if (deviceStats.has(normMac)) {
    deviceStats.delete(normMac);
    console.log(`[Monitor] Stopped tracking: ${normMac}`);
  }
}

/**
 * Calculate how much data a device has used since the last check.
 * Uses interface-level counters divided by number of tracked devices.
 * Returns { rxDelta, txDelta, totalMb }
 *
 * Note: For accurate per-device stats in production, use
 * iptables byte counters per IP rule. This method approximates
 * by splitting interface traffic across all active devices.
 */
async function getDeltaForDevice(mac) {
  const normMac = mac.toUpperCase();
  const record = deviceStats.get(normMac);
  if (!record) return { rxDelta: 0, txDelta: 0, totalMb: 0 };

  const iface = config.IS_LINUX ? config.UPSTREAM_IFACE : config.AP_IFACE;
  const current = config.IS_LINUX
    ? await getInterfaceBytesLinux(iface)
    : await getInterfaceBytesWindows();

  // Split interface traffic across all tracked devices
  const deviceCount = Math.max(1, deviceStats.size);
  const rxDelta = Math.max(0, current.rx - record.rx) / deviceCount;
  const txDelta = Math.max(0, current.tx - record.tx) / deviceCount;
  const totalMb = (rxDelta + txDelta) / (1024 * 1024);

  // Update stored counts
  record.rx = current.rx;
  record.tx = current.tx;
  record.timestamp = Date.now();
  record.usedMb += totalMb;

  return { rxDelta, txDelta, totalMb };
}

/**
 * Get a summary of interface-level stats for the dashboard.
 */
async function getInterfaceSummary() {
  const iface = config.IS_LINUX ? config.UPSTREAM_IFACE : config.AP_IFACE;
  const stats = config.IS_LINUX
    ? await getInterfaceBytesLinux(iface)
    : await getInterfaceBytesWindows();

  return {
    interface: iface,
    rxMb: (stats.rx / (1024 * 1024)).toFixed(2),
    txMb: (stats.tx / (1024 * 1024)).toFixed(2),
    totalMb: ((stats.rx + stats.tx) / (1024 * 1024)).toFixed(2),
    devices: deviceStats.size,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get the current stats for all tracked devices.
 * Used by the admin dashboard.
 */
function getAllDeviceStats() {
  return Array.from(deviceStats.values()).map(d => ({
    mac: d.mac,
    ip: d.ip,
    usedMb: d.usedMb.toFixed(3),
  }));
}

module.exports = {
  registerDevice,
  unregisterDevice,
  getDeltaForDevice,
  getInterfaceSummary,
  getAllDeviceStats,
  parseBytes,
};