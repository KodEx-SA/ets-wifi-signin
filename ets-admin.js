/* ========== Mock Data ========== */
const AVATARS = ['#00D2FF', '#6655FF', '#00E87A', '#FFB020', '#FF3B5C', '#FF6B9D', '#00D2C8'];
const DEVICES = ['Windows 11', 'macOS Sonoma', 'Android 14', 'iPhone iOS 17', 'Ubuntu 22', 'Chromebook'];
const AUTH_TYPES = ['SA ID', 'Email', 'Phone OTP', 'Google', 'Guest'];
const NAMES = ['Thabo Mokoena', 'Nomvula Dlamini', 'Sipho Nkosi', 'Lerato Sithole', 'Kwena Lekganyane', 'Fatima Mahomed', 'Bongani Zulu', 'Ayanda Cele', 'Pieter van der Merwe', 'Naledi Moyo', 'Kagiso Modise', 'Zanele Khumalo', 'Ruan Botha', 'Priya Naidoo', 'Tshepo Sefolo'];
const EMAILS = ['thabo@gmail.com', 'nomvula@work.co.za', 'sipho.nkosi@email.com', 'lerato.s@outlook.com', 'kwena@gmail.com', 'fatima.m@icloud.com', 'bongani@ymail.com', 'ayanda.c@gmail.com', 'pieter.vdm@company.co.za', 'naledi.m@webmail.co.za'];

let users = [];
let logs = [];
let confirmCb = null;

function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function randItem(arr) { return arr[randInt(0, arr.length - 1)]; }

function fmtTime(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function fmtDuration(mins) {
    const h = Math.floor(mins / 60), m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function randomIP() { return `192.168.${randInt(1, 5)}.${randInt(2, 250)}`; }

function generateUsers() {
    users = NAMES.map((name, i) => {
        const authIdx = randInt(0, AUTH_TYPES.length - 1);
        const blocked = i > 12;
        const idle = !blocked && i > 9;
        return {
            id: i + 1,
            name,
            email: EMAILS[i % EMAILS.length],
            auth: AUTH_TYPES[authIdx],
            ip: randomIP(),
            mac: [...Array(6)].map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(':').toUpperCase(),
            device: randItem(DEVICES),
            dl: (Math.random() * 800 + 50).toFixed(1),
            ul: (Math.random() * 200 + 10).toFixed(1),
            duration: randInt(5, 480),
            status: blocked ? 'blocked' : idle ? 'idle' : 'active',
            avatar: AVATARS[i % AVATARS.length],
            initials: name.split(' ').map(w => w[0]).join('').slice(0, 2),
            connectedAt: new Date(Date.now() - randInt(5, 480) * 60000)
        };
    });
}

const LOG_EVENTS = ['connect', 'disconnect', 'blocked', 'failed', 'data_limit'];
const LOG_DETAILS = {
    connect: ['Session started', 'Returning user auto-connected', 'New registration'],
    disconnect: ['Session timeout', 'User disconnected', 'Idle timeout'],
    blocked: ['Too many failed attempts', 'Admin blocked', 'Policy violation'],
    failed: ['Wrong password', 'Invalid OTP', 'ID verification failed'],
    data_limit: ['Soft limit reached (80%)', 'Hard cap enforced', 'Throttled to 1Mbps']
};

function generateLogs() {
    logs = [];
    const now = Date.now();
    for (let i = 0; i < 40; i++) {
        const evt = randItem(LOG_EVENTS);
        logs.push({
            time: new Date(now - randInt(0, 7200000)),
            user: randItem(NAMES),
            event: evt,
            ip: randomIP(),
            auth: randItem(AUTH_TYPES),
            detail: randItem(LOG_DETAILS[evt])
        });
    }
    logs.sort((a, b) => b.time - a.time);
}

/* ========== Admin Login ========== */
function adminLogin() {
    const u = document.getElementById('admin-user').value;
    const p = document.getElementById('admin-pw').value;
    if (!u || !p) { toast('Please enter credentials', 'warn'); return; }

    generateUsers();
    generateLogs();

    document.getElementById('login-gate').style.display = 'none';
    const app = document.getElementById('app');
    app.style.display = 'flex';

    setTimeout(() => {
        updateStats();
        renderBwChart();
        renderDist();
        renderRecentActivity();
        renderUsersTable(users);
        renderBwTable();
        renderLogsTable(logs);
        document.getElementById('nav-badge').textContent = users.filter(u => u.status === 'active').length;
    }, 50);
}

function logout() {
    showConfirm('Sign Out', 'Sign out of the admin dashboard?', () => {
        document.getElementById('app').style.display = 'none';
        document.getElementById('login-gate').style.display = 'flex';
    }, false);
}

/* ========== Stats ========== */
function updateStats() {
    const active = users.filter(u => u.status === 'active').length;
    const blocked = users.filter(u => u.status === 'blocked').length;
    const totalBW = users.reduce((s, u) => s + parseFloat(u.dl), 0);
    animateCount('stat-total', users.length);
    animateCount('stat-active', active);
    document.getElementById('stat-bw').textContent = (totalBW / 1024).toFixed(1) + ' GB';
    animateCount('stat-blocked', blocked);
    document.getElementById('stat-total-change').textContent = `↑ ${randInt(2, 8)} this session`;
    document.getElementById('stat-blocked-change').textContent = blocked > 0 ? `${blocked} pending review` : '— No blocked users';
    document.getElementById('users-count-label').textContent = `${users.length} registered — ${active} active now`;
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

/* ========== Bandwidth SVG Chart ========== */
function renderBwChart() {
    const svg = document.getElementById('bw-svg');
    const W = 600, H = 140, PAD = 10;
    const hours = Array.from({ length: 12 }, (_, i) => `${(new Date().getHours() - 11 + i + 24) % 24}:00`);
    const dl = Array.from({ length: 12 }, () => randInt(20, 95));
    const ul = Array.from({ length: 12 }, () => randInt(5, 40));
    const maxV = 100;

    const pts = (data, color, fill) => {
        const pts = data.map((v, i) => {
            const x = PAD + (i / 11) * (W - PAD * 2);
            const y = H - PAD - (v / maxV) * (H - PAD * 2);
            return `${x},${y}`;
        }).join(' ');

        const first = data[0], last = data[data.length - 1];
        const x0 = PAD, xN = W - PAD;
        const y0 = H - PAD - (first / maxV) * (H - PAD * 2);
        const yN = H - PAD - (last / maxV) * (H - PAD * 2);
        const fillPts = `${x0},${H - PAD} ${pts} ${xN},${H - PAD}`;

        return `<polygon points="${fillPts}" fill="${fill}" opacity="0.12"/>
                <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    };

    // Grid lines
    let grid = '';
    for (let i = 0; i <= 4; i++) {
        const y = PAD + (i / 4) * (H - PAD * 2);
        grid += `<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
        grid += `<text x="${PAD}" y="${y - 3}" font-size="9" fill="rgba(255,255,255,0.25)" font-family="DM Sans">${100 - i * 25}</text>`;
    }

    // X labels
    let xlabels = '';
    hours.forEach((h, i) => {
        if (i % 2 === 0) {
            const x = PAD + (i / 11) * (W - PAD * 2);
            xlabels += `<text x="${x}" y="${H - 1}" font-size="9" fill="rgba(255,255,255,0.25)" font-family="DM Sans" text-anchor="middle">${h}</text>`;
        }
    });

    svg.innerHTML = grid + pts(dl, '#00D2FF', '#00D2FF') + pts(ul, '#6655FF', '#6655FF') + xlabels;
}

/* ========== Auth Distribution ========== */
function renderDist() {
    const counts = AUTH_TYPES.reduce((acc, t) => { acc[t] = 0; return acc; }, {});
    users.forEach(u => counts[u.auth]++);
    const total = users.length;
    const keys = [
        { id: 'id', name: 'SA ID', type: 'SA ID' },
        { id: 'email', name: 'Email', type: 'Email' },
        { id: 'phone', name: 'Phone OTP', type: 'Phone OTP' },
        { id: 'social', name: 'Social/Guest', type: ['Google', 'Guest'] }
    ];
    keys.forEach(k => {
        const cnt = Array.isArray(k.type) ? k.type.reduce((s, t) => s + (counts[t] || 0), 0) : (counts[k.type] || 0);
        const pct = total > 0 ? Math.round(cnt / total * 100) : 0;
        document.getElementById(`dist-${k.id}`).textContent = pct + '%';
        document.getElementById(`fill-${k.id}`).style.width = pct + '%';
    });
}

/* ========== Recent Activity ========== */
function renderRecentActivity() {
    const tbody = document.getElementById('recent-activity-tbody');
    const EVT_BADGES = {
        connect: '<span class="badge badge-green"><span class="dot"></span>Connected</span>',
        disconnect: '<span class="badge badge-gray">Disconnected</span>',
        blocked: '<span class="badge badge-red">Blocked</span>',
        failed: '<span class="badge badge-yellow">Auth Failed</span>',
        data_limit: '<span class="badge badge-yellow">Data Limit</span>'
    };
    tbody.innerHTML = logs.slice(0, 10).map(l => `
        <tr>
          <td style="color:var(--light);font-size:0.78rem;">${fmtTime(l.time)}</td>
          <td>${l.user}</td>
          <td>${EVT_BADGES[l.event] || `<span class="badge badge-gray">${l.event}</span>`}</td>
          <td style="font-family:monospace;font-size:0.8rem;color:var(--light);">${l.ip}</td>
          <td><span class="badge badge-blue">${l.auth}</span></td>
        </tr>
      `).join('');
}

/* ========== Users Table ========== */
function renderUsersTable(data) {
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = data.map(u => {
        const statusBadge = u.status === 'active'
            ? `<span class="badge badge-green"><span class="dot"></span>Active</span>`
            : u.status === 'idle'
                ? `<span class="badge badge-yellow">Idle</span>`
                : `<span class="badge badge-red">Blocked</span>`;
        const blockBtn = u.status === 'blocked'
            ? `<button class="btn-sm btn-sm-success" onclick="unblockUser(${u.id})">Unblock</button>`
            : `<button class="btn-sm btn-sm-danger" onclick="blockUser(${u.id})">Block</button>`;
        return `
          <tr id="user-row-${u.id}" class="${u.status === 'blocked' ? 'blocked' : ''}">
            <td>
              <div class="user-cell">
                <div class="user-av" style="background:${u.avatar};color:#000;">${u.initials}</div>
                <div>
                  <div style="font-weight:600;font-size:0.85rem;">${u.name}</div>
                  <div style="font-size:0.72rem;color:var(--light);">${u.email}</div>
                </div>
              </div>
            </td>
            <td><span class="badge badge-blue">${u.auth}</span></td>
            <td style="font-family:monospace;font-size:0.78rem;color:var(--light);">${u.ip}</td>
            <td style="font-size:0.8rem;color:var(--light);">${u.device}</td>
            <td style="font-size:0.8rem;color:var(--light);">${fmtDuration(u.duration)}</td>
            <td>${statusBadge}</td>
            <td>
              <div class="action-cell">
                ${blockBtn}
                <button class="btn-sm btn-sm-warn" onclick="kickUser(${u.id})" ${u.status === 'blocked' ? 'disabled' : ''}>Kick</button>
              </div>
            </td>
          </tr>`;
    }).join('');
}

function filterUsers() {
    const q = document.getElementById('user-search').value.toLowerCase();
    const fil = document.getElementById('user-filter').value;
    const filtered = users.filter(u => {
        const match = u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.ip.includes(q) || u.auth.toLowerCase().includes(q);
        const statusMatch = fil === 'all' || u.status === fil;
        return match && statusMatch;
    });
    renderUsersTable(filtered);
}

function blockUser(id) {
    showConfirm('Block User', `Block this user from the network? They won't be able to reconnect until manually unblocked.`, () => {
        const u = users.find(u => u.id === id);
        if (u) {
            u.status = 'blocked';
            logs.unshift({ time: new Date(), user: u.name, event: 'blocked', ip: u.ip, auth: u.auth, detail: 'Admin blocked' });
            renderUsersTable(users);
            renderLogsTable(logs);
            updateStats();
            document.getElementById('nav-badge').textContent = users.filter(u => u.status === 'active').length;
            toast(`${u.name} has been blocked`, 'warn');
        }
    }, true);
}

function unblockUser(id) {
    const u = users.find(u => u.id === id);
    if (u) {
        u.status = 'active';
        logs.unshift({ time: new Date(), user: u.name, event: 'connect', ip: u.ip, auth: u.auth, detail: 'Admin unblocked' });
        renderUsersTable(users);
        renderLogsTable(logs);
        updateStats();
        document.getElementById('nav-badge').textContent = users.filter(u => u.status === 'active').length;
        toast(`${u.name} has been unblocked`, 'success');
    }
}

function kickUser(id) {
    showConfirm('Kick User', 'Disconnect this user from the network? They can reconnect.', () => {
        const u = users.find(u => u.id === id);
        if (u) {
            u.status = 'idle';
            logs.unshift({ time: new Date(), user: u.name, event: 'disconnect', ip: u.ip, auth: u.auth, detail: 'Admin kicked' });
            renderUsersTable(users);
            renderLogsTable(logs);
            toast(`${u.name} has been kicked`, 'info');
        }
    }, true);
}

function blockAll() {
    showConfirm('Block All Active Users', 'This will block all currently active users from the network. This action affects ' + users.filter(u => u.status === 'active').length + ' users.', () => {
        users.forEach(u => { if (u.status === 'active') u.status = 'blocked'; });
        renderUsersTable(users);
        updateStats();
        document.getElementById('nav-badge').textContent = 0;
        toast('All active users have been blocked', 'warn');
    }, true);
}

/* ========== Bandwidth Table ========== */
function renderBwTable() {
    const sorted = [...users].sort((a, b) => parseFloat(b.dl) - parseFloat(a.dl));
    const max = parseFloat(sorted[0]?.dl || 1);
    document.getElementById('bw-table-body').innerHTML = sorted.map((u, i) => {
        const pct = Math.round(parseFloat(u.dl) / max * 100);
        return `<tr>
          <td style="color:var(--muted);font-weight:700;">${i + 1}</td>
          <td><div class="user-cell"><div class="user-av" style="background:${u.avatar};color:#000;font-size:0.7rem;">${u.initials}</div>${u.name}</div></td>
          <td><span class="badge badge-blue">${u.auth}</span></td>
          <td style="color:var(--accent);font-weight:600;">${u.dl} MB</td>
          <td style="color:#6655FF;font-weight:600;">${u.ul} MB</td>
          <td><div class="bw-bar-wrap"><div class="bw-bar-fill" style="width:${pct}%"></div></div></td>
          <td style="color:var(--light);">${fmtDuration(u.duration)}</td>
        </tr>`;
    }).join('');
}

/* ========== Logs Table ========== */
function renderLogsTable(data) {
    const EVT_COLORS = {
        connect: '#00E87A', disconnect: '#6A7D98',
        blocked: '#FF3B5C', failed: '#FFB020',
        data_limit: '#FFB020'
    };
    document.getElementById('logs-tbody').innerHTML = data.map(l => {
        const col = EVT_COLORS[l.event] || '#6A7D98';
        return `<tr>
          <td style="font-family:monospace;font-size:0.78rem;color:var(--light);white-space:nowrap;">${l.time.toLocaleDateString()} ${fmtTime(l.time)}</td>
          <td style="font-weight:500;">${l.user}</td>
          <td><span class="log-type" style="background:${col}18;color:${col};border:1px solid ${col}30;">${l.event.replace('_', ' ').toUpperCase()}</span></td>
          <td style="font-family:monospace;font-size:0.78rem;color:var(--light);">${l.ip}</td>
          <td><span class="badge badge-blue">${l.auth}</span></td>
          <td style="font-size:0.78rem;color:var(--light);">${l.detail}</td>
        </tr>`;
    }).join('');
}

function filterLogs() {
    const q = document.getElementById('log-search').value.toLowerCase();
    const fil = document.getElementById('log-filter').value;
    const filtered = logs.filter(l => {
        const match = l.user.toLowerCase().includes(q) || l.ip.includes(q) || l.detail.toLowerCase().includes(q);
        const typeMatch = fil === 'all' || l.event === fil;
        return match && typeMatch;
    });
    renderLogsTable(filtered);
}

/* ========== Navigation ========== */
const sectionTitles = {
    overview: ['Overview', 'Real-time network monitoring — ETS Campus'],
    bandwidth: ['Bandwidth', 'Usage analytics and traffic monitoring'],
    users: ['Connected Users', 'Manage and monitor all network users'],
    logs: ['Session Logs', 'Full network event history'],
    settings: ['Settings', 'Network and portal configuration']
};

function showSection(id, el) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('section-' + id).classList.add('active');
    el.classList.add('active');
    const [title, sub] = sectionTitles[id];
    document.getElementById('section-title').textContent = title;
    document.getElementById('section-sub').textContent = sub;
}

function refreshData() {
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
}

/* ========== Export (mock) ========== */
function exportUsers() {
    const headers = 'Name,Email,Auth,IP,Device,Status,Duration\n';
    const rows = users.map(u => `"${u.name}","${u.email}","${u.auth}","${u.ip}","${u.device}","${u.status}","${fmtDuration(u.duration)}"`).join('\n');
    download('ets-users.csv', headers + rows);
    toast('Users exported to CSV', 'success');
}

function exportLogs() {
    const headers = 'Timestamp,User,Event,IP,Auth,Detail\n';
    const rows = logs.map(l => `"${l.time.toISOString()}","${l.user}","${l.event}","${l.ip}","${l.auth}","${l.detail}"`).join('\n');
    download('ets-logs.csv', headers + rows);
    toast('Logs exported to CSV', 'success');
}

function clearLogs() {
    showConfirm('Clear Session Logs', 'This will permanently delete all log history. This action cannot be undone.', () => {
        logs = [];
        renderLogsTable([]);
        renderRecentActivity();
        toast('Logs cleared', 'warn');
    }, true);
}

function download(filename, data) {
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(data);
    a.download = filename;
    a.click();
}

/* ========== Toast ========== */
const TOAST_ICONS = {
    success: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E87A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    warn: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFB020" stroke-width="2.5" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00D2FF" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
};

function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = 'toast-msg';
    el.innerHTML = (TOAST_ICONS[type] || TOAST_ICONS.info) + `<span>${msg}</span>`;
    document.getElementById('toast').appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

/* ========== Confirm Modal ========== */
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

/* Enter key on login */
document.getElementById('admin-pw').addEventListener('keydown', e => {
    if (e.key === 'Enter') adminLogin();
});