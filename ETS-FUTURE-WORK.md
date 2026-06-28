# ETS WiFi Portal — Future Work & Continuation Guide
## For Eullafied Tech Solutions — June 2026

---

## Overview

This document explains what remains to be built, how to continue, and the exact steps needed for each remaining feature. The system is functional as submitted — this document is a roadmap for completing it.

---

## 1. Real SMS OTP via Twilio

Currently the OTP system generates a real 6-digit code and verifies it correctly, but sends it via `console.log` (server terminal) instead of an actual SMS.

### What to do

**Step 1** — Sign up at https://twilio.com (free trial available)

**Step 2** — From the Twilio Console get:
- Account SID (starts with `AC...`)
- Auth Token
- A Twilio phone number

**Step 3** — Add to `backend/.env`:
```
TWILIO_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_TOKEN=your_auth_token
TWILIO_FROM=+27XXXXXXXXX
```

**Step 4** — Install SDK:
```bash
cd backend
npm install twilio
```

**Step 5** — In `backend/routes/auth.js` find the OTP request route.
Find this line:
```js
console.log(`[OTP] Code for ${phone}: ${code}`);
```

Replace with:
```js
const twilio = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
await twilio.messages.create({
  body: `Your ETS WiFi access code is: ${code}. Valid for 5 minutes.`,
  from: process.env.TWILIO_FROM,
  to  : fullPhone,
});
```

Also remove `_devCode` from the response so codes are not exposed in production:
```js
// Remove this line from the return statement:
_devCode: code
```

---

## 2. Google OAuth

### What to do

**Step 1** — Go to https://console.cloud.google.com

**Step 2** — Create a new project named "ETS WiFi"

**Step 3** — Go to APIs & Services → OAuth consent screen → Fill in app details

**Step 4** — Go to APIs & Services → Credentials → Create OAuth 2.0 Client ID
- Application type: Web application
- Authorised redirect URI: `http://your-server-ip:5000/api/auth/google/callback`

**Step 5** — Add to `backend/.env`:
```
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
```

**Step 6** — Install:
```bash
npm install passport passport-google-oauth20 express-session
```

**Step 7** — Add to `backend/server.js`:
```js
const session  = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

app.use(session({ secret: process.env.JWT_ACCESS_SECRET, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
  clientID    : process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL : '/api/auth/google/callback',
}, (accessToken, refreshToken, profile, done) => {
  done(null, profile);
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

app.get('/api/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/api/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/ets-portal.html' }),
  (req, res) => {
    // Create session for the authenticated user
    // then redirect to portal with session token
    res.redirect('/ets-portal.html?auth=google&name=' + encodeURIComponent(req.user.displayName));
  }
);
```

**Step 8** — In `frontend/js/ets-portal.js` update the Google button:
```js
document.getElementById('google-btn')?.addEventListener('click', () => {
  window.location.href = '/api/auth/google';
});
```

---

## 3. Microsoft OAuth

### What to do

**Step 1** — Go to https://portal.azure.com

**Step 2** — Azure Active Directory → App registrations → New registration
- Name: ETS WiFi
- Redirect URI: `http://your-server-ip:5000/api/auth/microsoft/callback`

**Step 3** — Add to `backend/.env`:
```
MICROSOFT_CLIENT_ID=your_client_id
MICROSOFT_CLIENT_SECRET=your_client_secret
MICROSOFT_TENANT=common
```

**Step 4** — Install:
```bash
npm install passport-microsoft
```

**Step 5** — Follow same pattern as Google strategy above using `passport-microsoft`.

---

## 4. Fix NetworkManager Conflict on Linux

The hostapd `INTERFACE-DISABLED` issue is caused by NetworkManager taking control of `ap0` after it is created.

### Permanent fix

```bash
sudo nano /etc/NetworkManager/conf.d/99-ets-unmanaged.conf
```

Add:
```ini
[keyfile]
unmanaged-devices=interface-name:ap0
```

```bash
sudo systemctl restart NetworkManager
```

### Verify
```bash
nmcli device status | grep ap0
# Should show: ap0   wifi   unmanaged
```

---

## 5. Windows Agent — Hotspot and Firewall

The Agent `scanner.js` and `monitor.js` already work on Windows. What still needs to be completed is `firewall.js` and `hotspot.js` for Windows.

### Hotspot on Windows

Windows has a built-in hosted network feature. The Agent needs to run these commands:

```js
// Start hotspot
await run('netsh wlan set hostednetwork mode=allow ssid=ETS-WiFi key=ets12345');
await run('netsh wlan start hostednetwork');

// Stop hotspot
await run('netsh wlan stop hostednetwork');
```

Or use Internet Connection Sharing (ICS) via PowerShell:
```powershell
# Enable hotspot via ICS
New-NetConnectionSharing -InterfaceAlias "Wi-Fi" -ConnectionSharingMode Enabled
```

### Firewall on Windows

The Windows firewall module in `agent/firewall.js` is already written using `netsh advfirewall`. It needs testing on a Windows machine with Administrator privileges.

Key commands used:
```cmd
netsh advfirewall firewall add rule name="ETS-ALLOW-192.168.137.X" protocol=ANY dir=in action=allow remoteip=192.168.137.X
netsh advfirewall firewall add rule name="ETS-BLOCK-192.168.137.X" protocol=ANY dir=in action=block remoteip=192.168.137.X
```

### Windows Agent gateway IP

Windows Mobile Hotspot uses `192.168.137.1` as the gateway by default. Update `agent/config.js`:
```js
GATEWAY_IP: IS_LINUX ? '192.168.100.1' : '192.168.137.1',
```

---

## 6. Production Deployment

When deploying to a real server or production router:

### Install nginx
```bash
sudo apt install nginx
```

### nginx config (`/etc/nginx/sites-available/ets-wifi`)
```nginx
server {
    listen 80;
    server_name your-domain-or-ip;

    location / {
        proxy_pass         http://localhost:5000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### Run as a systemd service
```ini
# /etc/systemd/system/ets-wifi.service
[Unit]
Description=ETS WiFi Backend
After=network.target

[Service]
Type=simple
User=ets
WorkingDirectory=/path/to/ets-signin/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
EnvironmentFile=/path/to/ets-signin/backend/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable ets-wifi
sudo systemctl start ets-wifi
```

### Run Agent as a service
```ini
# /etc/systemd/system/ets-agent.service
[Unit]
Description=ETS WiFi Network Agent
After=network.target ets-wifi.service

[Service]
Type=simple
User=root
WorkingDirectory=/path/to/ets-signin/agent
ExecStart=/usr/bin/node index.js
Restart=on-failure
EnvironmentFile=/path/to/ets-signin/backend/.env

[Install]
WantedBy=multi-user.target
```

---

## 7. Database Backup

The SQLite database file lives at `backend/db/ets-wifi.db`. Back it up regularly:

```bash
# Manual backup
cp backend/db/ets-wifi.db backend/db/backups/ets-wifi-$(date +%Y%m%d).db

# Automated daily backup via cron
0 2 * * * cp /path/to/backend/db/ets-wifi.db /path/to/backups/ets-wifi-$(date +\%Y\%m\%d).db
```

---

## 8. Security Checklist Before Going Live

- [ ] Change `ADMIN_PASSWORD` in `.env`
- [ ] Change `GRAND_ADMIN_PASSWORD` in `.env`
- [ ] Generate new `ENCRYPTION_KEY` (do not use the development key in production)
- [ ] Generate new `GRAND_ADMIN_KEY` (store separately from main key)
- [ ] Generate new `JWT_ACCESS_SECRET`
- [ ] Generate new `AGENT_SECRET`
- [ ] Set `NODE_ENV=production` in `.env`
- [ ] Set up HTTPS with SSL certificate
- [ ] Remove `_devCode` from OTP response in `backend/routes/auth.js`
- [ ] Set up database backups
- [ ] Restrict `.env` file permissions: `chmod 600 .env`

---

## Tech Stack Summary

| Component | Technology |
|---|---|
| Backend runtime | Node.js v18+ |
| Web framework | Express 4 |
| Database | SQLite via sql.js |
| Encryption | AES-256-GCM (Node.js built-in crypto) |
| Password hashing | bcryptjs |
| Authentication | JWT (jsonwebtoken) |
| Frontend | Plain HTML + CSS + JavaScript |
| Charts | Chart.js 4 |
| WiFi hotspot (Linux) | hostapd |
| DHCP/DNS (Linux) | dnsmasq |
| Firewall (Linux) | iptables |
| Firewall (Windows) | netsh advfirewall |
| Device detection | ARP table (ip neigh / arp -a) |

---

## Contact

**Built by:** Ashley Koketso Motsie  
**GitHub:** KodEx-SA  
**Portfolio:** ashleydevhub.vercel.app  
**For:** Eullafied Tech Solutions

