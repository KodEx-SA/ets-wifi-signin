# ETS WiFi Captive Portal System
## Submission Document — Eullafied Tech Solutions
### Submitted by: Ashley Koketso Motsie | June 2026

---

## Project Overview

The ETS WiFi Captive Portal System is a full-stack network access control solution built for Eullafied Tech Solutions. It allows a school lab or office environment to manage WiFi access by requiring users to authenticate before connecting to the internet.

The system consists of three parts:

| Part | Description |
|---|---|
| **Backend API** | Node.js + Express server handling authentication, database, encryption |
| **Frontend** | HTML/CSS/JS portal for users and admin dashboard |
| **Network Agent** | Background process that controls real internet access per device |

---

## What Is Complete ✅

### Backend
- AES-256-GCM field-level encryption on all sensitive data
- SQLite database with full schema (users, sessions, devices, logs, plans)
- JWT authentication (15-minute access tokens)
- Rate limiting on all endpoints
- bcrypt password hashing (cost 12 for users, 14 for admins)
- All API routes: auth, admin, grand admin, agent

### User Portal
- SA ID authentication with Luhn validation, age check, info extraction
- Email registration and login
- Phone OTP (simulated — real SMS via Twilio not yet integrated)
- Guest access
- Google and Microsoft OAuth buttons (backend integration pending)
- Live session widget showing data used, remaining, period reset time
- Connection plan selection
- Light and dark theme toggle
- Fully responsive design

### Admin Dashboard
- Real-time stats (users, sessions, blocked, data used)
- Live charts — data usage bar chart, auth method doughnut chart
- User management — block, unblock, search, filter
- Session management — view active sessions with data usage bars, kick users
- Device management — MAC address registry, block/unblock devices
- Audit logs — full event history (connect, blocked, failed auth, OTP verified, admin login)
- Plans management — view all connection packages
- Grand Admin panel — full decryption view including SA ID numbers

### Grand Admin
- Separate encryption key (GRAND_ADMIN_KEY) independent of main key
- Can decrypt all fields including SA ID numbers
- Can view full MAC addresses
- Hidden nav item — only visible after Grand Admin login
- Separate API endpoints (/api/grand/*)

### Network Agent (Linux)
- Automatic channel detection (no manual configuration needed)
- Virtual AP interface creation (ap0)
- hostapd integration for WiFi hotspot broadcasting
- dnsmasq integration for DHCP and DNS
- Device scanning via ARP table every 10 seconds
- MAC address based device tracking (not IP — IPs change, MACs don't)
- iptables firewall — blocks unauthenticated devices, allows authenticated ones
- Data usage monitoring per device
- Reports to backend API every 30 seconds
- Clean shutdown — removes all firewall rules and stops hotspot

### Security
- All sensitive fields encrypted at rest (email, phone, SA ID, IP addresses, MAC addresses)
- Two encryption key tiers (main key + Grand Admin key)
- HMAC-SHA256 hashing for searchable fields
- Blocked devices rejected even with valid credentials
- Captive portal redirect for unauthenticated devices

---

## What Is Incomplete / Pending ⏳

| Feature | Status | What's Needed |
|---|---|---|
| Real SMS OTP | Pending | Twilio account + API credentials |
| Google OAuth | Pending | Google Cloud project + Client ID |
| Microsoft OAuth | Pending | Azure app registration + Client ID |
| hostapd NetworkManager conflict | Pending | NetworkManager unmanaged config |
| Windows Agent | Pending | Port firewall.js and hotspot.js to netsh/Windows |
| Production HTTPS | Pending | SSL certificate + nginx reverse proxy |

---

## Project Structure

```
ets-signin/
├── backend/
│   ├── db/
│   │   ├── schema.sql          ← Database table definitions
│   │   └── database.js         ← DB connection and query helpers
│   ├── middleware/
│   │   └── auth.js             ← JWT verification middleware
│   ├── routes/
│   │   ├── auth.js             ← User auth (register, login, OTP, session)
│   │   ├── admin.js            ← Admin dashboard API
│   │   ├── grandAdmin.js       ← Grand Admin full-decrypt API
│   │   └── agent.js            ← Network Agent API
│   ├── utils/
│   │   └── encryption.js       ← AES-256-GCM encrypt/decrypt
│   ├── .env                    ← Secret keys (not in git)
│   ├── .env.example            ← Template
│   ├── package.json
│   └── server.js               ← Express entry point
├── frontend/
│   ├── css/
│   │   ├── shared.css          ← Design tokens, components, theme
│   │   ├── ets-portal.css      ← Portal page styles
│   │   └── ets-admin.css       ← Admin dashboard styles
│   ├── js/
│   │   ├── shared.js           ← API client, validators, theme toggle
│   │   ├── ets-portal.js       ← Portal page logic
│   │   └── ets-admin.js        ← Admin dashboard logic
│   ├── ets-portal.html         ← User WiFi sign-in page
│   └── ets-admin.html          ← Admin dashboard
├── agent/
│   ├── config.js               ← Agent configuration
│   ├── scanner.js              ← ARP table device detection
│   ├── firewall.js             ← iptables/netsh control
│   ├── monitor.js              ← Data usage tracking
│   ├── hotspot.js              ← WiFi hotspot management
│   ├── api.js                  ← Backend API communication
│   ├── index.js                ← Agent entry point
│   └── package.json
└── README.md
```

---

## How to Run — Linux (Development / Current Setup)

### Prerequisites
- Node.js v18 or higher
- npm
- `hostapd`, `dnsmasq`, `iptables`, `iw` installed
- WiFi card that supports AP+STA mode simultaneously

### Step 1 — Install backend dependencies
```bash
cd ets-signin/backend
npm install
```

### Step 2 — Configure environment
```bash
cp .env.example .env
nano .env
```

Set your own values for:
- `ENCRYPTION_KEY` — 64 hex characters
- `GRAND_ADMIN_KEY` — 64 hex characters (different from above)
- `JWT_ACCESS_SECRET` — any long random string
- `ADMIN_PASSWORD` — strong password
- `GRAND_ADMIN_PASSWORD` — strong password

Generate keys with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 3 — Install agent dependencies
```bash
cd ../agent
npm install
```

### Step 4 — Start the backend (Terminal 1)
```bash
cd backend
npm start
```

Server starts at `http://localhost:5000`

### Step 5 — Start the Agent (Terminal 2)
```bash
cd agent
sudo node index.js
```

The Agent will:
1. Connect to the backend
2. Detect the current WiFi channel automatically
3. Create the `ap0` virtual interface
4. Start broadcasting `ETS-WiFi` hotspot
5. Configure DHCP so devices get IP addresses
6. Set up firewall rules
7. Start scanning for connected devices every 10 seconds

### Step 6 — Access the system

| Page | URL |
|---|---|
| User Portal | http://192.168.100.1:5000/ets-portal.html |
| Admin Dashboard | http://192.168.100.1:5000/ets-admin.html |
| Health Check | http://192.168.100.1:5000/api/health |

### Default Admin Credentials
| Role | Username | Password |
|---|---|---|
| Admin | admin@ets.local | ETS@Admin2025! |
| Grand Admin | ga@ets.internal | GA@SuperSecret2025! |

**Change these before deploying.**

---

## How to Run — Windows

The backend and frontend work identically on Windows. Only the Agent needs adjustment.

### Step 1 — Install Node.js
Download from https://nodejs.org — choose the LTS version.

### Step 2 — Install backend
```cmd
cd ets-signin\backend
npm install
```

### Step 3 — Configure .env
Copy `.env.example` to `.env` and fill in your values.

### Step 4 — Start backend
```cmd
npm start
```

### Step 5 — Install agent
```cmd
cd ..\agent
npm install
```

### Step 6 — Run Agent as Administrator
Right-click Command Prompt → Run as Administrator

```cmd
cd ets-signin\agent
node index.js
```

### Step 7 — Enable Windows hotspot manually (until Agent hotspot is ported)
On Windows, enable the built-in Mobile Hotspot:
- Settings → Network & Internet → Mobile Hotspot
- Set network name to `ETS-WiFi`
- Set password to `ets12345`
- Turn it on

The Agent will then manage firewall rules via `netsh advfirewall`.

### Step 8 — Access
Open browser and go to:
```
http://192.168.137.1:5000/ets-portal.html
```
(Windows hotspot default gateway is 192.168.137.1)

---

## NetworkManager Conflict Fix (Linux)

If the hotspot shows `INTERFACE-DISABLED` shortly after starting, NetworkManager is fighting for control of `ap0`. Fix it:

```bash
sudo nano /etc/NetworkManager/conf.d/99-ets-unmanaged.conf
```

Add:
```ini
[keyfile]
unmanaged-devices=interface-name:ap0
```

Save and restart NetworkManager:
```bash
sudo systemctl restart NetworkManager
```

Then run the Agent again.

---

## Admin Credentials Reference

| Account | Username | Password | Access Level |
|---|---|---|---|
| Admin | admin@ets.local | ETS@Admin2025! | Full admin, SA IDs redacted |
| Grand Admin | ga@ets.internal | GA@SuperSecret2025! | Full decryption including SA IDs |

---

## Environment Variables Reference

| Variable | Description | Example |
|---|---|---|
| PORT | Server port | 5000 |
| ENCRYPTION_KEY | 64-char hex, main AES key | (generate randomly) |
| GRAND_ADMIN_KEY | 64-char hex, GA AES key | (generate randomly) |
| JWT_ACCESS_SECRET | JWT signing secret | (long random string) |
| ADMIN_USERNAME | Admin login username | admin@ets.local |
| ADMIN_PASSWORD | Admin login password | ETS@Admin2025! |
| GRAND_ADMIN_USERNAME | Grand Admin username | ga@ets.internal |
| GRAND_ADMIN_PASSWORD | Grand Admin password | GA@SuperSecret2025! |
| DB_PATH | SQLite database path | ./db/ets-wifi.db |
| AGENT_SECRET | Shared secret for Agent | ets-agent-secret-2025 |
| OTP_TTL_SECONDS | OTP expiry time | 300 |

