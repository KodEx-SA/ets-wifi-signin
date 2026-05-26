'use strict';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let idMode = 'register';
let otpTimer = null;
let availablePlans = [];

// ================================================================
// CANVAS BACKGROUND
// ================================================================
(function () {
    const canvas = document.getElementById('bg-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W, H, nodes;

    function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
    }
    function makeNodes() {
        nodes = Array.from({ length: 55 }, () => ({
            x: Math.random() * W, y: Math.random() * H,
            vx: (Math.random() - 0.5) * 0.3,
            vy: (Math.random() - 0.5) * 0.3,
            r: Math.random() * 1.5 + 0.5,
        }));
    }
    function draw() {
        ctx.clearRect(0, 0, W, H);
        for (const n of nodes) {
            n.x += n.vx; n.y += n.vy;
            if (n.x < 0 || n.x > W) n.vx *= -1;
            if (n.y < 0 || n.y > H) n.vy *= -1;
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,210,255,0.4)';
            ctx.fill();
        }
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const dx = nodes[i].x - nodes[j].x;
                const dy = nodes[i].y - nodes[j].y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < 120) {
                    ctx.beginPath();
                    ctx.moveTo(nodes[i].x, nodes[i].y);
                    ctx.lineTo(nodes[j].x, nodes[j].y);
                    ctx.strokeStyle = `rgba(0,210,255,${0.15 * (1 - d / 120)})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }
        requestAnimationFrame(draw);
    }
    resize(); makeNodes(); draw();
    window.addEventListener('resize', () => { resize(); makeNodes(); });
})();

// ================================================================
// TAB SWITCHING
// ================================================================
document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
});

// ================================================================
// LOAD PLANS FROM API
// ================================================================
async function loadPlans() {
    try {
        const data = await API.get('/admin/plans');
        availablePlans = data.plans.filter(p => p.is_active);
    } catch {
        availablePlans = [
            { id: 1, name: 'Guest (30min / 50MB)' },
            { id: 2, name: 'Basic (1h / 200MB)' },
            { id: 3, name: 'Standard (4h / 500MB)' },
            { id: 4, name: 'Extended (8h / 1GB)' },
            { id: 5, name: 'Daily (24h / 3GB)' },
        ];
    }
    const html = availablePlans.map(p =>
        `<option value="${p.id}">${escapeHtml(p.name)}</option>`
    ).join('');
    document.querySelectorAll('select[id$="-plan"]').forEach(sel => {
        sel.innerHTML = html;
        const std = availablePlans.find(p => p.name.includes('Standard'));
        if (std) sel.value = std.id;
    });
}

// ================================================================
// SUCCESS STATE
// ================================================================
function showSuccess(containerId, data) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const plan = data.plan || {};
    el.innerHTML = `
    <div class="success-ring">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
           stroke="var(--success)" stroke-width="2.5" stroke-linecap="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </div>
    <h3>Access Granted</h3>
    <p>Connected to ETS WiFi.<br/>
       Plan: <strong>${escapeHtml(plan.name || 'Standard')}</strong><br/>
       Duration: <strong>${plan.durationHours}h</strong> &bull;
       Data: <strong>${plan.dataMb} MB</strong>
    </p>
    <div class="progress-bar-wrap"><div class="progress-bar-fill"></div></div>`;
    el.style.display = 'block';
    el.previousElementSibling.style.display = 'none';
    API.saveAuth(data);
    updateSessionWidget(data);
    document.getElementById('session-widget').style.display = 'block';
    startSessionWatcher();
}

// ================================================================
// SESSION WIDGET
// ================================================================
function updateSessionWidget(data) {
    const used = parseFloat(data.dataUsedMb ?? 0);
    const limit = parseFloat(data.dataLimitMb ?? data.plan?.dataMb ?? 0);
    const remaining = parseFloat(data.dataRemainingMb ?? limit - used);
    const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    set('sw-plan-name', data.plan?.name || data.planName || '');
    set('sw-used', used.toFixed(1));
    set('sw-remaining', remaining.toFixed(1));
    set('sw-period', data.periodNumber || 1);
    set('sw-limit-label', `${limit} MB limit`);

    const resetTime = data.periodEnd || data.expiresAt;
    if (resetTime) {
        const t = new Date(resetTime);
        set('sw-reset-time',
            `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`);
    }

    const bar = document.getElementById('sw-usage-bar');
    if (bar) {
        bar.style.width = pct + '%';
        bar.className = `usage-bar-fill ${pct < 70 ? 'ok' : pct < 90 ? 'warn' : 'danger'}`;
    }

    const ex = document.getElementById('sw-exhausted');
    if (ex) ex.style.display = data.status === 'data_exhausted' ? 'block' : 'none';
}

function startSessionWatcher() {
    setInterval(async () => {
        const token = API.getSessionToken();
        if (!token) return;
        try {
            const data = await fetch(`/api/auth/session?token=${token}`)
                .then(r => r.json());
            updateSessionWidget(data);
            if (data.status !== 'active') {
                Toast.warn('Your session status changed: ' + data.status);
            }
            if (data.periodReset) {
                Toast.info('Your data allowance has reset for the new period.');
            }
        } catch { }
    }, 30000);
}

document.getElementById('sw-disconnect-btn')?.addEventListener('click', async () => {
    const ok = await Modal.confirm('Disconnect', 'End your WiFi session?', false);
    if (!ok) return;
    await API.post('/auth/logout', { sessionToken: API.getSessionToken() }).catch(() => { });
    API.clearAuth();
    document.getElementById('session-widget').style.display = 'none';
    Toast.info('You have been disconnected.');
    setTimeout(() => location.reload(), 1500);
});

// ================================================================
// SA ID TAB
// ================================================================
const idInput = document.getElementById('id-number');
const idFb = document.getElementById('id-number-fb');
const idInfoBox = document.getElementById('id-info-box');
const idSubmit = document.getElementById('id-submit-btn');
const idBtnText = document.getElementById('id-btn-text');

function parseIdInfo(id) {
    const yy = id.slice(0, 2), mm = id.slice(2, 4), dd = id.slice(4, 6);
    const yyNum = parseInt(yy, 10);
    const cy = yyNum <= new Date().getFullYear() % 100 ? 2000 : 1900;
    const fullYear = cy + yyNum;
    const dob = new Date(`${fullYear}-${mm}-${dd}`);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    if (
        today.getMonth() < dob.getMonth() ||
        (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())
    ) age--;
    return {
        dob: `${dd} ${MONTHS[parseInt(mm, 10) - 1]} ${fullYear}`,
        gender: parseInt(id.slice(6, 10), 10) >= 5000 ? 'Male' : 'Female',
        citizen: id[10] === '0' ? 'SA Citizen' : 'Permanent Resident',
        age,
    };
}

function resetIdPanel() {
    idInput.classList.remove('valid', 'invalid');
    idInfoBox.classList.remove('show');
    setFeedback(idFb, '', '');
    document.getElementById('id-reg-fields').style.display = 'none';
    document.getElementById('id-signin-fields').style.display = 'none';
    document.getElementById('id-mode-toggle').style.display = 'none';
    idSubmit.disabled = true;
    idBtnText.textContent = 'Enter Valid ID Number';
}

idInput?.addEventListener('input', () => {
    idInput.value = idInput.value.replace(/\D/g, '');
    const val = idInput.value;
    resetIdPanel();
    if (!val) return;
    if (val.length < 13) {
        setFeedback(idFb, `${13 - val.length} more digit${13 - val.length !== 1 ? 's' : ''}`, 'info');
        return;
    }
    const r = Validator.saId(val);
    if (!r.valid) {
        idInput.classList.add('invalid');
        setFeedback(idFb, r.message, 'err');
        return;
    }
    idInput.classList.add('valid');
    setFeedback(idFb, '✓ Valid SA ID', 'ok');
    const info = parseIdInfo(val);
    document.getElementById('id-dob').textContent = info.dob;
    document.getElementById('id-gender').textContent = info.gender;
    document.getElementById('id-age').textContent = `${info.age} yrs`;
    document.getElementById('id-citizen').textContent = info.citizen;
    idInfoBox.classList.add('show');
    showIdFields();
});

function showIdFields() {
    document.getElementById('id-mode-toggle').style.display = 'block';
    if (idMode === 'register') {
        document.getElementById('id-reg-fields').style.display = 'block';
        document.getElementById('id-signin-fields').style.display = 'none';
        document.getElementById('id-mode-label').textContent = 'Already registered?';
        document.getElementById('id-mode-btn').textContent = 'Sign In Instead';
        idBtnText.textContent = 'Create Account & Connect';
    } else {
        document.getElementById('id-reg-fields').style.display = 'none';
        document.getElementById('id-signin-fields').style.display = 'block';
        document.getElementById('id-mode-label').textContent = 'New user?';
        document.getElementById('id-mode-btn').textContent = 'Register Instead';
        idBtnText.textContent = 'Sign In & Connect';
    }
    idSubmit.disabled = false;
}

document.getElementById('id-mode-btn')?.addEventListener('click', () => {
    idMode = idMode === 'register' ? 'signin' : 'register';
    if (idInput.classList.contains('valid')) showIdFields();
});

document.getElementById('id-pw')?.addEventListener('input', e => {
    updateStrengthMeter('id', e.target.value);
});

idSubmit?.addEventListener('click', async function () {
    const saId = idInput.value;
    const mac = getDeviceFingerprint();
    let hasErr = false;

    if (idMode === 'register') {
        const name = document.getElementById('id-name').value;
        const email = document.getElementById('id-email').value;
        const pw = document.getElementById('id-pw').value;
        const planId = parseInt(document.getElementById('id-plan').value);
        const nr = Validator.name(name);
        const er = Validator.email(email);
        const pr = Validator.password(pw);
        if (!nr.valid) { showFieldError('id-name', 'id-name-fb', nr.message); hasErr = true; }
        if (!er.valid) { showFieldError('id-email', 'id-email-fb', er.message); hasErr = true; }
        if (!pr.valid) { showFieldError('id-pw', 'id-pw-fb', pr.message); hasErr = true; }
        if (hasErr) return;
        setLoading(this, true);
        try {
            const data = await API.post('/auth/register', {
                authMethod: 'sa_id', saId, fullName: name, email, password: pw, macAddress: mac, planId
            });
            showSuccess('id-success', data);
            Toast.success('Account created and connected!');
        } catch (err) {
            Toast.error(err.message);
        } finally { setLoading(this, false); }

    } else {
        const pw = document.getElementById('id-signin-pw').value;
        if (!pw) { showFieldError('id-signin-pw', 'id-signin-pw-fb', 'Please enter your password.'); return; }
        setLoading(this, true);
        try {
            const data = await API.post('/auth/login', {
                authMethod: 'sa_id', saId, password: pw, macAddress: mac
            });
            showSuccess('id-success', data);
            Toast.success('Signed in and connected!');
        } catch (err) {
            Toast.error(err.message);
        } finally { setLoading(this, false); }
    }
});

// ================================================================
// EMAIL TAB
// ================================================================
document.getElementById('show-em-reg')?.addEventListener('click', () => {
    document.getElementById('email-login').style.display = 'none';
    document.getElementById('email-register').style.display = 'block';
});
document.getElementById('show-em-login')?.addEventListener('click', () => {
    document.getElementById('email-register').style.display = 'none';
    document.getElementById('email-login').style.display = 'block';
});

document.getElementById('reg-pw')?.addEventListener('input', e => {
    updateStrengthMeter('reg', e.target.value);
});
document.getElementById('reg-pw2')?.addEventListener('input', () => {
    const pw = document.getElementById('reg-pw').value;
    const pw2 = document.getElementById('reg-pw2').value;
    if (!pw2) return;
    const r = Validator.passwordsMatch(pw, pw2);
    setFeedback(document.getElementById('reg-pw2-fb'),
        r.valid ? '✓ Passwords match' : r.message, r.valid ? 'ok' : 'err');
});

document.getElementById('em-login-btn')?.addEventListener('click', async function () {
    const email = document.getElementById('em-email').value;
    const pw = document.getElementById('em-pw').value;
    const er = Validator.email(email);
    let hasErr = false;
    if (!er.valid) { showFieldError('em-email', 'em-email-fb', er.message); hasErr = true; }
    if (!pw) { showFieldError('em-pw', 'em-pw-fb', 'Please enter your password.'); hasErr = true; }
    if (hasErr) return;
    setLoading(this, true);
    try {
        const data = await API.post('/auth/login', {
            authMethod: 'email', email, password: pw, macAddress: getDeviceFingerprint()
        });
        document.getElementById('email-login').style.display = 'none';
        showSuccess('email-success', data);
        Toast.success('Signed in and connected!');
    } catch (err) {
        Toast.error(err.message);
    } finally { setLoading(this, false); }
});

document.getElementById('em-reg-btn')?.addEventListener('click', async function () {
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const pw = document.getElementById('reg-pw').value;
    const pw2 = document.getElementById('reg-pw2').value;
    const planId = parseInt(document.getElementById('reg-plan').value);
    const nr = Validator.name(name);
    const er = Validator.email(email);
    const pr = Validator.password(pw);
    const mr = Validator.passwordsMatch(pw, pw2);
    let hasErr = false;
    if (!nr.valid) { showFieldError('reg-name', 'reg-name-fb', nr.message); hasErr = true; }
    if (!er.valid) { showFieldError('reg-email', 'reg-email-fb', er.message); hasErr = true; }
    if (!pr.valid) { showFieldError('reg-pw', 'reg-pw-fb', pr.message); hasErr = true; }
    if (!mr.valid) { showFieldError('reg-pw2', 'reg-pw2-fb', mr.message); hasErr = true; }
    if (hasErr) return;
    setLoading(this, true);
    try {
        const data = await API.post('/auth/register', {
            authMethod: 'email', fullName: name, email, password: pw,
            macAddress: getDeviceFingerprint(), planId
        });
        document.getElementById('email-register').style.display = 'none';
        showSuccess('email-success', data);
        Toast.success('Account created and connected!');
    } catch (err) {
        Toast.error(err.message);
    } finally { setLoading(this, false); }
});

// ================================================================
// PHONE OTP TAB
// ================================================================
document.getElementById('send-otp-btn')?.addEventListener('click', async function () {
    const dial = document.getElementById('ph-dial').value;
    const number = document.getElementById('ph-number').value;
    const planId = parseInt(document.getElementById('ph-plan').value);
    const r = Validator.phone(number, dial);
    const fb = document.getElementById('ph-fb');
    if (!r.valid) {
        fb.className = 'input-feedback err';
        fb.textContent = r.message;
        return;
    }
    setLoading(this, true);
    try {
        const data = await API.post('/auth/otp/request', { phone: number, dialCode: dial, planId });
        document.getElementById('otp-phone-label').textContent = `${dial} ${number}`;
        document.getElementById('phone-entry').style.display = 'none';
        document.getElementById('otp-section').style.display = 'block';
        startOtpCountdown(data.expiresAt);
        document.querySelectorAll('.otp-digit')[0]?.focus();
        Toast.info('OTP sent. Check your phone.');
    } catch (err) {
        fb.className = 'input-feedback err';
        fb.textContent = err.message;
    } finally { setLoading(this, false); }
});

function startOtpCountdown(expiresAt) {
    clearInterval(otpTimer);
    const exp = new Date(expiresAt).getTime();
    const countdown = document.getElementById('otp-countdown');
    const resendBtn = document.getElementById('resend-otp-btn');
    resendBtn.disabled = true;
    otpTimer = setInterval(() => {
        const left = Math.max(0, Math.ceil((exp - Date.now()) / 1000));
        const m = Math.floor(left / 60);
        const s = left % 60;
        if (countdown) countdown.textContent = `${m}:${String(s).padStart(2, '0')}`;
        if (left <= 0) {
            clearInterval(otpTimer);
            if (countdown) countdown.textContent = 'Expired';
            resendBtn.disabled = false;
        }
    }, 1000);
}

document.getElementById('resend-otp-btn')?.addEventListener('click', async () => {
    const dial = document.getElementById('ph-dial').value;
    const number = document.getElementById('ph-number').value;
    document.querySelectorAll('.otp-digit').forEach(d => d.value = '');
    try {
        const data = await API.post('/auth/otp/request', { phone: number, dialCode: dial });
        startOtpCountdown(data.expiresAt);
        Toast.info('New OTP sent.');
    } catch (err) { Toast.error(err.message); }
});

document.getElementById('back-to-phone-btn')?.addEventListener('click', () => {
    clearInterval(otpTimer);
    document.getElementById('otp-section').style.display = 'none';
    document.getElementById('phone-entry').style.display = 'block';
});

document.querySelectorAll('.otp-digit').forEach((input, idx, all) => {
    input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/, '').slice(-1);
        if (input.value && idx < all.length - 1) all[idx + 1].focus();
    });
    input.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !input.value && idx > 0) all[idx - 1].focus();
    });
    input.addEventListener('paste', e => {
        e.preventDefault();
        const paste = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        [...paste.slice(0, 6)].forEach((ch, i) => { if (all[idx + i]) all[idx + i].value = ch; });
        const next = [...all].findIndex((el, i) => i >= idx && !el.value);
        (next !== -1 ? all[next] : all[all.length - 1]).focus();
    });
});

document.getElementById('verify-otp-btn')?.addEventListener('click', async function () {
    const code = [...document.querySelectorAll('.otp-digit')].map(d => d.value).join('');
    if (code.length < 6) { Toast.warn('Please enter the full 6-digit code.'); return; }
    const dial = document.getElementById('ph-dial').value;
    const number = document.getElementById('ph-number').value;
    const planId = parseInt(document.getElementById('ph-plan').value);
    setLoading(this, true);
    try {
        const data = await API.post('/auth/otp/verify', {
            phone: number, dialCode: dial, code, macAddress: getDeviceFingerprint(), planId
        });
        clearInterval(otpTimer);
        document.getElementById('otp-section').style.display = 'none';
        showSuccess('phone-success', data);
        Toast.success('OTP verified. Connected!');
    } catch (err) {
        Toast.error(err.message);
        document.querySelectorAll('.otp-digit').forEach(d => d.classList.add('invalid'));
        setTimeout(() => document.querySelectorAll('.otp-digit').forEach(d => d.classList.remove('invalid')), 1500);
    } finally { setLoading(this, false); }
});

// ================================================================
// SOCIAL / GUEST TAB
// ================================================================
document.getElementById('google-btn')?.addEventListener('click', () => {
    Toast.info('Google sign-in requires OAuth setup with your provider.');
});
document.getElementById('ms-btn')?.addEventListener('click', () => {
    Toast.info('Microsoft sign-in requires OAuth setup with your provider.');
});

document.getElementById('guest-btn')?.addEventListener('click', async function () {
    const name = document.getElementById('guest-name').value;
    const terms = document.getElementById('guest-terms').checked;
    const planId = parseInt(document.getElementById('guest-plan').value);
    const nr = Validator.name(name);
    if (!nr.valid) { showFieldError('guest-name', 'guest-name-fb', nr.message); return; }
    if (!terms) { Toast.warn('Please accept the Terms of Use.'); return; }
    setLoading(this, true);
    try {
        const data = await API.post('/auth/register', {
            authMethod: 'guest',
            fullName: name,
            email: `guest_${Date.now()}@ets.local`,
            password: Math.random().toString(36).slice(2) + 'A1!',
            macAddress: getDeviceFingerprint(),
            planId,
        });
        document.getElementById('social-content').style.display = 'none';
        showSuccess('social-success', data);
        Toast.success('Connected as guest!');
    } catch (err) {
        Toast.error(err.message);
    } finally { setLoading(this, false); }
});

// ================================================================
// INIT
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
    loadPlans();
});