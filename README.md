# ETS WiFi - Captive Portal System

> A full-stack WiFi captive portal and admin dashboard built for **Eullafied Tech Solutions (ETS)**. Users authenticate to gain timed, data-limited internet access. All sensitive data is encrypted at rest using AES-256-GCM.

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Tech Stack](#2-tech-stack)
3. [Security Architecture](#3-security-architecture)
4. [Getting Started](#4-getting-started)
5. [Environment Variables](#5-environment-variables)
6. [Database](#6-database)
7. [API Reference](#7-api-reference)
8. [User Portal](#8-user-portal)
9. [Admin Dashboard](#9-admin-dashboard)
10. [Grand Admin](#10-grand-admin)
11. [Connection Plans](#11-connection-plans)
12. [Session & Data Logic](#12-session--data-logic)
13. [MAC Address Security](#13-mac-address-security)
14. [Remaining Integrations](#14-remaining-integrations)
15. [Deployment Notes](#15-deployment-notes)

---

## 1. Project Structure

```
ets-signin/
│
├── backend/
│   ├── db/
│   │   ├── schema.sql          # All table definitions
│   │   └── database.js         # DB connection, queries, seeding
│   ├── middleware/
│   │   └── auth.js             # JWT verification middleware
│   ├── routes/
│   │   ├── auth.js             # Register, login, OTP, session
│   │   ├── admin.js            # Admin dashboard API
│   │   └── grandAdmin.js       # Grand Admin full-decrypt API
│   ├── utils/
│   │   └── encryption.js       # AES-256-GCM encrypt/decrypt
│   ├── .env                    # Secret keys — never commit this
│   ├── .env.example            # Template for new installs
│   ├── .gitignore
│   ├── package.json
│   └── server.js               # Express app entry point
│
└── frontend/
    ├── css/
    │   ├── shared.css          # Design tokens, theme, components
    │   ├── ets-portal.css      # Portal page styles
    │   └── ets-admin.css       # Admin dashboard styles
    ├── js/
    │   ├── shared.js           # API client, theme, validators
    │   ├── ets-portal.js       # Portal page logic
    │   └── ets-admin.js        # Admin dashboard logic
    ├── ets-portal.html         # WiFi sign-in page (end users)
    └── ets-admin.html          # Admin dashboard page
```

---

## 2. Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Runtime | Node.js v18+ | Server-side JavaScript |
| Framework | Express 4 | HTTP routing and middleware |
| Database | SQLite via sql.js | Embedded database, no external server needed |
| Auth | jsonwebtoken + bcryptjs | JWT tokens + password hashing |
| Encryption | Node.js `crypto` (built-in) | AES-256-GCM field-level encryption |
| Frontend | Plain HTML + CSS + JavaScript | No framework, no build step |
| Charts | Chart.js 4 (CDN) | Live data visualisation |
| Fonts | Google Fonts | Exo 2 + DM Sans |

> **No framework. No build step. Just Node.js.**

---

## 3. Security Architecture

### 3.1 Field-Level Encryption (AES-256-GCM)

Every sensitive field is encrypted before being stored in the database. AES-256-GCM provides both **confidentiality** (data cannot be read) and **integrity** (tampering is detected via the auth tag).

**Output format per encrypted value:**
```
iv_hex : tag_hex : ciphertext_hex
```

- `iv` — 12 random bytes, freshly generated per encryption call
- `tag` — 16-byte authentication tag (detects tampering)
- `ciphertext` — the encrypted value

**Two key tiers:**

| Tier | Env Variable | Columns |
|---|---|---|
| Main Key | `ENCRYPTION_KEY` | `*_enc` columns |
| Grand Admin Key | `GRAND_ADMIN_KEY` | `*_ga` columns |

Sensitive fields are stored **twice** — once per key. This allows the Grand Admin to read everything using only the GA key, independently of the main key.

### 3.2 Deterministic Hashing

Searchable encrypted fields (email, phone, SA ID, MAC) are also stored as **HMAC-SHA256** hashes. These are used as unique indexes for lookups without exposing plaintext. They cannot be reversed.

### 3.3 Password Hashing

| Account Type | Algorithm | Cost Factor |
|---|---|---|
| Users | bcrypt | 12 |
| Admins | bcrypt | 14 |

Plaintext passwords **never** touch the database.

### 3.4 JWT Tokens

- Access tokens expire in **15 minutes**
- Stored in `sessionStorage` — cleared automatically when the browser tab is closed
- Role (`user`, `admin`, `grand_admin`) is embedded in the token payload

### 3.5 Rate Limiting

| Endpoint Group | Limit |
|---|---|
| `/api/auth/*` | 30 requests per 15 minutes |
| `/api/*` (all others) | 200 requests per 15 minutes |

### 3.6 MAC Address Security

- MAC addresses are hashed (HMAC) for indexing
- Stored encrypted with both keys
- Blocked devices cannot connect even with valid credentials
- See [Section 13](#13-mac-address-security) for full detail

---

## 4. Getting Started

### Prerequisites

- Node.js v18 or higher
- npm

### Step 1 — Clone the repository

```bash
git clone <your-repo-url>
cd ets-signin
```

### Step 2 — Install dependencies

```bash
cd backend
npm install
```

### Step 3 — Configure environment variables

```bash
cp .env.example .env
nano .env
```

Fill in your values. See [Section 5](#5-environment-variables) for details.

**Generate secure random keys:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Run this **twice** — once for `ENCRYPTION_KEY`, once for `GRAND_ADMIN_KEY`. They must be different.

### Step 4 — Start the server

```bash
npm start
```

### Step 5 — Open in browser

| Page | URL |
|---|---|
| User Portal | http://localhost:5000/ets-portal.html |
| Admin Dashboard | http://localhost:5000/ets-admin.html |
| Health Check | http://localhost:5000/api/health |

> The database is created automatically on first boot and seeded with default plans and admin accounts.

---

## 5. Environment Variables

Create a `.env` file in the `backend/` folder. Never commit this file.

```env
# Server
PORT=5000
NODE_ENV=development

# Encryption — must be exactly 64 hex characters (32 bytes each)
ENCRYPTION_KEY=your_64_char_hex_string_here
GRAND_ADMIN_KEY=your_different_64_char_hex_string_here

# JWT
JWT_ACCESS_SECRET=your_long_random_string
JWT_REFRESH_SECRET=your_different_long_random_string
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d

# Admin accounts (seeded on first boot)
ADMIN_USERNAME=admin@ets.local
ADMIN_PASSWORD=ETS@Admin2025!
GRAND_ADMIN_USERNAME=ga@ets.internal
GRAND_ADMIN_PASSWORD=GA@SuperSecret2025!

# Database
DB_PATH=./db/ets-wifi.db

# Session defaults
DEFAULT_PLAN_DURATION_HOURS=8
DEFAULT_PLAN_DATA_MB=1024
OTP_TTL_SECONDS=300
```

| Variable | Description |
|---|---|
| `PORT` | Server port |
| `NODE_ENV` | `development` or `production` |
| `ENCRYPTION_KEY` | 64-char hex — main AES-256 key |
| `GRAND_ADMIN_KEY` | 64-char hex — Grand Admin AES-256 key |
| `JWT_ACCESS_SECRET` | JWT signing secret |
| `JWT_REFRESH_SECRET` | JWT refresh secret |
| `JWT_ACCESS_EXPIRES` | Access token lifetime |
| `ADMIN_USERNAME` | Admin login username |
| `ADMIN_PASSWORD` | Admin login password |
| `GRAND_ADMIN_USERNAME` | Grand Admin login username |
| `GRAND_ADMIN_PASSWORD` | Grand Admin login password |
| `DB_PATH` | Path to the SQLite `.db` file |
| `OTP_TTL_SECONDS` | How long an OTP is valid (seconds) |

---

## 6. Database

The SQLite database is stored at `backend/db/ets-wifi.db` and created automatically on first boot.

### Tables

| Table | Purpose |
|---|---|
| `plans` | WiFi connection packages (duration + data limit) |
| `users` | Registered users with encrypted personal data |
| `credentials` | Bcrypt-hashed passwords (separate from users) |
| `devices` | MAC address registry per user |
| `sessions` | Active and historical WiFi connections |
| `otp_codes` | Short-lived phone verification codes |
| `admins` | Admin and Grand Admin accounts |
| `logs` | Tamper-evident audit log of all events |

### Column Naming Convention

| Suffix | Meaning |
|---|---|
| `_enc` | Encrypted with the main `ENCRYPTION_KEY` |
| `_ga` | Encrypted with the `GRAND_ADMIN_KEY` |
| `_hash` | HMAC-SHA256 hash — used as a unique index |

### Key Relationships

```
plans ──< sessions >── users ──< credentials
                 └──< devices
logs >── users
logs >── admins
```

---

## 7. API Reference

All API routes are prefixed with `/api`.

### 7.1 Auth Routes — `/api/auth`

No authentication required unless noted.

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/register` | `authMethod, fullName, email, password, macAddress, planId` | Register a new user |
| `POST` | `/login` | `authMethod, email, password, macAddress` | User login |
| `POST` | `/otp/request` | `phone, dialCode` | Request a phone OTP |
| `POST` | `/otp/verify` | `phone, dialCode, code, macAddress, planId` | Verify OTP and connect |
| `POST` | `/admin/login` | `username, password` | Admin login — returns JWT |
| `GET` | `/session` | Header: `X-Session-Token` | Check session status + data usage |
| `POST` | `/logout` | `sessionToken` | End a session |

### 7.2 Admin Routes — `/api/admin`

**Requires:** `Authorization: Bearer <admin_jwt>`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/stats` | Overview stats + recent logs |
| `GET` | `/users` | List users (filter by `?status=active`) |
| `GET` | `/users/:id` | Single user with sessions and devices |
| `POST` | `/users/:id/block` | Block a user |
| `POST` | `/users/:id/unblock` | Unblock a user |
| `GET` | `/sessions` | List sessions (filter by `?status=active`) |
| `POST` | `/sessions/:id/disconnect` | Kick an active session |
| `GET` | `/devices` | List all registered devices |
| `POST` | `/devices/:id/block` | Block a device by MAC |
| `POST` | `/devices/:id/unblock` | Unblock a device |
| `GET` | `/logs` | Audit logs (filter by `?eventType=connect`) |
| `GET` | `/plans` | List all connection plans |
| `POST` | `/plans` | Create a new plan |
| `PUT` | `/plans/:id` | Update an existing plan |

### 7.3 Grand Admin Routes — `/api/grand`

**Requires:** `Authorization: Bearer <grand_admin_jwt>`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/users` | All users — fully decrypted including SA ID |
| `GET` | `/devices` | All devices — full MAC addresses decrypted |
| `GET` | `/logs` | Full audit logs decrypted with GA key |
| `GET` | `/admins` | All admin accounts |
| `POST` | `/decrypt` | Manually decrypt any stored payload |

---

## 8. User Portal

Located at `frontend/ets-portal.html`.

The portal has four authentication tabs:

### 8.1 SA ID Tab

- Validates the 13-digit number in real time (Luhn algorithm + date + age check)
- Automatically extracts date of birth, gender, and citizenship
- Minimum age: **18 years**
- New users register, returning users sign in with their ID + password

### 8.2 Email Tab

- Standard email + password login and registration
- Password strength meter (Weak / Fair / Good / Strong)
- Confirm password field on registration
- Duplicate email check against the database

### 8.3 Phone OTP Tab

- Supported dial codes: 🇿🇦 +27, 🇿🇼 +263, 🇧🇼 +267, 🇲🇿 +258, 🇰🇪 +254, 🇳🇬 +234, 🇺🇸 +1, 🇬🇧 +44
- 6-digit OTP with 5-minute expiry
- OTP digits auto-advance on input and support paste
- Resend button enabled after expiry
- Currently logs OTP to console — see [Section 14](#14-remaining-integrations) for real SMS setup

### 8.4 Social / Guest Tab

- Google and Microsoft buttons (OAuth setup required — see Section 14)
- Guest access with name + terms acceptance
- Guest accounts are assigned the Guest plan (30 min / 50 MB)

### 8.5 Session Widget

After connecting, a live session widget appears showing:
- Data used and remaining
- Period reset time
- Current period number
- Visual usage bar (green → yellow → red)
- Disconnect button

The widget polls the server every 30 seconds.

---

## 9. Admin Dashboard

Located at `frontend/ets-admin.html`.

### Default Credentials

| Role | Username | Password |
|---|---|---|
| Admin | `admin@ets.local` | `ETS@Admin2025!` |
| Grand Admin | `ga@ets.internal` | `GA@SuperSecret2025!` |

> **Change these in `.env` before deploying to production.**

### Dashboard Sections

| Section | What it shows |
|---|---|
| **Overview** | Live stats, data usage bar chart, auth method doughnut chart, recent activity log |
| **Users** | All registered users with block/unblock actions. Searchable and filterable. |
| **Sessions** | Active and past connections with data usage bars |
| **Devices** | Registered MAC addresses with block/unblock |
| **Audit Logs** | Every network event — connect, disconnect, failed auth, blocked, etc. |
| **Plans** | All connection packages |
| **Grand Admin** | Full decryption view — only visible after Grand Admin login |

### Charts (Overview)

Both charts pull **live data** from the database on every load and refresh:

- **Bar chart** — data used vs data limit for the last 10 sessions
- **Doughnut chart** — breakdown of auth methods used by registered users

Charts update automatically when you click **Refresh** or navigate back to Overview.

### Theme Toggle

Both the portal and admin dashboard support **light and dark mode**. The preference is saved to `localStorage` and persists across sessions.

---

## 10. Grand Admin

The Grand Admin is a **hidden privileged role** with full decryption access.

### What makes Grand Admin different from Admin

| Capability | Admin | Grand Admin |
|---|---|---|
| View users | ✅ (decrypted with main key) | ✅ (decrypted with GA key) |
| View SA ID numbers | ❌ (redacted) | ✅ (fully visible) |
| View full MAC addresses | ❌ (masked) | ✅ (fully visible) |
| Access `/api/grand/*` | ❌ | ✅ |
| Manually decrypt payloads | ❌ | ✅ |
| Grand Admin nav item | ❌ | ✅ (appears after login) |

### Security Notes

- The Grand Admin username is intentionally not obvious
- The GA key (`GRAND_ADMIN_KEY`) should be stored separately from the main key — ideally in a secrets manager in production
- The GA key should be rotated periodically
- All Grand Admin actions are recorded in the audit log

---

## 11. Connection Plans

Default plans seeded on first boot:

| Plan | Duration | Data Allowance |
|---|---|---|
| Guest | 30 minutes | 50 MB |
| Basic | 1 hour | 200 MB |
| Standard | 4 hours | 500 MB |
| Extended | 8 hours | 1 GB |
| Daily | 24 hours | 3 GB |

Plans can be created and updated from the Admin dashboard under **Plans**.

---

## 12. Session & Data Logic

This is the core of how the WiFi access control works.

### How a session works

```
User connects
     │
     ▼
Session created
  - started_at = now
  - expires_at = now + plan.duration_hours
  - period_end = expires_at
  - data_used_mb = 0
  - data_limit_mb = plan.data_limit_mb
  - period_number = 1
     │
     ▼
User browses → data_used_mb increases
     │
     ├── data_used_mb >= data_limit_mb
     │        │
     │        ▼
     │   status = data_exhausted
     │   (internet paused)
     │        │
     │        ▼
     │   period_end reached
     │        │
     │        ▼
     │   data_used_mb resets to 0
     │   period_number + 1
     │   new period_end calculated
     │   status = active
     │   (internet resumes)
     │
     └── expires_at reached
              │
              ▼
         status = expired
         (session ends)
```

### Period Reset Logic

When `GET /api/auth/session` is called and `period_end <= now`:

1. `data_used_mb` is reset to `0`
2. `period_number` increments by 1
3. A new `period_end` is set to `now + plan.duration_hours`
4. The response includes `periodReset: true`
5. The portal shows a toast notification informing the user

This means a user on the Extended plan (8h / 1GB) who uses their 1GB in 3 hours will have their data reset at the 8-hour mark and can browse again.

---

## 13. MAC Address Security

### How it works

1. The browser generates a stable pseudo-MAC address using `crypto.getRandomValues()` and stores it in `localStorage` as `ets-device-id`
2. This fingerprint is sent with every register/login request
3. The server normalises it to `AA:BB:CC:DD:EE:FF` format
4. It is stored encrypted (both keys) and indexed as an HMAC hash
5. If a device is blocked, the server rejects any connection from that MAC — even with valid credentials

### Production Recommendation

In a real captive portal deployment, replace the browser fingerprint with a **server-side ARP table lookup**:

```bash
# Linux — get MAC from IP
arp -n <client_ip>
```

This gives you the true hardware MAC address of the connecting device.

### Device Blocking Flow

```
Admin blocks device
        │
        ▼
devices.is_blocked = 1
        │
        ▼
Next connection attempt from that MAC
        │
        ▼
Server checks mac_hash against devices table
        │
        ▼
is_blocked = 1 → 403 Forbidden
"This device has been blocked."
```

---

## 14. Remaining Integrations

### 14.1 Real SMS OTP (Twilio)

**Step 1** — Sign up at https://twilio.com (free trial available)

**Step 2** — Get your credentials from the Twilio Console:
- Account SID
- Auth Token
- A Twilio phone number

**Step 3** — Add to `.env`:
```env
TWILIO_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_TOKEN=your_auth_token
TWILIO_FROM=+27XXXXXXXXX
```

**Step 4** — Install the SDK:
```bash
npm install twilio
```

**Step 5** — In `backend/routes/auth.js`, find the OTP request route and replace:
```js
console.log(`[OTP] Code for ${phone}: ${code}`);
```
With:
```js
const twilio = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
await twilio.messages.create({
  body: `Your ETS WiFi code is: ${code}`,
  from: process.env.TWILIO_FROM,
  to: fullPhone,
});
```

### 14.2 Google OAuth

**Step 1** — Go to https://console.cloud.google.com

**Step 2** — Create a new project

**Step 3** — Go to **APIs & Services → Credentials**

**Step 4** — Create **OAuth 2.0 Client ID** (Web application)

**Step 5** — Set Authorised redirect URI to:
```
http://localhost:5000/api/auth/google/callback
```

**Step 6** — Add to `.env`:
```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
```

**Step 7** — Install:
```bash
npm install passport passport-google-oauth20
```

### 14.3 Microsoft OAuth

**Step 1** — Go to https://portal.azure.com

**Step 2** — Go to **Azure Active Directory → App registrations → New registration**

**Step 3** — Set redirect URI to:
```
http://localhost:5000/api/auth/microsoft/callback
```

**Step 4** — Add to `.env`:
```env
MICROSOFT_CLIENT_ID=your_client_id
MICROSOFT_CLIENT_SECRET=your_client_secret
```

**Step 5** — Install:
```bash
npm install passport passport-microsoft
```

---

## 15. Deployment Notes

### Before deploying to production

- [ ] Change all default passwords in `.env`
- [ ] Generate new random `ENCRYPTION_KEY` and `GRAND_ADMIN_KEY`
- [ ] Set `NODE_ENV=production`
- [ ] Set up HTTPS — a captive portal must use HTTPS
- [ ] Run behind a reverse proxy (nginx recommended)
- [ ] Store the `GRAND_ADMIN_KEY` in a secrets manager, not in `.env`
- [ ] Set up database backups for `ets-wifi.db`
- [ ] Remove `_devCode` from OTP response in production

### Nginx reverse proxy example

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Running as a service (systemd)

```ini
[Unit]
Description=ETS WiFi Portal
After=network.target

[Service]
Type=simple
User=ashley
WorkingDirectory=/path/to/ets-signin/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
EnvironmentFile=/path/to/ets-signin/backend/.env

[Install]
WantedBy=multi-user.target
```

---

## Author

Built by **Ashley Koketso Motsie** — Full-Stack Developer & AI Engineer  
GitHub: [KodEx-SA](https://github.com/KodEx-SA)  
Portfolio: [ashleydevhub.vercel.app](https://ashleydevhub.vercel.app)

---

*ETS WiFi Portal — Eullafied Tech Solutions*
