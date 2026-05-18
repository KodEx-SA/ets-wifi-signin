/* =============================================================
   ETS WiFi — Portal Script
   Handles: canvas animation, tab switching, SA ID validation,
            email auth, phone OTP, social/guest login.
   ============================================================= */

'use strict';

/* ── Canvas Network Animation ─────────────────────────────── */
const canvas = document.getElementById('bg');
const ctx = canvas.getContext('2d');
let W, H, nodes;

function resizeCanvas() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
}

function initNodes() {
    nodes = Array.from({ length: 70 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 1.8 + 0.6,
    }));
}

function drawNetwork() {
    ctx.clearRect(0, 0, W, H);

    // Move & draw nodes
    for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > W) n.vx *= -1;
        if (n.y < 0 || n.y > H) n.vy *= -1;

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,210,255,0.45)';
        ctx.fill();
    }

    // Draw edges between nearby nodes
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[i].x - nodes[j].x;
            const dy = nodes[i].y - nodes[j].y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < 130) {
                ctx.beginPath();
                ctx.moveTo(nodes[i].x, nodes[i].y);
                ctx.lineTo(nodes[j].x, nodes[j].y);
                ctx.strokeStyle = `rgba(0,210,255,${0.18 * (1 - d / 130)})`;
                ctx.lineWidth = 0.5;
                ctx.stroke();
            }
        }
    }

    requestAnimationFrame(drawNetwork);
}

resizeCanvas();
initNodes();
drawNetwork();
window.addEventListener('resize', () => { resizeCanvas(); initNodes(); });


/* ── Tab Switching ─────────────────────────────────────────── */
document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
    });
});


/* ── Password Visibility Toggle ────────────────────────────── */
const EYE_OPEN = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>`;

const EYE_CLOSED = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94
             M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19
             M1 1l22 22"/>
  </svg>`;

function togglePw(inputId, btn) {
    const input = document.getElementById(inputId);
    const isText = input.type === 'text';
    input.type = isText ? 'password' : 'text';
    btn.innerHTML = isText ? EYE_OPEN : EYE_CLOSED;
}


/* ── SA ID Validation ──────────────────────────────────────── */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Validates a South African ID number using the Luhn algorithm.
 * @param {string} id - 13-digit ID string
 * @returns {boolean}
 */
function luhnCheck(id) {
    let sum = 0;
    let alt = false;
    for (let i = id.length - 1; i >= 0; i--) {
        let n = parseInt(id[i], 10);
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n;
        alt = !alt;
    }
    return sum % 10 === 0;
}

/**
 * Extracts demographic info from a valid SA ID number.
 * @param {string} id - Validated 13-digit ID string
 * @returns {{ dobDisplay: string, dobISO: string, gender: string, citizenship: string, age: number }}
 */
function parseID(id) {
    const yy = id.slice(0, 2);
    const mm = id.slice(2, 4);
    const dd = id.slice(4, 6);

    const genderSeq = parseInt(id.slice(6, 10), 10);
    const citizenship = id[10] === '0' ? 'SA Citizen' : 'Permanent Resident';
    const gender = genderSeq >= 5000 ? 'Male' : 'Female';

    const currentYY = new Date().getFullYear() % 100;
    const century = parseInt(yy, 10) <= currentYY ? '20' : '19';
    const fullYear = century + yy;

    const dobDate = new Date(`${fullYear}-${mm}-${dd}`);
    const today = new Date();
    let age = today.getFullYear() - dobDate.getFullYear();
    const monthDiff = today.getMonth() - dobDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dobDate.getDate())) age--;

    return {
        dobDisplay: `${dd} ${MONTHS[parseInt(mm, 10) - 1]} ${fullYear}`,
        dobISO: `${fullYear}-${mm}-${dd}`,
        gender,
        citizenship,
        age,
    };
}

// ── SA ID panel DOM references ──
const idInput = document.getElementById('id-number');
const idFeedback = document.getElementById('id-feedback');
const idInfoBox = document.getElementById('id-info-box');
const idSubmitBtn = document.getElementById('id-submit-btn');
const idBtnText = document.getElementById('id-btn-text');

/** Current mode for the SA ID panel: 'register' | 'signin' */
let idMode = 'register';

/** Resets the SA ID panel to its initial empty state. */
function resetIdPanel() {
    idInput.classList.remove('valid', 'invalid');
    idInfoBox.classList.remove('show');
    idFeedback.className = 'input-feedback';
    idFeedback.textContent = '';
    document.getElementById('id-register-fields').style.display = 'none';
    document.getElementById('id-returning-fields').style.display = 'none';
    document.getElementById('id-toggle-text').style.display = 'none';
    idSubmitBtn.disabled = true;
    idBtnText.textContent = 'Enter Valid ID Number';
}

idInput.addEventListener('input', () => {
    // Strip non-digits immediately
    idInput.value = idInput.value.replace(/\D/g, '');
    const val = idInput.value;

    resetIdPanel();
    if (!val.length) return;

    if (val.length < 13) {
        idFeedback.textContent = `${13 - val.length} digit${13 - val.length !== 1 ? 's' : ''} remaining`;
        idFeedback.className = 'input-feedback info';
        return;
    }

    // Full 13-digit input — validate
    const mm = parseInt(val.slice(2, 4), 10);
    const dd = parseInt(val.slice(4, 6), 10);

    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
        idInput.classList.add('invalid');
        idFeedback.textContent = 'Invalid date of birth in ID number';
        idFeedback.className = 'input-feedback err';
        return;
    }

    if (!luhnCheck(val)) {
        idInput.classList.add('invalid');
        idFeedback.textContent = 'Invalid ID number — checksum failed';
        idFeedback.className = 'input-feedback err';
        return;
    }

    // ── Valid ──
    idInput.classList.add('valid');
    idFeedback.textContent = '✓ Valid South African ID';
    idFeedback.className = 'input-feedback ok';

    const info = parseID(val);
    document.getElementById('info-dob').textContent = info.dobDisplay;
    document.getElementById('info-gender').textContent = info.gender;
    document.getElementById('info-age').textContent = `${info.age} years`;
    document.getElementById('info-citizenship').textContent = info.citizenship;
    idInfoBox.classList.add('show');

    // Pre-fill read-only fields
    document.getElementById('id-dob').value = info.dobISO;
    document.getElementById('id-gender-field').value = info.gender;

    showIdFields();
});

/** Shows the appropriate form fields based on the current idMode. */
function showIdFields() {
    document.getElementById('id-toggle-text').style.display = 'block';

    if (idMode === 'register') {
        document.getElementById('id-register-fields').style.display = 'block';
        document.getElementById('id-returning-fields').style.display = 'none';
        document.getElementById('id-toggle-label').textContent = 'Already registered?';
        document.getElementById('id-toggle-link').textContent = 'Sign In Instead';
        idBtnText.textContent = 'Create Account & Connect';
    } else {
        document.getElementById('id-register-fields').style.display = 'none';
        document.getElementById('id-returning-fields').style.display = 'block';
        document.getElementById('id-toggle-label').textContent = 'New user?';
        document.getElementById('id-toggle-link').textContent = 'Register Instead';
        idBtnText.textContent = 'Sign In & Connect';
    }

    idSubmitBtn.disabled = false;
}

/** Toggles the SA ID panel between register and sign-in mode. */
function toggleIdMode() {
    idMode = idMode === 'register' ? 'signin' : 'register';
    if (idInput.classList.contains('valid')) showIdFields();
}

idSubmitBtn.addEventListener('click', () => {
    // Basic field validation before simulating the request
    if (idMode === 'register') {
        const fullName = document.getElementById('id-fullname').value.trim();
        const email = document.getElementById('id-email').value.trim();
        const password = document.getElementById('id-password').value;

        if (!fullName) { showFieldError('id-fullname', 'Please enter your full name.'); return; }
        if (!email) { showFieldError('id-email', 'Please enter your email address.'); return; }
        if (password.length < 8) { showFieldError('id-password', 'Password must be at least 8 characters.'); return; }
    } else {
        const password = document.getElementById('id-return-pw').value;
        if (!password) { showFieldError('id-return-pw', 'Please enter your password.'); return; }
    }

    setLoading(idSubmitBtn, true);
    setTimeout(() => {
        setLoading(idSubmitBtn, false);
        document.getElementById('id-main-form').style.display = 'none';
        document.getElementById('id-success').classList.add('show');
    }, 1800);
});


/* ── Email Auth ────────────────────────────────────────────── */
function showEmailLogin() {
    document.getElementById('email-login-form').style.display = 'block';
    document.getElementById('email-register-form').style.display = 'none';
}

function showEmailRegister() {
    document.getElementById('email-login-form').style.display = 'none';
    document.getElementById('email-register-form').style.display = 'block';
}

function handleEmailSubmit(btn) {
    const email = document.getElementById('email-addr').value.trim();
    const password = document.getElementById('email-pw').value;

    if (!email) { showFieldError('email-addr', 'Please enter your email address.'); return; }
    if (!password) { showFieldError('email-pw', 'Please enter your password.'); return; }

    setLoading(btn, true);
    setTimeout(() => {
        setLoading(btn, false);
        document.getElementById('email-login-form').style.display = 'none';
        document.getElementById('email-success').classList.add('show');
    }, 1800);
}

function handleEmailRegister(btn) {
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const pw = document.getElementById('reg-pw').value;
    const pw2 = document.getElementById('reg-pw2').value;

    if (!name) { showFieldError('reg-name', 'Please enter your full name.'); return; }
    if (!email) { showFieldError('reg-email', 'Please enter your email address.'); return; }
    if (pw.length < 8) { showFieldError('reg-pw', 'Password must be at least 8 characters.'); return; }
    if (pw !== pw2) { showFieldError('reg-pw2', 'Passwords do not match.'); return; }

    setLoading(btn, true);
    setTimeout(() => {
        setLoading(btn, false);
        document.getElementById('email-register-form').style.display = 'none';
        document.getElementById('email-success').classList.add('show');
    }, 1800);
}


/* ── Phone OTP ─────────────────────────────────────────────── */
let otpTimer;
let otpSeconds = 300;
const OTP_DURATION = 300; // 5 minutes

function sendOTP(btn) {
    const dialCode = document.getElementById('phone-dial').value;
    const number = document.getElementById('phone-number').value.trim();

    if (!number) {
        showFieldError('phone-number', 'Please enter your mobile number.');
        return;
    }

    setLoading(btn, true);
    setTimeout(() => {
        setLoading(btn, false);
        document.getElementById('otp-phone-display').textContent = `${dialCode} ${number}`;
        document.getElementById('phone-entry').style.display = 'none';
        document.getElementById('otp-section').classList.add('visible');
        startOTPTimer();
        document.querySelectorAll('.otp-digit')[0].focus();
    }, 1200);
}

function startOTPTimer() {
    otpSeconds = OTP_DURATION;

    const resendBtn = document.getElementById('resend-btn');
    const countdownEl = document.getElementById('otp-countdown');
    resendBtn.disabled = true;

    clearInterval(otpTimer);
    otpTimer = setInterval(() => {
        otpSeconds--;
        const m = Math.floor(otpSeconds / 60);
        const s = String(otpSeconds % 60).padStart(2, '0');
        countdownEl.textContent = `${m}:${s}`;

        if (otpSeconds <= 0) {
            clearInterval(otpTimer);
            resendBtn.disabled = false;
            countdownEl.textContent = 'Expired';
        }
    }, 1000);
}

function resendOTP() {
    const resendBtn = document.getElementById('resend-btn');
    resendBtn.disabled = true; // Prevent rapid re-clicks
    document.querySelectorAll('.otp-digit').forEach(i => (i.value = ''));
    document.querySelectorAll('.otp-digit')[0].focus();
    startOTPTimer();
}

function backToPhone() {
    clearInterval(otpTimer);
    document.getElementById('phone-entry').style.display = 'block';
    document.getElementById('otp-section').classList.remove('visible');
}

// OTP digit auto-advance and backspace navigation
document.querySelectorAll('.otp-digit').forEach((input, idx, all) => {
    input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/, '').slice(-1); // Keep only last digit
        if (input.value && idx < all.length - 1) all[idx + 1].focus();
    });
    input.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !input.value && idx > 0) all[idx - 1].focus();
    });
    // Allow paste across all 6 boxes
    input.addEventListener('paste', e => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        [...pasted.slice(0, 6)].forEach((char, i) => {
            if (all[idx + i]) all[idx + i].value = char;
        });
        const nextEmpty = [...all].findIndex((el, i) => i >= idx && !el.value);
        if (nextEmpty !== -1) all[nextEmpty].focus();
        else all[all.length - 1].focus();
    });
});

function verifyOTP(btn) {
    const code = [...document.querySelectorAll('.otp-digit')].map(i => i.value).join('');
    if (code.length < 6) {
        showToast('Please enter the complete 6-digit code.', 'warn');
        return;
    }
    setLoading(btn, true);
    setTimeout(() => {
        clearInterval(otpTimer);
        setLoading(btn, false);
        document.getElementById('otp-section').classList.remove('visible');
        document.getElementById('phone-success').classList.add('show');
    }, 1500);
}


/* ── Social / Guest Login ──────────────────────────────────── */
function handleSocialLogin(provider, btn) {
    setLoading(btn, true);
    setTimeout(() => {
        setLoading(btn, false);
        // Hide the entire social panel content (buttons + guest section)
        document.getElementById('social-content').style.display = 'none';
        document.getElementById('social-success').classList.add('show');
    }, 1800);
}

function handleGuestConnect(btn) {
    const name = document.getElementById('guest-name').value.trim();
    const agreed = document.getElementById('guest-terms').checked;

    if (!name) { showFieldError('guest-name', 'Please enter your name.'); return; }
    if (!agreed) { showToast('Please accept the Terms of Use to continue.', 'warn'); return; }

    setLoading(btn, true);
    setTimeout(() => {
        setLoading(btn, false);
        document.getElementById('social-content').style.display = 'none';
        document.getElementById('social-success').classList.add('show');
    }, 1500);
}


/* ── Helpers ───────────────────────────────────────────────── */

/** Shows or hides the loading spinner on a button. */
function setLoading(btn, state) {
    btn.classList.toggle('loading', state);
    btn.disabled = state;
}

/**
 * Briefly highlights a field with an inline error message.
 * @param {string} inputId - The id of the input element
 * @param {string} message - The error message to display
 */
function showFieldError(inputId, message) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.classList.add('invalid');
    input.focus();

    // Use an adjacent feedback element if present, otherwise fall back to a brief shake
    const feedback = input.closest('.form-group')?.querySelector('.input-feedback');
    if (feedback) {
        feedback.textContent = message;
        feedback.className = 'input-feedback err';
        setTimeout(() => {
            if (feedback.textContent === message) {
                feedback.textContent = '';
                feedback.className = 'input-feedback';
            }
        }, 3000);
    }

    input.addEventListener('input', () => input.classList.remove('invalid'), { once: true });
}

/**
 * Displays a small toast notification at the bottom of the card.
 * @param {string} message
 * @param {'info'|'warn'|'success'} type
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('portal-toast');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `portal-toast-msg portal-toast-${type}`;
    el.textContent = message;
    container.appendChild(el);

    // Trigger enter animation on next frame
    requestAnimationFrame(() => el.classList.add('visible'));

    setTimeout(() => {
        el.classList.remove('visible');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
    }, 3000);
}