'use strict';

const os = require('os');

// Detect operating system
const IS_LINUX = os.platform() === 'linux';
const IS_WINDOWS = os.platform() === 'win32';

module.exports = {

  // ===================================== Operating System =====================================
  IS_LINUX,
  IS_WINDOWS,

  // ===================================== Network Interfaces =====================================
  // The interface connected to the internet (your phone hotspot)
  UPSTREAM_IFACE: IS_LINUX ? 'wlp0s20f3' : 'Wi-Fi',

  // The interface that broadcasts the ETS hotspot to school devices
  // On Linux: a virtual AP created on the same card
  // On Windows: the hosted network adapter
  AP_IFACE: IS_LINUX ? 'ap0' : 'Local Area Connection* 1',

  // ===================================== Hotspot Settings =====================================
  HOTSPOT_SSID: 'ETS-WiFi',
  HOTSPOT_PASSWORD: 'ets12345', // min 8 characters
  HOTSPOT_CHANNEL: 'auto',  // detected automatically at startup

  // ===================================== IP / DHCP Settings =====================================
  // The laptop's IP on the ETS hotspot network
  GATEWAY_IP: '192.168.100.1',
  SUBNET_MASK: '255.255.255.0',

  // IP range handed to connecting school devices
  DHCP_RANGE_START: '192.168.100.10',
  DHCP_RANGE_END: '192.168.100.100',
  DHCP_LEASE_TIME: '12h',

  // ===================================== Backend API =====================================
  BACKEND_URL: 'http://localhost:5000/api',
  AGENT_SECRET: 'ets-agent-secret-2025',  // shared secret with backend

  // ===================================== Timing (milliseconds) =====================================
  SCAN_INTERVAL_MS: 10_000,   // how often to scan for connected devices
  STATS_INTERVAL_MS: 30_000,   // how often to report data usage

  // ===================================== Captive Portal =====================================
  // All HTTP traffic from unknown devices redirects here
  PORTAL_URL: 'http://192.168.100.1:5000/ets-portal.html',

  // ===================================== Logging =====================================
  LOG_FILE: IS_LINUX
    ? '/var/log/ets-agent.log'
    : 'C:\\ETS\\logs\\agent.log',
};
