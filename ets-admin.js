/* =============================================================
   ETS WiFi — Admin Dashboard Script

   Security model (client-side demo):
   - Credentials are validated against ADMIN_CREDENTIALS below.
     In production replace this with a server-side auth endpoint.
   - All user-supplied content is HTML-escaped before rendering.
   - A RateLimiter prevents brute-force on the login form.
   ============================================================= */

'use strict';

/* ══════════════════════════════════════════════════════════════
   CONSTANTS & CONFIGURATION
   ══════════════════════════════════════════════════════════════ */

/**
 * Demo credentials.
 * In production NEVER store credentials client-side.
 * Replace adminLogin() with a fetch() to a secure server endpoint.
 */
const ADMIN_CREDENTIALS = {
    username: 'admin@ets.local',
    password: 'ETS@Admin2025!',
};

const LOGIN_CONFIG = {
    MAX_ATTEMPTS: 5,
    LOCKOUT_MS: 3 * 60_000,  // 3-minute lockout
};


/* ══════════════════════════════════════════════════════════════
   MOCK DATA
   ══════════════════════════════════════════════════════════════ */

const AVATARS = ['#00D2FF', '#6655FF', '#00E87A', '#FFB020', '#FF3B5C', '#FF6B9D', '#00D2C8'];
const DEVICES = ['Windows 11', 'macOS Sonoma', 'Android 14', 'iPhone iOS 17', 'Ubuntu 22', 'Chromebook'];
const AUTH_TYPES = ['SA ID', 'Email', 'Phone OTP', 'Google', 'Guest'];
const NAMES = [
    'Thabo Mokoena', 'Nomvula Dlamini', 'Sipho Nkosi', 'Lerato Sithole',
    'Kwena Lekganyane', 'Fatima Mahomed', 'Bongani Zulu', 'Ayanda Cele',
    'Pieter van der Merwe', 'Naledi Moyo', 'Kagiso Modise', 'Zanele Khumalo',
    'Ruan Botha', 'Priya Naidoo', 'Tshepo Sefolo',
];
const EMAILS = [
    'thabo@gmail.com', 'nomvula@work.co.za', 'sipho.nkosi@email.com',
    'lerato.s@outlook.com', 'kwena@gmail.com', 'fatima.m@icloud.com',
    'bongani@ymail.com', 'ayanda.c@gmail.com', 'pieter.vdm@company.co.za',
    'naledi.m@webmail.co.za',
];

const LOG_EVENTS = ['connect', 'disconnect', 'blocked', 'failed', 'data_limit'];
const LOG_DETAILS = {
    connect: ['Session started', 'Returning user auto-connected', 'New registration'],
    disconnect: ['Session timeout', 'User disconnected', 'Idle timeout'],
    blocked: ['Too many failed attempts', 'Admin blocked', 'Policy violation'],
    failed: ['Wrong password', 'Invalid OTP', 'ID verification failed'],
    data_limit: ['Soft limit reached (80%)', 'Hard cap enforced', 'Throttled to 1Mbps'],
};

let users = [];
let logs = [];
let confirmCb = null;


/* ══════════════════════════════════════════════════════════════
   UTILITY HELPERS
   ══════════════════════════════════════════════════════════════ */

/** Safely escapes a string for insertion into HTML. Prevents XSS. */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function randItem(arr) { return arr[randInt(0, arr.length - 1)]; }

function fmtTime(date) {
    return [date.getHours(), date.getMinutes(), date.getSeconds()]
        .map(n => String(n).padStart(2, '0'))
        .join(':');
}

function fmtDuration(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function randomIP() { return `192.168.${randInt(1, 5)}.${randInt(2, 250)}`; }

function generateUsers() {
    users = NAMES.map((name, i) => {
        const blocked = i > 12;
        const idle = !blocked && i > 9;
        return {
            id: i + 1,
            name,
            email: EMAILS[i % EMAILS.length],
            auth: randItem(AUTH_TYPES),
            ip: randomIP(),
            mac: [...Array(6)].map(() => randInt(0, 255).toString(16).padStart(2, '0')).join(':').toUpperCase(),
            device: randItem(DEVICES),
            dl: (Math.random() * 800 + 50).toFixed(1),
            ul: (Math.random() * 200 + 10).toFixed(1),
            duration: randInt(5, 480),
            status: blocked ? 'blocked' : idle ? 'idle' : 'active',
            avatar: AVATARS[i % AVATARS.length],
            initials: name.split(' ').map(w => w[0]).join('').slice(0, 2),
            connectedAt: new Date(Date.now() - randInt(5, 480) * 60_000),
        };
    });
}

function generateLogs() {
    logs = [];
    const now = Date.now();
    for (let i = 0; i < 40; i++) {
        const evt = randItem(LOG_EVENTS);
        logs.push({
            time: new Date(now - randInt(0, 7_200_000)),
            user: randItem(NAMES),
            event: evt,
            ip: randomIP(),
            auth: randItem(AUTH_TYPES),
            detail: randItem(LOG_DETAILS[evt]),
        });
    }
    logs.sort((a, b) => b.time - a.time);
}


/* ══════════════════════════════════════════════════════════════
   RATE LIMITER (admin login)
   ══════════════════════════════════════════════════════════════ */

class RateLimiter {
    constructor(max, lockMs) {
        this._max = max;
        this._lockMs = lockMs;
        this._attempts = 0;
        this._lockedAt = null;
    }

    recordFailure() {
        this._attempts++;
        if (this._attempts >= this._max) this._lockedAt = Date.now();
        return this.isLocked();
    }

    reset() { this._attempts = 0; this._lockedAt = null; }

    isLocked() {
        if (!this._lockedAt) return false;
        if (Date.now() - this._lockedAt >= this._lockMs) { this.reset(); return false; }
        return true;
    }

    remainingSeconds() {
        if (!this._lockedAt) return 0;
        return Math.ceil((this._lockMs - (Date.now() - this._lockedAt)) / 1000);
    }

    attemptsLeft() { return Math.max(0, this._max - this._attempts); }
}

const loginLimiter = new RateLimiter(LOGIN_CONFIG.MAX_ATTEMPTS, LOGIN_CONFIG.LOCKOUT_MS);


/* ══════════════════════════════════════════════════════════════
   SVG ICONS FOR PASSWORD TOGGLE
   ══════════════════════════════════════════════════════════════ */

const EYE_OPEN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
</svg>`;

const EYE_CLOSED = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94
           M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/>
</svg>`;


/* ══════════════════════════════════════════════════════════════
   ADMIN LOGIN
   ══════════════════════════════════════════════════════════════ */

(function initLogin() {
    const loginBtn = document.getElementById('admin-login-btn');
    const pwToggle = document.getElementById('admin-pw-toggle');
    const userInput = document.getElementById('admin-user');
    const pwInput = document.getElementById('admin-pw');
    const errorEl = document.getElementById('admin-login-error');
    const userFb = document.getElementById('admin-user-feedback');
    const pwFb = document.getElementById('admin-pw-feedback');

    // Password visibility toggle
    pwToggle.addEventListener('click', () => {
        const isText = pwInput.type === 'text';
        pwInput.type = isText ? 'password' : 'text';
        pwToggle.innerHTML = isText ? EYE_OPEN : EYE_CLOSED;
    });

    // Allow Enter key on both fields
    [userInput, pwInput].forEach(el => {
        el.addEventListener('keydown', e => { if (e.key === 'Enter') loginBtn.click(); });
    });

    loginBtn.addEventListener('click', () => {
        // Clear old errors
        errorEl.style.display = 'none';
        setFeedback(userFb, '', '');
        setFeedback(pwFb, '', '');

        if (loginLimiter.isLocked()) {
            showLoginError(`Too many failed attempts. Please wait ${loginLimiter.remainingSeconds()}s.`);
            return;
        }

        const username = userInput.value.trim();
        const password = pwInput.value;

        // Field-level presence checks
        let hasFieldError = false;
        if (!username) { setFeedback(userFb, 'Please enter your username.', 'err'); hasFieldError = true; }
        if (!password) { setFeedback(pwFb, 'Please enter your password.', 'err'); hasFieldError = true; }
        if (hasFieldError) return;

        // Credential check
        const valid =
            username === ADMIN_CREDENTIALS.username &&
            password === ADMIN_CREDENTIALS.password;

        if (!valid) {
            const locked = loginLimiter.recordFailure();
            if (locked) {
                showLoginError(`Too many failed attempts. Account locked for ${Math.ceil(LOGIN_CONFIG.LOCKOUT_MS / 60_000)} minutes.`);
            } else {
                const left = loginLimiter.attemptsLeft();
                showLoginError(
                    `Invalid username or password.${left <= 2 ? ` ${left} attempt${left !== 1 ? 's' : ''} remaining.` : ''}`
                );
            }
            // Shake the card
            const card = document.querySelector('.login-card');
            card.classList.add('shake');
            card.addEventListener('animationend', () => card.classList.remove('shake'), { once: true });
            pwInput.value = '';
            pwInput.focus();
            return;
        }

        // Successful login
        loginLimiter.reset();
        setLoading(loginBtn, true);

        // Update sidebar with actual username initials
        const initials = username.split('@')[0].slice(0, 2).toUpperCase();
        document.getElementById('sidebar-initials').textContent = initials;
        document.getElementById('sidebar-email').textContent = escapeHtml(username);

        setTimeout(() => {
            setLoading(loginBtn, false);
            document.getElementById('login-gate').style.display = 'none';
            const app = document.getElementById('app');
            app.style.display = 'flex';

            generateUsers();
            generateLogs();

            updateStats();
            renderBwChart();
            renderDist();
            renderRecentActivity();
            renderUsersTable(users);
            renderBwTable();
            renderLogsTable(logs);
            document.getElementById('nav-badge').textContent = users.filter(u => u.status === 'active').length;
        }, 800);
    });

    function showLoginError(msg) {
        errorEl.textContent = msg;
        errorEl.style.display = 'block';
    }
})();

function logout() {
    showConfirm('Sign Out', 'Sign out of the admin dashboard?', () => {
        document.getElementById('app').style.display = 'none';
        document.getElementById('login-gate').style.display = 'flex';
        document.getElementById('admin-user').value = '';
        document.getElementById('admin-pw').value = '';
        document.getElementById('admin-login-error').style.display = 'none';
    }, false);
}

document.getElementById('logout-btn').addEventListener('click', logout);


/* ══════════════════════════════════════════════════════════════
   NAVIGATION
   ══════════════════════════════════════════════════════════════ */

const SECTION_META = {
    overview: ['Overview', 'Real-time network monitoring — ETS Campus'],
    bandwidth: ['Bandwidth', 'Usage analytics and traffic monitoring'],
    users: ['Connected Users', 'Manage and monitor all network users'],
    logs: ['Session Logs', 'Full network event history'],
    settings: ['Settings', 'Network and portal configuration'],
};

document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', () => {
        const id = item.dataset.section;
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.getElementById(`section-${id}`).classList.add('active');
        item.classList.add('active');
        const [title, sub] = SECTION_META[id];
        document.getElementById('section-title').textContent = title;
        document.getElementById('section-sub').textContent = sub;
    });
});

document.getElementById('refresh-btn').addEventListener('click', () => {
    generateUsers();
    generateLogs();
    updateStats();
    renderBwChart();
    renderDist();
    renderRecentActivity();
    renderUsersTable(users);
    renderBwTable();
    renderLogsTable(logs);
    document.getElementById('nav-badge').textContent = users.filter(u => u.status === 'active').length;
    toast('Data refreshed', 'success');
});


/* ══════════════════════════════════════════════════════════════
   STATS
   ══════════════════════════════════════════════════════════════ */

function updateStats() {
    const active = users.filter(u => u.status === 'active').length;
    const blocked = users.filter(u => u.status === 'blocked').length;
    const totalBW = users.reduce((s, u) => s + parseFloat(u.dl), 0);

    animateCount('stat-total', users.length);
    animateCount('stat-active', active);
    animateCount('stat-blocked', blocked);
    document.getElementById('stat-bw').textContent = (totalBW / 1024).toFixed(1) + ' GB';
    document.getElementById('stat-total-change').textContent = `↑ ${randInt(2, 8)} this session`;
    document.getElementById('stat-blocked-change').textContent =
        blocked > 0 ? `${blocked} pending review` : '— No blocked users';
    document.getElementById('users-count-label').textContent =
        `${users.length} registered — ${active} active now`;
}

function animateCount(id, target) {
    let cur = 0;
    const el = document.getElementById(id);
    const step = Math.max(1, Math.ceil(target / 30));
    const iv = setInterval(() => {
        cur = Math.min(cur + step, target);
        el.textContent = cur;
        if (cur >= target) clearInterval(iv);
    }, 30);
}


/* ══════════════════════════════════════════════════════════════
   BANDWIDTH CHART (SVG)
   ══════════════════════════════════════════════════════════════ */

function renderBwChart() {
    const svg = document.getElementById('bw-svg');
    const W = 600, H = 140, PAD = 10;
    const hours = Array.from({ length: 12 }, (_, i) => `${(new Date().getHours() - 11 + i + 24) % 24}:00`);
    const dl = Array.from({ length: 12 }, () => randInt(20, 95));
    const ul = Array.from({ length: 12 }, () => randInt(5, 40));
    const maxV = 100;

    function buildPaths(data, stroke, fill) {
        const points = data.map((v, i) => {
            const x = PAD + (i / 11) * (W - PAD * 2);
            const y = H - PAD - (v / maxV) * (H - PAD * 2);
            return `${x},${y}`;
        }).join(' ');

        const x0 = PAD, xN = W - PAD;
        const y0 = H - PAD - (data[0] / maxV) * (H - PAD * 2);
        const yN = H - PAD - (data[data.length - 1] / maxV) * (H - PAD * 2);
        const fillPts = `${x0},${H - PAD} ${points} ${xN},${H - PAD}`;

        return `
      <polygon points="${fillPts}" fill="${fill}" opacity="0.12"/>
      <polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round"/>`;
    }

    let grid = '';
    for (let i = 0; i <= 4; i++) {
        const y = PAD + (i / 4) * (H - PAD * 2);
        grid += `<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
        grid += `<text x="${PAD}" y="${y - 3}" font-size="9" fill="rgba(255,255,255,0.25)" font-family="DM Sans">${100 - i * 25}</text>`;
    }

    let xlabels = '';
    hours.forEach((h, i) => {
        if (i % 2 === 0) {
            const x = PAD + (i / 11) * (W - PAD * 2);
            xlabels += `<text x="${x}" y="${H - 1}" font-size="9" fill="rgba(255,255,255,0.25)" font-family="DM Sans" text-anchor="middle">${escapeHtml(h)}</text>`;
        }
    });

    svg.innerHTML = grid + buildPaths(dl, '#00D2FF', '#00D2FF') + buildPaths(ul, '#6655FF', '#6655FF') + xlabels;
}


/* ══════════════════════════════════════════════════════════════
   AUTH DISTRIBUTION
   ══════════════════════════════════════════════════════════════ */

function renderDist() {
    const counts = AUTH_TYPES.reduce((acc, t) => { acc[t] = 0; return acc; }, {});
    users.forEach(u => counts[u.auth]++);
    const total = users.length;

    const keys = [
        { id: 'id', type: 'SA ID' },
        { id: 'email', type: 'Email' },
        { id: 'phone', type: 'Phone OTP' },
        { id: 'social', type: ['Google', 'Guest'] },
    ];
    keys.forEach(k => {
        const cnt = Array.isArray(k.type)
            ? k.type.reduce((s, t) => s + (counts[t] || 0), 0)
            : (counts[k.type] || 0);
        const pct = total > 0 ? Math.round(cnt / total * 100) : 0;
        document.getElementById(`dist-${k.id}`).textContent = pct + '%';
        document.getElementById(`fill-${k.id}`).style.width = pct + '%';
    });
}


/* ══════════════════════════════════════════════════════════════
   RECENT ACTIVITY
   ══════════════════════════════════════════════════════════════ */

const EVT_BADGES = {
    connect: `<span class="badge badge-green"><span class="dot"></span>Connected</span>`,
    disconnect: `<span class="badge badge-gray">Disconnected</span>`,
    blocked: `<span class="badge badge-red">Blocked</span>`,
    failed: `<span class="badge badge-yellow">Auth Failed</span>`,
    data_limit: `<span class="badge badge-yellow">Data Limit</span>`,
};

function renderRecentActivity() {
    const tbody = document.getElementById('recent-activity-tbody');
    tbody.innerHTML = logs.slice(0, 10).map(l => `
    <tr>
      <td style="color:var(--light);font-size:0.78rem;">${escapeHtml(fmtTime(l.time))}</td>
      <td>${escapeHtml(l.user)}</td>
      <td>${EVT_BADGES[l.event] || `<span class="badge badge-gray">${escapeHtml(l.event)}</span>`}</td>
      <td style="font-family:monospace;font-size:0.8rem;color:var(--light);">${escapeHtml(l.ip)}</td>
      <td><span class="badge badge-blue">${escapeHtml(l.auth)}</span></td>
    </tr>
  `).join('');
}


/* ══════════════════════════════════════════════════════════════
   USERS TABLE
   ══════════════════════════════════════════════════════════════ */

function renderUsersTable(data) {
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = data.map(u => {
        const statusBadge = u.status === 'active'
            ? `<span class="badge badge-green"><span class="dot"></span>Active</span>`
            : u.status === 'idle'
                ? `<span class="badge badge-yellow">Idle</span>`
                : `<span class="badge badge-red">Blocked</span>`;

        const blockBtn = u.status === 'blocked'
            ? `<button class="btn-sm btn-sm-success" data-action="unblock" data-id="${u.id}">Unblock</button>`
            : `<button class="btn-sm btn-sm-danger"  data-action="block"   data-id="${u.id}">Block</button>`;

        return `
      <tr id="user-row-${u.id}" class="${u.status === 'blocked' ? 'blocked' : ''}">
        <td>
          <div class="user-cell">
            <div class="user-av" style="background:${escapeHtml(u.avatar)};color:#000;">${escapeHtml(u.initials)}</div>
            <div>
              <div style="font-weight:600;font-size:0.85rem;">${escapeHtml(u.name)}</div>
              <div style="font-size:0.72rem;color:var(--light);">${escapeHtml(u.email)}</div>
            </div>
          </div>
        </td>
        <td><span class="badge badge-blue">${escapeHtml(u.auth)}</span></td>
        <td style="font-family:monospace;font-size:0.78rem;color:var(--light);">${escapeHtml(u.ip)}</td>
        <td style="font-size:0.8rem;color:var(--light);">${escapeHtml(u.device)}</td>
        <td style="font-size:0.8rem;color:var(--light);">${escapeHtml(fmtDuration(u.duration))}</td>
        <td>${statusBadge}</td>
        <td>
          <div class="action-cell">
            ${blockBtn}
            <button class="btn-sm btn-sm-warn" data-action="kick" data-id="${u.id}" ${u.status === 'blocked' ? 'disabled' : ''}>Kick</button>
          </div>
        </td>
      </tr>`;
    }).join('');
}

// Delegated click handler — avoids per-row inline event handlers
document.getElementById('users-tbody').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    const uid = parseInt(id, 10);
    if (action === 'block') blockUser(uid);
    if (action === 'unblock') unblockUser(uid);
    if (action === 'kick') kickUser(uid);
});

function filterUsers() {
    const q = document.getElementById('user-search').value.toLowerCase();
    const fil = document.getElementById('user-filter').value;
    const filtered = users.filter(u => {
        const match = u.name.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q) ||
            u.ip.includes(q) ||
            u.auth.toLowerCase().includes(q);
        return match && (fil === 'all' || u.status === fil);
    });
    renderUsersTable(filtered);
}

document.getElementById('user-search').addEventListener('input', filterUsers);
document.getElementById('user-filter').addEventListener('change', filterUsers);

function blockUser(id) {
    showConfirm(
        'Block User',
        "Block this user from the network? They won't be able to reconnect until manually unblocked.",
        () => {
            const u = users.find(u => u.id === id);
            if (!u) return;
            u.status = 'blocked';
            logs.unshift({ time: new Date(), user: u.name, event: 'blocked', ip: u.ip, auth: u.auth, detail: 'Admin blocked' });
            renderUsersTable(users);
            renderLogsTable(logs);
            updateStats();
            document.getElementById('nav-badge').textContent = users.filter(u => u.status === 'active').length;
            toast(`${u.name} has been blocked`, 'warn');
        }, true
    );
}

function unblockUser(id) {
    const u = users.find(u => u.id === id);
    if (!u) return;
    u.status = 'active';
    logs.unshift({ time: new Date(), user: u.name, event: 'connect', ip: u.ip, auth: u.auth, detail: 'Admin unblocked' });
    renderUsersTable(users);
    renderLogsTable(logs);
    updateStats();
    document.getElementById('nav-badge').textContent = users.filter(u => u.status === 'active').length;
    toast(`${u.name} has been unblocked`, 'success');
}

function kickUser(id) {
    showConfirm('Kick User', 'Disconnect this user from the network? They can reconnect.', () => {
        const u = users.find(u => u.id === id);
        if (!u) return;
        u.status = 'idle';
        logs.unshift({ time: new Date(), user: u.name, event: 'disconnect', ip: u.ip, auth: u.auth, detail: 'Admin kicked' });
        renderUsersTable(users);
        renderLogsTable(logs);
        toast(`${u.name} has been kicked`, 'info');
    }, true);
}

document.getElementById('block-all-btn').addEventListener('click', () => {
    const activeCount = users.filter(u => u.status === 'active').length;
    showConfirm(
        'Block All Active Users',
        `This will block all ${activeCount} currently active user${activeCount !== 1 ? 's' : ''} from the network.`,
        () => {
            users.forEach(u => { if (u.status === 'active') u.status = 'blocked'; });
            renderUsersTable(users);
            updateStats();
            document.getElementById('nav-badge').textContent = 0;
            toast('All active users have been blocked', 'warn');
        }, true
    );
});


/* ══════════════════════════════════════════════════════════════
   BANDWIDTH TABLE
   ══════════════════════════════════════════════════════════════ */

function renderBwTable() {
    const sorted = [...users].sort((a, b) => parseFloat(b.dl) - parseFloat(a.dl));
    const max = parseFloat(sorted[0]?.dl || 1);
    document.getElementById('bw-table-body').innerHTML = sorted.map((u, i) => {
        const pct = Math.round(parseFloat(u.dl) / max * 100);
        return `
      <tr>
        <td style="color:var(--muted);font-weight:700;">${i + 1}</td>
        <td>
          <div class="user-cell">
            <div class="user-av" style="background:${escapeHtml(u.avatar)};color:#000;font-size:0.7rem;">${escapeHtml(u.initials)}</div>
            ${escapeHtml(u.name)}
          </div>
        </td>
        <td><span class="badge badge-blue">${escapeHtml(u.auth)}</span></td>
        <td style="color:var(--accent);font-weight:600;">${escapeHtml(u.dl)} MB</td>
        <td style="color:#6655FF;font-weight:600;">${escapeHtml(u.ul)} MB</td>
        <td><div class="bw-bar-wrap"><div class="bw-bar-fill" style="width:${pct}%"></div></div></td>
        <td style="color:var(--light);">${escapeHtml(fmtDuration(u.duration))}</td>
      </tr>`;
    }).join('');
}


/* ══════════════════════════════════════════════════════════════
   LOGS TABLE
   ══════════════════════════════════════════════════════════════ */

const EVT_COLORS = {
    connect: '#00E87A',
    disconnect: '#6A7D98',
    blocked: '#FF3B5C',
    failed: '#FFB020',
    data_limit: '#FFB020',
};

function renderLogsTable(data) {
    document.getElementById('logs-tbody').innerHTML = data.map(l => {
        const col = EVT_COLORS[l.event] || '#6A7D98';
        const evtLabel = l.event.replace('_', ' ').toUpperCase();
        return `
      <tr>
        <td style="font-family:monospace;font-size:0.78rem;color:var(--light);white-space:nowrap;">
          ${escapeHtml(l.time.toLocaleDateString())} ${escapeHtml(fmtTime(l.time))}
        </td>
        <td style="font-weight:500;">${escapeHtml(l.user)}</td>
        <td>
          <span class="log-type" style="background:${col}18;color:${col};border:1px solid ${col}30;">
            ${escapeHtml(evtLabel)}
          </span>
        </td>
        <td style="font-family:monospace;font-size:0.78rem;color:var(--light);">${escapeHtml(l.ip)}</td>
        <td><span class="badge badge-blue">${escapeHtml(l.auth)}</span></td>
        <td style="font-size:0.78rem;color:var(--light);">${escapeHtml(l.detail)}</td>
      </tr>`;
    }).join('');
}

function filterLogs() {
    const q = document.getElementById('log-search').value.toLowerCase();
    const fil = document.getElementById('log-filter').value;
    const filtered = logs.filter(l => {
        const match = l.user.toLowerCase().includes(q) ||
            l.ip.includes(q) ||
            l.detail.toLowerCase().includes(q);
        return match && (fil === 'all' || l.event === fil);
    });
    renderLogsTable(filtered);
}

document.getElementById('log-search').addEventListener('input', filterLogs);
document.getElementById('log-filter').addEventListener('change', filterLogs);

document.getElementById('clear-logs-btn').addEventListener('click', () => {
    showConfirm(
        'Clear Session Logs',
        'This will permanently delete all log history. This action cannot be undone.',
        () => {
            logs = [];
            renderLogsTable([]);
            renderRecentActivity();
            toast('Logs cleared', 'warn');
        }, true
    );
});


/* ══════════════════════════════════════════════════════════════
   EXPORT (CSV download)
   ══════════════════════════════════════════════════════════════ */

function download(filename, data) {
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(data);
    a.download = filename;
    a.click();
}

document.getElementById('export-users-btn').addEventListener('click', () => {
    const headers = 'Name,Email,Auth,IP,Device,Status,Duration\n';
    const rows = users.map(u =>
        `"${u.name}","${u.email}","${u.auth}","${u.ip}","${u.device}","${u.status}","${fmtDuration(u.duration)}"`
    ).join('\n');
    download('ets-users.csv', headers + rows);
    toast('Users exported to CSV', 'success');
});

document.getElementById('export-logs-btn').addEventListener('click', () => {
    const headers = 'Timestamp,User,Event,IP,Auth,Detail\n';
    const rows = logs.map(l =>
        `"${l.time.toISOString()}","${l.user}","${l.event}","${l.ip}","${l.auth}","${l.detail}"`
    ).join('\n');
    download('ets-logs.csv', headers + rows);
    toast('Logs exported to CSV', 'success');
});


/* ══════════════════════════════════════════════════════════════
   SETTINGS — toggle buttons & action buttons
   ══════════════════════════════════════════════════════════════ */

document.querySelectorAll('.toggle').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('on'));
});

document.getElementById('apply-ip-block-btn').addEventListener('click', () => {
    const raw = document.getElementById('blocked-ip-textarea').value.trim();
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    // Basic IP / CIDR validation
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
    const invalid = lines.filter(l => !ipRegex.test(l));
    if (invalid.length) {
        toast(`Invalid entry: ${invalid[0]}`, 'warn');
        return;
    }
    toast(`${lines.length} IP rule${lines.length !== 1 ? 's' : ''} applied`, 'warn');
});

document.getElementById('save-settings-btn').addEventListener('click', () => {
    toast('Settings saved successfully', 'success');
});

document.getElementById('reset-settings-btn').addEventListener('click', () => {
    showConfirm('Reset Settings', 'Reset all settings to their default values?', () => {
        toast('Settings reset to defaults', 'info');
    }, false);
});


/* ══════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ══════════════════════════════════════════════════════════════ */

const TOAST_ICONS = {
    success: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E87A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    warn: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFB020" stroke-width="2.5" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00D2FF" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
};

function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = 'toast-msg';
    // Icon is controlled SVG; msg is escaped
    el.innerHTML = (TOAST_ICONS[type] || TOAST_ICONS.info) + `<span>${escapeHtml(msg)}</span>`;
    document.getElementById('toast').appendChild(el);
    setTimeout(() => el.remove(), 3500);
}


/* ══════════════════════════════════════════════════════════════
   CONFIRM MODAL
   ══════════════════════════════════════════════════════════════ */

function showConfirm(title, body, cb, danger = true) {
    confirmCb = cb;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-body').textContent = body;
    const btn = document.getElementById('confirm-ok-btn');
    btn.textContent = 'Confirm';
    btn.className = danger ? 'confirm-ok' : 'confirm-ok warn';
    document.getElementById('confirm-modal').classList.add('show');
}

function closeConfirm() {
    document.getElementById('confirm-modal').classList.remove('show');
    confirmCb = null;
}

function confirmAction() {
    if (confirmCb) confirmCb();
    closeConfirm();
}

document.getElementById('confirm-cancel-btn').addEventListener('click', closeConfirm);
document.getElementById('confirm-ok-btn').addEventListener('click', confirmAction);

// Close modal on backdrop click
document.getElementById('confirm-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeConfirm();
});


/* ══════════════════════════════════════════════════════════════
   SHARED UI HELPERS
   ══════════════════════════════════════════════════════════════ */

function setLoading(btn, active) {
    btn.classList.toggle('loading', active);
    btn.disabled = active;
}

function setFeedback(el, message, type) {
    if (!el) return;
    el.textContent = message;
    el.className = `input-feedback${type ? ` ${type}` : ''}`;
}