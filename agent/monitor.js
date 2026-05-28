'use strict';

const { exec } = require('child_process');
const config = require('./config');

/**
 * Run a shell command and return stdout.
 */
function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 5000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

// ── Per-device traffic tracking ───────────────────────────────

// Stores last-seen byte counts per IP
// ip → { rx: bytes, tx: bytes, timestamp: ms }
const lastStats = new Map();

/**
 * Read traffic stats for a specific IP using iptables counters.
 * iptables can count bytes per rule — we use this to track per device.
 */
async function getDeviceStatsLinux(ip) {
  try {
    // Check if a counting rule exists for this IP
    const out = await run(
      `sudo iptables -L FORWARD -v -n | grep " ${ip} "`
    );

    let rxBytes = 0;
    let txBytes = 0;

    for (const line of out.split('\n')) {
      const parts = line.trim().split(/\s+/);
      // iptables -L -v output: pkts bytes target prot opt in out source dest
      if (parts.length < 9) continue;

      const bytes = parseBytes(parts[1]);
      const source = parts[7];
      const dest = parts[8];

      if (source === ip) txBytes += bytes;  // device sending
      if (dest === ip) rxBytes += bytes;  // device receiving
    }

    return { rx: rxBytes, tx: txBytes };
  } catch {
    return { rx: 0, tx: 0 };
  }
}

/**
 * Parse iptables byte notation e.g. "1K" "2M" "500" into raw bytes.
 */
function parseBytes(str) {
  if (!str) return 0;
  const num = parseFloat(str);
  if (str.endsWith('K')) return Math.round(num * 1024);
  if (str.endsWith('M')) return Math.round(num * 1024 * 1024);
  if (str.endsWith('G')) return Math.round(num * 1024 * 1024 * 1024);
  return Math.round(num) || 0;
}

/**
 * Ensure iptables has counting rules for a device IP.
 * Called when a new device is discovered.
 */
async function addCountingRulesLinux(ip) {
  try {
    // Add rules that count traffic — these don't block or allow,
    // they just count bytes passing through for this IP
    await run(
      `sudo iptables -I FORWARD 1 -s ${ip} -j RETURN`
    ).catch(() => { });
    await run(
      `sudo iptables -I FORWARD 1 -d ${ip} -j RETURN`
    ).catch(() => { });
  } catch { }
}

/**
 * Get total interface stats on Linux.
 * Returns { rx, tx } in bytes for a given interface.
 */
async function getInterfaceStatsLinux(iface) {
  try {
    const rx = await run(`cat /sys/class/net/${iface}/statistics/rx_bytes`);
    const tx = await run(`cat /sys/class/net/${iface}/statistics/tx_bytes`);
    return { rx: parseInt(rx, 10) || 0, tx: parseInt(tx, 10) || 0 };
  } catch {
    return { rx: 0, tx: 0 };
  }
}

/**
 * Get interface stats on Windows using netstat.
 */
async function getInterfaceStatsWindows(iface) {
  try {
    const out = await run(`netstat -e`);
    const lines = out.split('\n');
    for (const line of lines) {
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
 * Calculate data used by a device since the last check.
 * Returns { rxDelta, txDelta, totalMb } since last call.
 */
async function getDeltaForDevice(ip) {
  const current = config.IS_LINUX
    ? await getDeviceStatsLinux(ip)
    : { rx: 0, tx: 0 };

  const now = Date.now();
  const last = lastStats.get(ip);

  if (!last) {
    lastStats.set(ip, { ...current, timestamp: now });
    return { rxDelta: 0, txDelta: 0, totalMb: 0 };
  }

  const rxDelta = Math.max(0, current.rx - last.rx);
  const txDelta = Math.max(0, current.tx - last.tx);
  const totalBytes = rxDelta + txDelta;
  const totalMb = totalBytes / (1024 * 1024);

  lastStats.set(ip, { ...current, timestamp: now });

  return { rxDelta, txDelta, totalMb };
}

/**
 * Get a summary of all interface stats.
 * Used for the overview dashboard.
 */
async function getInterfaceSummary() {
  const iface = config.IS_LINUX
    ? config.UPSTREAM_IFACE
    : config.AP_IFACE;

  const stats = config.IS_LINUX
    ? await getInterfaceStatsLinux(iface)
    : await getInterfaceStatsWindows(iface);

  return {
    interface: iface,
    rxMb: (stats.rx / (1024 * 1024)).toFixed(2),
    txMb: (stats.tx / (1024 * 1024)).toFixed(2),
    totalMb: ((stats.rx + stats.tx) / (1024 * 1024)).toFixed(2),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Register a new device for traffic counting.
 * Called by the scanner when a new device is found.
 */
async function registerDevice(ip) {
  if (config.IS_LINUX) {
    await addCountingRulesLinux(ip);
  }
  if (!lastStats.has(ip)) {
    lastStats.set(ip, { rx: 0, tx: 0, timestamp: Date.now() });
  }
  if (!lastStats.has(ip)) { // Only log if it's a new device
    console.log(`[Monitor] Tracking device: ${ip}`);
  }
  // console.log(`[Monitor] Tracking device: ${ip}`);
}

/**
 * Stop tracking a device.
 */
function unregisterDevice(ip) {
  lastStats.delete(ip);
}

module.exports = {
  registerDevice,
  unregisterDevice,
  getDeltaForDevice,
  getInterfaceSummary,
  parseBytes,
};
