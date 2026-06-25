'use strict';

const { exec } = require('child_process');
const fs = require('fs');
const config = require('./config');

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 8000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

/**
 * Detect the current WiFi channel of the upstream interface.
 * Returns the channel number as an integer.
 */
async function detectChannel() {
  try {
    const out = await run(
      `iwlist ${config.UPSTREAM_IFACE} channel 2>/dev/null | grep Current`
    );
    // Output: "Current Frequency:2.447 GHz (Channel 8)"
    const match = out.match(/Channel\s+(\d+)/i);
    if (match) {
      const ch = parseInt(match[1], 10);
      console.log(`[Hotspot] Detected upstream channel: ${ch}`);
      return ch;
    }
  } catch { }
  console.log('[Hotspot] Could not detect channel, defaulting to 6');
  return 6;
}

/**
 * Write the hostapd config file with the correct channel.
 */
async function writeHostapdConfig(channel) {
  const conf = `interface=ap0
driver=nl80211
ssid=${config.HOTSPOT_SSID}
hw_mode=g
channel=${channel}
wmm_enabled=0
macaddr_acl=0
auth_algs=1
wpa=2
wpa_passphrase=${config.HOTSPOT_PASSWORD}
wpa_key_mgmt=WPA-PSK
wpa_pairwise=TKIP
rsn_pairwise=CCMP
ignore_broadcast_ssid=0
`;

  fs.writeFileSync('/tmp/ets-hostapd.conf', conf);
  console.log(`[Hotspot] Config written — SSID: ${config.HOTSPOT_SSID}, Channel: ${channel}`);
}

/**
 * Write the dnsmasq config for DHCP.
 */
function writeDnsmasqConfig() {
  const conf = `interface=ap0
dhcp-range=${config.DHCP_RANGE_START},${config.DHCP_RANGE_END},${config.SUBNET_MASK},${config.DHCP_LEASE_TIME}
dhcp-option=3,${config.GATEWAY_IP}
dhcp-option=6,${config.GATEWAY_IP}
address=/#/${config.GATEWAY_IP}
log-dhcp
`;

  fs.writeFileSync('/tmp/ets-dnsmasq.conf', conf);
  console.log('[Hotspot] dnsmasq config written');
}

/**
 * Create and bring up the virtual AP interface.
 */
async function createApInterface() {
  // Remove old ap0 if it exists
  await run(`sudo iw dev ap0 del`).catch(() => { });

  // Create fresh virtual interface
  await run(
    `sudo iw dev ${config.UPSTREAM_IFACE} interface add ap0 type __ap`
  );

  // Assign gateway IP
  await run(`sudo ip addr add ${config.GATEWAY_IP}/24 dev ap0`);

  console.log('[Hotspot] ap0 interface created');
}

let hostapdProc = null;
let dnsmasqProc = null;

/**
 * Start the hotspot — detects channel, writes configs, starts services.
 */
async function start() {
  console.log('[Hotspot] Starting ETS-WiFi hotspot...');

  // Detect channel automatically
  const channel = await detectChannel();

  // Create AP interface
  await createApInterface();

  // Write configs with detected channel
  await writeHostapdConfig(channel);
  writeDnsmasqConfig();

  // Stop any existing instances
  await run('sudo pkill hostapd').catch(() => { });
  await run('sudo pkill dnsmasq').catch(() => { });
  await new Promise(r => setTimeout(r, 1000));

  // Start hostapd
  await new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    hostapdProc = spawn('sudo', ['hostapd', '/tmp/ets-hostapd.conf'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    hostapdProc.stdout.on('data', d => {
      const line = d.toString().trim();
      if (line) console.log('[hostapd]', line);
      if (line.includes('AP-ENABLED')) resolve();
    });

    hostapdProc.stderr.on('data', d => {
      const line = d.toString().trim();
      if (line) console.error('[hostapd ERR]', line);
    });

    hostapdProc.on('error', reject);

    // Timeout after 10 seconds
    setTimeout(() => resolve(), 10000);
  });

  // Start dnsmasq
  await new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    dnsmasqProc = spawn('sudo', [
      'dnsmasq',
      '--conf-file=/tmp/ets-dnsmasq.conf',
      '--no-daemon',
      '--log-facility=/tmp/ets-dnsmasq.log'
    ], { stdio: 'ignore' });

    dnsmasqProc.on('error', reject);
    setTimeout(resolve, 2000);
  });

  console.log(`[Hotspot] ✅ ETS-WiFi is broadcasting on channel ${channel}`);
  console.log(`[Hotspot] Gateway: ${config.GATEWAY_IP}`);
  console.log(`[Hotspot] DHCP: ${config.DHCP_RANGE_START} — ${config.DHCP_RANGE_END}`);
}

/**
 * Stop the hotspot cleanly.
 */
async function stop() {
  console.log('[Hotspot] Stopping...');
  if (hostapdProc) hostapdProc.kill();
  if (dnsmasqProc) dnsmasqProc.kill();
  await run('sudo pkill hostapd').catch(() => { });
  await run('sudo pkill dnsmasq').catch(() => { });
  await run('sudo iw dev ap0 del').catch(() => { });
  console.log('[Hotspot] Stopped.');
}

module.exports = { start, stop, detectChannel };
