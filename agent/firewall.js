'use strict';

const { exec } = require('child_process');
const config = require('./config');

/**
 * Run a shell command with sudo on Linux.
 * Returns stdout or throws on error.
 */
function run(cmd) {
  return new Promise((resolve, reject) => {
    const full = config.IS_LINUX ? `sudo ${cmd}` : cmd;
    exec(full, { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

// ===================================== Linux iptables =====================================

/**
 * Set up base iptables rules on Linux.
 * - Enables IP forwarding
 * - Sets up NAT so devices on the hotspot reach the internet
 * - Default policy: DROP all forwarded traffic
 * - Allowed devices are added as ACCEPT rules
 */
async function setupLinux() {
  try {
    // Enable IP forwarding
    await run('sysctl -w net.ipv4.ip_forward=1');

    // Flush existing ETS rules (clean slate)
    await run('iptables -F FORWARD').catch(() => { });
    await run('iptables -t nat -F POSTROUTING').catch(() => { });

    // NAT — masquerade all traffic leaving through upstream interface
    await run(
      `iptables -t nat -A POSTROUTING -o ${config.UPSTREAM_IFACE} -j MASQUERADE`
    );

    // Default: DROP all forwarded traffic
    // Devices must be explicitly allowed
    await run('iptables -P FORWARD DROP');

    // Allow established/related connections (needed for return traffic)
    await run(
      'iptables -A FORWARD -m state --state ESTABLISHED,RELATED -j ACCEPT'
    );

    // Allow DNS and DHCP through (so devices can get IPs and resolve domains)
    await run('iptables -A INPUT -p udp --dport 53  -j ACCEPT');
    await run('iptables -A INPUT -p tcp --dport 53  -j ACCEPT');
    await run('iptables -A INPUT -p udp --dport 67  -j ACCEPT');

    // Allow access to the captive portal (port 5000) for all devices
    await run('iptables -A INPUT -p tcp --dport 5000 -j ACCEPT');

    // Redirect all HTTP traffic from unknown devices to the portal
    await run(
      `iptables -t nat -A PREROUTING -p tcp --dport 80 -j DNAT ` +
      `--to-destination ${config.GATEWAY_IP}:5000`
    );
    await run(
      `iptables -t nat -A PREROUTING -p tcp --dport 443 -j DNAT ` +
      `--to-destination ${config.GATEWAY_IP}:5000`
    );

    console.log('[Firewall] Linux iptables rules applied.');
  } catch (err) {
    console.error('[Firewall] Setup failed:', err.message);
    throw err;
  }
}

/**
 * Allow a specific IP through the firewall (Linux).
 */
async function allowIPLinux(ip) {
  try {
    // Remove any existing block rule for this IP first
    await run(
      `iptables -D FORWARD -s ${ip} -j DROP`
    ).catch(() => { });

    // Add allow rule
    await run(
      `iptables -I FORWARD 1 -s ${ip} -j ACCEPT`
    );

    // Remove portal redirect for this IP
    await run(
      `iptables -t nat -D PREROUTING -s ${ip} -p tcp --dport 80 -j DNAT ` +
      `--to-destination ${config.GATEWAY_IP}:5000`
    ).catch(() => { });

    console.log(`[Firewall] Allowed: ${ip}`);
  } catch (err) {
    console.error(`[Firewall] Allow failed for ${ip}:`, err.message);
  }
}

/**
 * Block a specific IP (Linux).
 */
async function blockIPLinux(ip) {
  try {
    // Remove allow rule if present
    await run(
      `iptables -D FORWARD -s ${ip} -j ACCEPT`
    ).catch(() => { });

    // Add block rule
    await run(
      `iptables -I FORWARD 1 -s ${ip} -j DROP`
    );

    console.log(`[Firewall] Blocked: ${ip}`);
  } catch (err) {
    console.error(`[Firewall] Block failed for ${ip}:`, err.message);
  }
}

// ===================================== Windows netsh =====================================

async function setupWindows() {
  try {
    // Enable IP routing
    await run(
      'reg add HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters ' +
      '/v IPEnableRouter /t REG_DWORD /d 1 /f'
    );
    console.log('[Firewall] Windows routing enabled.');
  } catch (err) {
    console.error('[Firewall] Windows setup failed:', err.message);
  }
}

async function allowIPWindows(ip) {
  try {
    // Remove existing block rule
    await run(
      `netsh advfirewall firewall delete rule name="ETS-BLOCK-${ip}"`
    ).catch(() => { });

    // Add allow rule
    await run(
      `netsh advfirewall firewall add rule name="ETS-ALLOW-${ip}" ` +
      `protocol=ANY dir=in action=allow remoteip=${ip}`
    );
    console.log(`[Firewall] Windows allowed: ${ip}`);
  } catch (err) {
    console.error(`[Firewall] Windows allow failed for ${ip}:`, err.message);
  }
}

async function blockIPWindows(ip) {
  try {
    // Remove existing allow rule
    await run(
      `netsh advfirewall firewall delete rule name="ETS-ALLOW-${ip}"`
    ).catch(() => { });

    // Add block rule
    await run(
      `netsh advfirewall firewall add rule name="ETS-BLOCK-${ip}" ` +
      `protocol=ANY dir=in action=block remoteip=${ip}`
    );
    console.log(`[Firewall] Windows blocked: ${ip}`);
  } catch (err) {
    console.error(`[Firewall] Windows block failed for ${ip}:`, err.message);
  }
}

// ===================================== Cleanup =====================================

/**
 * Remove all ETS firewall rules on shutdown.
 */
async function cleanup() {
  try {
    if (config.IS_LINUX) {
      await run('iptables -F FORWARD').catch(() => { });
      await run('iptables -t nat -F POSTROUTING').catch(() => { });
      await run('iptables -t nat -F PREROUTING').catch(() => { });
      await run('iptables -P FORWARD ACCEPT').catch(() => { });
      console.log('[Firewall] Linux iptables cleaned up.');
    } else {
      await run(
        'netsh advfirewall firewall delete rule name=all ' +
        'remoteip=192.168.100.0/24'
      ).catch(() => { });
      console.log('[Firewall] Windows firewall rules cleaned up.');
    }
  } catch (err) {
    console.error('[Firewall] Cleanup error:', err.message);
  }
}

// ===================================== Public API =====================================

async function setup() {
  if (config.IS_LINUX) return setupLinux();
  if (config.IS_WINDOWS) return setupWindows();
}

async function allowIP(ip) {
  if (config.IS_LINUX) return allowIPLinux(ip);
  if (config.IS_WINDOWS) return allowIPWindows(ip);
}

async function blockIP(ip) {
  if (config.IS_LINUX) return blockIPLinux(ip);
  if (config.IS_WINDOWS) return blockIPWindows(ip);
}

module.exports = { setup, allowIP, blockIP, cleanup };
