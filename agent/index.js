'use strict';

const config  = require('./config');
const scanner = require('./scanner');
const firewall= require('./firewall');
const monitor = require('./monitor');
const api     = require('./api');

console.log(`
╔══════════════════════════════════════════╗
║         ETS WiFi Network Agent           ║
║         Eullafied Tech Solutions         ║
╚══════════════════════════════════════════╝
`);
console.log(`[Agent] Platform : ${config.IS_LINUX ? 'Linux' : 'Windows'}`);
console.log(`[Agent] Interface: ${config.UPSTREAM_IFACE}`);
console.log(`[Agent] Backend  : ${config.BACKEND_URL}`);
console.log(`[Agent] Starting...`);

// Track session tokens per device MAC
// mac → { sessionToken, allowed }
const deviceSessions = new Map();

// ── Main scan loop ────────────────────────────────────────────
// Runs every SCAN_INTERVAL_MS
// Discovers devices, checks auth, applies firewall rules

async function scanLoop() {
  try {
    const devices = await scanner.scan();

    for (const device of devices) {
      const { mac, ip } = device;

      // Register device with backend if new
      await api.registerDevice(mac, ip, {
        os: 'Unknown',
      });

      // Register with monitor for data tracking
      await monitor.registerDevice(ip);

      // Check if device is authenticated
      const status = await api.checkDevice(mac, ip);

      const wasAllowed = deviceSessions.get(mac)?.allowed ?? null;

      if (status.allowed) {
        // Device is authenticated — allow internet
        deviceSessions.set(mac, {
          sessionToken: status.sessionToken,
          allowed     : true,
        });

        // Only apply firewall rule if state changed
        if (wasAllowed !== true) {
          await firewall.allowIP(ip);
          await api.logEvent('connect', mac, ip, {
            plan: status.planName,
          });
          console.log(`[Agent] ✅ Allowed: ${mac} (${ip}) — ${status.planName}`);
        }

      } else {
        // Device is not authenticated — block internet
        deviceSessions.set(mac, {
          sessionToken: null,
          allowed     : false,
          reason      : status.reason,
        });

        // Only apply firewall rule if state changed
        if (wasAllowed !== false) {
          await firewall.blockIP(ip);

          if (status.reason !== 'unknown_device') {
            await api.logEvent('blocked', mac, ip, {
              reason: status.reason,
            });
          }

          console.log(
            `[Agent] 🚫 Blocked: ${mac} (${ip}) — ${status.reason}`
          );
        }
      }
    }

  } catch (err) {
    console.error('[Agent] Scan loop error:', err.message);
  }
}

// ── Data stats loop ───────────────────────────────────────────
// Runs every STATS_INTERVAL_MS
// Reports data usage per device to the backend

async function statsLoop() {
  try {
    // Report interface-level stats
    const ifaceStats = await monitor.getInterfaceSummary();
    await api.reportInterfaceStats(ifaceStats);

    // Report per-device data usage
    const devices = scanner.getAllDevices();
    for (const device of devices) {
      const session = deviceSessions.get(device.mac);
      if (!session?.sessionToken) continue;

      const delta = await monitor.getDeltaForDevice(device.ip);
      if (delta.totalMb < 0.001) continue;  // skip if negligible

      const result = await api.reportDataUsage(
        session.sessionToken,
        delta.totalMb
      );

      if (result.status === 'data_exhausted') {
        console.log(`[Agent] 📵 Data exhausted: ${device.mac}`);
        await firewall.blockIP(device.ip);
        deviceSessions.set(device.mac, {
          ...session,
          allowed: false,
          reason : 'data_exhausted',
        });
        await api.logEvent('data_exhausted', device.mac, device.ip, {
          totalMb: delta.totalMb,
        });
      } else {
        console.log(
          `[Agent] 📊 ${device.mac} used ${delta.totalMb.toFixed(3)} MB`
        );
      }
    }

  } catch (err) {
    console.error('[Agent] Stats loop error:', err.message);
  }
}

// ── Startup ───────────────────────────────────────────────────

async function start() {
  // Verify backend is reachable before starting
  const backendOk = await api.ping();
  if (!backendOk) {
    console.error('[Agent] ❌ Backend is not reachable at', config.BACKEND_URL);
    console.error('[Agent] Start the backend first: cd backend && npm start');
    process.exit(1);
  }
  console.log('[Agent] ✅ Backend connected.');

  // Set up firewall rules
  try {
    await firewall.setup();
    console.log('[Agent] ✅ Firewall configured.');
  } catch (err) {
    console.error('[Agent] ❌ Firewall setup failed:', err.message);
    console.error('[Agent] Make sure you are running with sudo.');
    process.exit(1);
  }

  // Run first scan immediately
  await scanLoop();

  // Start scan loop
  setInterval(scanLoop, config.SCAN_INTERVAL_MS);
  console.log(
    `[Agent] 🔍 Scanning every ${config.SCAN_INTERVAL_MS / 1000}s`
  );

  // Start stats loop
  setInterval(statsLoop, config.STATS_INTERVAL_MS);
  console.log(
    `[Agent] 📊 Reporting stats every ${config.STATS_INTERVAL_MS / 1000}s`
  );

  console.log('[Agent] 🚀 Running. Press Ctrl+C to stop.\n');
}

// ── Shutdown ──────────────────────────────────────────────────

async function shutdown(signal) {
  console.log(`\n[Agent] ${signal} received. Shutting down...`);

  // Log all currently connected devices as disconnected
  const devices = scanner.getAllDevices();
  for (const device of devices) {
    const session = deviceSessions.get(device.mac);
    if (session?.allowed) {
      await api.logEvent('disconnect', device.mac, device.ip, {
        reason: 'agent_shutdown',
      });
    }
  }

  // Clean up firewall rules
  await firewall.cleanup();

  console.log('[Agent] Goodbye.');
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── Start ─────────────────────────────────────────────────────
start();
