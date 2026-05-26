'use strict';

let dataUsageChart = null;
let authMethodChart = null;
let currentRole = 'admin';
let currentUsername = '';

// ================================================================
// NAVIGATION
// ================================================================
const SECTION_TITLES = {
    overview: ['Overview', 'Real-time network monitoring'],
    users: ['Users', 'Manage registered users'],
    sessions: ['Sessions', 'Active and past connections'],
    devices: ['Devices', 'Registered MAC addresses'],
    logs: ['Audit Logs', 'Full network event history'],
    plans: ['Plans', 'Connection packages'],
    grand: ['Grand Admin', 'Full decryption view'],
};

document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', () => {
        const id = item.dataset.section;
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        item.classList.add('active');
        document.getElementById(`section-${id}`).classList.add('active');
        const [title, sub] = SECTION_TITLES[id] || ['', ''];
        document.getElementById('section-title').textContent = title;
        document.getElementById('section-sub').textContent = sub;
        loadSection(id);
    });
});

function loadSection(id) {
    if (id === 'overview') loadOverview();
    if (id === 'users') loadUsers();
    if (id === 'sessions') loadSessions();
    if (id === 'devices') loadDevices();
    if (id === 'logs') loadLogs();
    if (id === 'plans') loadPlans();
    if (id === 'grand') loadGrand();
}

document.getElementById('refresh-btn')?.addEventListener('click', () => {
    const active = document.querySelector('.nav-item.active')?.dataset.section || 'overview';
    loadSection(active);
    Toast.success('Refreshed.');
});

// ================================================================
// LOGIN
// ================================================================
document.getElementById('admin-login-btn')?.addEventListener('click', async function () {
    const username = document.getElementById('admin-user').value.trim();
    const password = document.getElementById('admin-pw').value;
    const errorEl = document.getElementById('login-error');

    errorEl.style.display = 'none';

    if (!username) { showFieldError('admin-user', 'admin-user-fb', 'Username is required.'); return; }
    if (!password) { showFieldError('admin-pw', 'admin-pw-fb', 'Password is required.'); return; }

    setLoading(this, true);
    try {
        const data = await API.post('/auth/admin/login', { username, password });
        API.saveAuth(data);
        currentRole = data.role;
        currentUsername = username;

        // Update sidebar
        document.getElementById('sidebar-role').textContent = data.role === 'grand_admin' ? 'Grand Admin' : 'Admin';
        document.getElementById('sidebar-username').textContent = username;
        document.getElementById('sidebar-avatar').textContent = username.slice(0, 2).toUpperCase();

        // Show Grand Admin nav item if applicable
        if (data.role === 'grand_admin') {
            document.querySelectorAll('.ga-only').forEach(el => el.style.display = 'flex');
        }

        document.getElementById('login-gate').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        loadOverview();
        Toast.success(`Welcome back, ${username}`);
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
        // Shake the card
        const card = document.querySelector('.login-card');
        card.style.animation = 'none';
        requestAnimationFrame(() => {
            card.style.animation = 'shake 0.4s ease';
        });
    } finally {
        setLoading(this, false);
    }
});

// Allow Enter key on login fields
['admin-user', 'admin-pw'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('admin-login-btn').click();
    });
});

document.getElementById('logout-btn')?.addEventListener('click', async () => {
    const ok = await Modal.confirm('Sign Out', 'Sign out of the admin dashboard?', false);
    if (!ok) return;
    API.clearAuth();
    document.getElementById('app').style.display = 'none';
    document.getElementById('login-gate').style.display = 'flex';
    document.getElementById('admin-user').value = '';
    document.getElementById('admin-pw').value = '';
    document.getElementById('login-error').style.display = 'none';
    Toast.info('Signed out.');
});

// ================================================================
// CHARTS
// ================================================================
async function buildCharts() {
    try {
        const [statsData, sessionsData] = await Promise.all([
            API.get('/admin/stats'),
            API.get('/admin/sessions?status=all&limit=50'),
        ]);

        buildDataUsageChart(sessionsData.sessions || []);
        buildAuthMethodChart(statsData.authBreakdown || []);
    } catch (err) {
        console.warn('Charts failed to load:', err.message);
    }
}

function buildDataUsageChart(sessions) {
    const ctx = document.getElementById('chart-data-usage');
    if (!ctx) return;

    const recent = sessions.slice(0, 10).reverse();
    const labels = recent.map((s, i) => `Session ${i + 1}`);
    const used = recent.map(s => parseFloat(s.data_used_mb || 0).toFixed(1));
    const limit = recent.map(s => parseFloat(s.data_limit_mb || 0).toFixed(1));

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
    const labelColor = isDark ? '#6a7d98' : '#4a5a78';
    const limitBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)';
    const limitBorder = isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.25)';

    // If all used values are 0, show a minimum bar so chart is visible
    const usedDisplay = used.map(v => parseFloat(v) === 0 ? 0.1 : v);

    if (dataUsageChart) dataUsageChart.destroy();

    dataUsageChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Used (MB)',
                    data: usedDisplay,
                    backgroundColor: 'rgba(0,210,255,0.75)',
                    borderColor: 'rgba(0,210,255,1)',
                    borderWidth: 1,
                    borderRadius: 4,
                },
                {
                    label: 'Limit (MB)',
                    data: limit,
                    backgroundColor: limitBg,
                    borderColor: limitBorder,
                    borderWidth: 1,
                    borderRadius: 4,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    labels: { color: labelColor, font: { family: 'DM Sans', size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const val = parseFloat(ctx.raw);
                            return `${ctx.dataset.label}: ${val < 0.5 ? '0' : val} MB`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: labelColor, font: { size: 10 } },
                    grid: { color: gridColor },
                },
                y: {
                    ticks: { color: labelColor, font: { size: 10 } },
                    grid: { color: gridColor },
                    beginAtZero: true,
                },
            },
        },
    });
}

function buildAuthMethodChart(breakdown) {
    const ctx = document.getElementById('chart-auth-methods');
    if (!ctx) return;

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const labelColor = isDark ? '#6a7d98' : '#4a5a78';

    const labels = breakdown.map(b => b.auth_method);
    const counts = breakdown.map(b => b.count);
    const colors = ['#00d2ff', '#6655ff', '#00e87a', '#ffb020', '#ff3b5c'];

    if (authMethodChart) authMethodChart.destroy();

    authMethodChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: counts,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: isDark ? '#0b1220' : '#ffffff',
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: labelColor,
                        font: { family: 'DM Sans', size: 11 },
                        padding: 12,
                        boxWidth: 12,
                    },
                },
            },
        },
    });
}

// ================================================================
// OVERVIEW
// ================================================================
async function loadOverview() {
    try {
        buildCharts();
        const data = await API.get('/admin/stats');
        document.getElementById('stat-total').textContent = data.totalUsers;
        document.getElementById('stat-active').textContent = data.activeUsers;
        document.getElementById('stat-blocked').textContent = data.blockedUsers;
        document.getElementById('stat-data').textContent = data.dataUsedGb + ' GB';
        document.getElementById('nav-user-count').textContent = data.totalUsers;

        const tbody = document.getElementById('recent-logs-tbody');
        if (!data.recentLogs?.length) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:20px;">No activity yet</td></tr>`;
            return;
        }
        tbody.innerHTML = data.recentLogs.map(l => `
      <tr>
        <td style="color:var(--muted);font-size:0.78rem;white-space:nowrap;">
          ${escapeHtml(new Date(l.created_at).toLocaleTimeString())}
        </td>
        <td>${eventBadge(l.event_type)}</td>
        <td style="font-size:0.8rem;color:var(--muted);">
          ${escapeHtml(formatDetail(l.detail, l.event_type) || '-')}
        </td>
      </tr>`).join('');
    } catch (err) {
        Toast.error('Failed to load overview: ' + err.message);
    }
}

// ================================================================
// USERS
// ================================================================
let allUsers = [];

async function loadUsers() {
    try {
        const status = document.getElementById('user-status-filter').value;
        const data = await API.get(`/admin/users?status=${status}&limit=100`);
        allUsers = data.users || [];
        renderUsers(allUsers);
    } catch (err) {
        Toast.error('Failed to load users: ' + err.message);
    }
}

function renderUsers(users) {
    const tbody = document.getElementById('users-tbody');
    if (!users.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px;">No users found</td></tr>`;
        return;
    }
    tbody.innerHTML = users.map(u => `
    <tr class="${u.status === 'blocked' ? 'blocked' : ''}">
      <td>
        <div style="font-weight:600;">${escapeHtml(u.fullName || '—')}</div>
        <div style="font-size:0.75rem;color:var(--muted);">${escapeHtml(u.email || u.phone || '—')}</div>
      </td>
      <td><span class="badge badge-blue">${escapeHtml(u.authMethod)}</span></td>
      <td>${statusBadge(u.status)}</td>
      <td style="color:var(--muted);font-size:0.82rem;">Plan ${u.planId || '—'}</td>
      <td style="color:var(--muted);font-size:0.78rem;white-space:nowrap;">
        ${escapeHtml(new Date(u.createdAt).toLocaleDateString())}
      </td>
      <td>
        <div style="display:flex;gap:6px;">
          ${u.status === 'blocked'
            ? `<button class="btn btn-sm btn-success" onclick="unblockUser(${u.id})">Unblock</button>`
            : `<button class="btn btn-sm btn-danger"  onclick="blockUser(${u.id})">Block</button>`
        }
        </div>
      </td>
    </tr>`).join('');
}

document.getElementById('user-search')?.addEventListener('input', function () {
    const q = this.value.toLowerCase();
    const filtered = allUsers.filter(u =>
        (u.fullName || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q)
    );
    renderUsers(filtered);
});

document.getElementById('user-status-filter')?.addEventListener('change', loadUsers);

async function blockUser(id) {
    const ok = await Modal.confirm('Block User',
        'Block this user? They will lose network access immediately.', true);
    if (!ok) return;
    try {
        await API.post(`/admin/users/${id}/block`, { reason: 'Blocked by admin' });
        Toast.warn('User blocked.');
        loadUsers();
        loadOverview();
    } catch (err) {
        Toast.error(err.message);
    }
}

async function unblockUser(id) {
    try {
        await API.post(`/admin/users/${id}/unblock`);
        Toast.success('User unblocked.');
        loadUsers();
        loadOverview();
    } catch (err) { Toast.error(err.message); }
}

// ================================================================
// SESSIONS
// ================================================================
async function loadSessions() {
    try {
        const status = document.getElementById('session-status-filter').value;
        const data = await API.get(`/admin/sessions?status=${status}`);
        const tbody = document.getElementById('sessions-tbody');
        const sessions = data.sessions || [];

        if (!sessions.length) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px;">No sessions found</td></tr>`;
            return;
        }

        tbody.innerHTML = sessions.map(s => {
            const pct = s.data_limit_mb > 0
                ? Math.min(100, (s.data_used_mb / s.data_limit_mb) * 100).toFixed(0)
                : 0;
            const cls = pct < 70 ? 'ok' : pct < 90 ? 'warn' : 'danger';
            return `
        <tr>
          <td style="font-size:0.82rem;">User ${s.user_id}</td>
          <td style="font-size:0.78rem;color:var(--muted);">${escapeHtml(s.plan_name || '—')}</td>
          <td style="font-size:0.82rem;">${parseFloat(s.data_used_mb).toFixed(1)} MB</td>
          <td style="font-size:0.82rem;">${parseFloat(s.data_limit_mb).toFixed(0)} MB</td>
          <td style="min-width:80px;">
            <div class="usage-bar-wrap">
              <div class="usage-bar-fill ${cls}" style="width:${pct}%"></div>
            </div>
            <div style="font-size:0.68rem;color:var(--muted);margin-top:2px;">${pct}%</div>
          </td>
          <td style="font-size:0.78rem;color:var(--muted);">#${s.period_number || 1}</td>
          <td>${statusBadge(s.status)}</td>
          <td>
            ${s.status === 'active'
                    ? `<button class="btn btn-sm btn-danger"
                         onclick="disconnectSession(${s.id})">Kick</button>`
                    : '—'}
          </td>
        </tr>`;
        }).join('');
    } catch (err) {
        Toast.error('Failed to load sessions: ' + err.message);
    }
}

document.getElementById('session-status-filter')?.addEventListener('change', loadSessions);

async function disconnectSession(id) {
    const ok = await Modal.confirm('Disconnect Session',
        'Kick this user off the network?', true);
    if (!ok) return;
    try {
        await API.post(`/admin/sessions/${id}/disconnect`);
        Toast.warn('Session disconnected.');
        loadSessions();
    } catch (err) { Toast.error(err.message); }
}

// ================================================================
// DEVICES
// ================================================================
async function loadDevices() {
    try {
        const data = await API.get('/admin/devices');
        const tbody = document.getElementById('devices-tbody');
        const devices = data.devices || [];

        if (!devices.length) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px;">No devices found</td></tr>`;
            return;
        }

        tbody.innerHTML = devices.map(d => `
      <tr class="${d.is_blocked ? 'blocked' : ''}">
        <td style="font-family:monospace;font-size:0.8rem;">
          #${d.id}
        </td>
        <td style="font-size:0.82rem;">User ${d.user_id || '—'}</td>
        <td style="font-size:0.78rem;color:var(--muted);">
          ${escapeHtml(new Date(d.first_seen).toLocaleDateString())}
        </td>
        <td style="font-size:0.78rem;color:var(--muted);">
          ${escapeHtml(new Date(d.last_seen).toLocaleDateString())}
        </td>
        <td>${d.is_blocked
                ? '<span class="badge badge-red">Blocked</span>'
                : '<span class="badge badge-green">Active</span>'}
        </td>
        <td>
          ${d.is_blocked
                ? `<button class="btn btn-sm btn-success"
                       onclick="unblockDevice(${d.id})">Unblock</button>`
                : `<button class="btn btn-sm btn-danger"
                       onclick="blockDevice(${d.id})">Block</button>`}
        </td>
      </tr>`).join('');
    } catch (err) {
        Toast.error('Failed to load devices: ' + err.message);
    }
}

async function blockDevice(id) {
    const ok = await Modal.confirm('Block Device',
        'Block this device? It will not be able to connect to the network.', true);
    if (!ok) return;
    try {
        await API.post(`/admin/devices/${id}/block`);
        Toast.warn('Device blocked.');
        loadDevices();
    } catch (err) { Toast.error(err.message); }
}

async function unblockDevice(id) {
    try {
        await API.post(`/admin/devices/${id}/unblock`);
        Toast.success('Device unblocked.');
        loadDevices();
    } catch (err) { Toast.error(err.message); }
}

// ================================================================
// LOGS
// ================================================================
async function loadLogs() {
    try {
        const eventType = document.getElementById('log-event-filter').value;
        const data = await API.get(`/admin/logs?eventType=${eventType}&limit=100`);
        const tbody = document.getElementById('logs-tbody');
        const logs = data.logs || [];

        if (!logs.length) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px;">No logs found</td></tr>`;
            return;
        }

        tbody.innerHTML = logs.map(l => `
      <tr>
        <td style="font-size:0.78rem;color:var(--muted);white-space:nowrap;">
          ${escapeHtml(new Date(l.created_at).toLocaleString())}
        </td>
        <td>${eventBadge(l.event_type)}</td>
        <td style="font-size:0.82rem;color:var(--muted);">
          ${l.user_id ? `User ${l.user_id}` : l.admin_id ? `Admin ${l.admin_id}` : '—'}
        </td>
        <td style="font-size:0.8rem;color:var(--muted);">
          ${escapeHtml(l.detail || '—')}
        </td>
      </tr>`).join('');
    } catch (err) {
        Toast.error('Failed to load logs: ' + err.message);
    }
}

document.getElementById('log-event-filter')?.addEventListener('change', loadLogs);

// ================================================================
// PLANS
// ================================================================
async function loadPlans() {
    try {
        const data = await API.get('/admin/plans');
        const tbody = document.getElementById('plans-tbody');
        const plans = data.plans || [];

        tbody.innerHTML = plans.map(p => `
      <tr>
        <td style="font-weight:600;">${escapeHtml(p.name)}</td>
        <td style="color:var(--muted);">${p.duration_hours}h</td>
        <td style="color:var(--muted);">${p.data_limit_mb} MB</td>
        <td>${p.is_active
                ? '<span class="badge badge-green">Active</span>'
                : '<span class="badge badge-gray">Inactive</span>'}
        </td>
      </tr>`).join('');
    } catch (err) {
        Toast.error('Failed to load plans: ' + err.message);
    }
}

// ================================================================
// GRAND ADMIN
// ================================================================
async function loadGrand() {
    if (currentRole !== 'grand_admin') {
        Toast.error('Grand Admin access required.');
        return;
    }
    try {
        const data = await API.get('/grand/users');
        const tbody = document.getElementById('grand-users-tbody');
        const users = data.users || [];

        if (!users.length) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px;">No users found</td></tr>`;
            return;
        }

        tbody.innerHTML = users.map(u => `
      <tr>
        <td style="color:var(--muted);">${u.id}</td>
        <td style="font-weight:600;">${escapeHtml(u.fullName || '—')}</td>
        <td style="font-size:0.82rem;">${escapeHtml(u.email || '—')}</td>
        <td style="font-size:0.82rem;">${escapeHtml(u.phone || '—')}</td>
        <td style="font-family:monospace;font-size:0.78rem;color:var(--warning);">
          ${escapeHtml(u.saId || '—')}
        </td>
        <td><span class="badge badge-blue">${escapeHtml(u.authMethod)}</span></td>
        <td>${statusBadge(u.status)}</td>
      </tr>`).join('');
    } catch (err) {
        Toast.error('Failed to load Grand Admin data: ' + err.message);
    }
}

// ================================================================
// BADGE HELPERS
// ================================================================
function statusBadge(status) {
    const map = {
        active: 'badge-green',
        blocked: 'badge-red',
        disconnected: 'badge-gray',
        data_exhausted: 'badge-yellow',
        idle: 'badge-yellow',
    };
    const cls = map[status] || 'badge-gray';
    const dot = status === 'active' ? '<span class="dot"></span>' : '';
    return `<span class="badge ${cls}">${dot}${escapeHtml(status || 'unknown')}</span>`;
}

function formatDetail(detail, eventType) {
    if (!detail) return '—';
    try {
        const d = typeof detail === 'string' ? JSON.parse(detail) : detail;
        if (d.adminId) return `Admin #${d.adminId}`;
        if (d.method) return `via ${d.method}`;
        if (d.userId) return `User #${d.userId}`;
        if (d.planId) return `Plan #${d.planId}`;
        return JSON.stringify(d);
    } catch {
        return String(detail);
    }
}

function eventBadge(type) {
    const map = {
        connect: 'badge-green',
        otp_verified: 'badge-green',
        failed_auth: 'badge-red',
        blocked: 'badge-red',
        unblocked: 'badge-blue',
        admin_login: 'badge-blue',
        period_reset: 'badge-yellow',
        data_exhausted: 'badge-yellow',
    };
    const cls = map[type] || 'badge-gray';
    return `<span class="badge ${cls}">${escapeHtml(type || '—')}</span>`;
}

// Shake animation for failed login
const style = document.createElement('style');
style.textContent = `
  @keyframes shake {
    0%,100% { transform:translateX(0); }
    20%      { transform:translateX(-8px); }
    40%      { transform:translateX(8px); }
    60%      { transform:translateX(-5px); }
    80%      { transform:translateX(5px); }
  }`;
document.head.appendChild(style);