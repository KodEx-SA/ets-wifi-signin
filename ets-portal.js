/* =============================================================
   ETS WiFi — Portal Script
   Handles: canvas animation, tab switching, SA ID validation,
            email auth, phone OTP, social/guest login.

   Security model:
   - All validation is client-side only (no backend in this demo).
   - In production: submit to a server endpoint; never trust the
     client alone.
   ============================================================= */

'use strict';

/* ══════════════════════════════════════════════════════════════
   CONSTANTS
   ══════════════════════════════════════════════════════════════ */

const CONFIG = {
    MIN_AGE: 18,          // minimum age for SA ID registration
    MIN_PASSWORD_LEN: 8,           // characters
    MAX_ATTEMPTS: 5,           // failed attempts before lockout
    LOCKOUT_MS: 2 * 60_000,  // 2-minute lockout
    OTP_DURATION_S: 300,         // 5 minutes
};

/** Month abbreviations for display. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** SVG icons for password toggle. */
const EYE_OPEN = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round">
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
  <circle cx="12" cy="12" r="3"/>
</svg>`;

const EYE_CLOSED = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round">
  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8
           a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4
           c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/>
</svg>`;

/** Phone number rules keyed by dial code. */
const PHONE_RULES = {
    '+27': { regex: /^0?[678]\d{8}$/, label: 'SA number (e.g. 072 123 4567)' },
    '+263': { regex: /^0?\d{8,9}$/, label: 'ZW number (9 digits)' },
    '+267': { regex: /^\d{7,8}$/, label: 'BW number (7–8 digits)' },
    '+258': { regex: /^\d{8,9}$/, label: 'MZ number (8–9 digits)' },
    '+254': { regex: /^0?\d{9}$/, label: 'KE number (9 digits)' },
    '+234': { regex: /^0?\d{8,10}$/, label: 'NG number (8–10 digits)' },
    '+1': { regex: /^\d{10}$/, label: 'US number (10 digits)' },
    '+44': { regex: /^0?\d{10}$/, label: 'UK number (10–11 digits)' },
};


/* ══════════════════════════════════════════════════════════════
   VALIDATOR
   Pure functions — return { valid: boolean, message?: string }
   ══════════════════════════════════════════════════════════════ */

const Validator = {

    /**
     * Full name: letters, spaces, hyphens, apostrophes only. ≥ 2 chars.
     */
    name(raw) {
        const value = raw.trim();
        if (!value) return { valid: false, message: 'Please enter your full name.' };
        if (value.length < 2) return { valid: false, message: 'Name must be at least 2 characters.' };
        if (!/^[\p{L}\s'\-]+$/u.test(value)) {
            return { valid: false, message: 'Name may only contain letters, spaces, hyphens, and apostrophes.' };
        }
        if (!value.includes(' ')) {
            return { valid: false, message: 'Please enter your first and last name.' };
        }
        return { valid: true };
    },

    /**
     * Email: basic RFC-5322-ish regex.
     */
    email(raw) {
        const value = raw.trim();
        if (!value) return { valid: false, message: 'Please enter your email address.' };
        // Must have exactly one @, with content on both sides, and a TLD of ≥ 2 chars
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
            return { valid: false, message: 'Please enter a valid email address.' };
        }
        return { valid: true };
    },

    /**
     * Password: minimum length + at least 3 of 4 character classes.
     * Returns { valid, message, score (1–4) }.
     */
    password(raw) {
        if (!raw) return { valid: false, message: 'Please create a password.', score: 0 };
        if (raw.length < CONFIG.MIN_PASSWORD_LEN) {
            return { valid: false, message: `Password must be at least ${CONFIG.MIN_PASSWORD_LEN} characters.`, score: 1 };
        }

        const checks = [
            /[A-Z]/.test(raw),   // uppercase
            /[a-z]/.test(raw),   // lowercase
            /[0-9]/.test(raw),   // digit
            /[^A-Za-z0-9]/.test(raw), // special character
        ];
        const score = checks.filter(Boolean).length;

        if (score < 2) {
            return { valid: false, message: 'Add uppercase, lowercase, numbers, or symbols to strengthen the password.', score };
        }
        return { valid: true, score };
    },

    /**
     * Passwords match.
     */
    passwordsMatch(pw, confirm) {
        if (!confirm) return { valid: false, message: 'Please confirm your password.' };
        if (pw !== confirm) return { valid: false, message: 'Passwords do not match.' };
        return { valid: true };
    },

    /**
     * Phone number format per dial code.
     * Strips spaces, dashes, and parentheses before testing.
     */
    phone(raw, dialCode) {
        const digits = raw.replace(/[\s\-()]/g, '');
        if (!digits) return { valid: false, message: 'Please enter your mobile number.' };

        const rule = PHONE_RULES[dialCode];
        if (!rule) return { valid: false, message: 'Unsupported dial code.' };

        if (!rule.regex.test(digits)) {
            return { valid: false, message: `Invalid number format. Expected ${rule.label}.` };
        }
        return { valid: true };
    },

    /**
     * SA ID: Luhn check + valid calendar date + minimum age.
     */
    saId(raw) {
        const id = raw.trim();
        if (id.length !== 13 || /\D/.test(id)) {
            return { valid: false, message: 'ID must be exactly 13 digits.' };
        }

        // --- Date validation ---
        const yy = parseInt(id.slice(0, 2), 10);
        const mm = parseInt(id.slice(2, 4), 10);
        const dd = parseInt(id.slice(4, 6), 10);

        // Use Date() to detect impossible dates (e.g. Feb 30, Apr 31)
        const century = yy <= new Date().getFullYear() % 100 ? 2000 : 1900;
        const fullYear = century + yy;
        const dob = new Date(fullYear, mm - 1, dd);

        if (
            dob.getFullYear() !== fullYear ||
            dob.getMonth() !== mm - 1 ||
            dob.getDate() !== dd
        ) {
            return { valid: false, message: 'Invalid date of birth in ID number.' };
        }

        // --- Minimum age ---
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        if (today.getMonth() < dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())) {
            age--;
        }
        if (age < CONFIG.MIN_AGE) {
            return { valid: false, message: `You must be at least ${CONFIG.MIN_AGE} years old to register.` };
        }

        // --- Luhn check ---
        let sum = 0;
        let alt = false;
        for (let i = id.length - 1; i >= 0; i--) {
            let n = parseInt(id[i], 10);
            if (alt) { n *= 2; if (n > 9) n -= 9; }
            sum += n;
            alt = !alt;
        }
        if (sum % 10 !== 0) {
            return { valid: false, message: 'Invalid ID number — checksum failed.' };
        }

        return { valid: true };
    },
};


/* ══════════════════════════════════════════════════════════════
   RATE LIMITER
   Tracks failed attempts per key (tab name) and enforces a
   time-based lockout after too many failures.
   ══════════════════════════════════════════════════════════════ */

class RateLimiter {
    constructor(maxAttempts = 5, lockoutMs = 120_000) {
        this._max = maxAttempts;
        this._lockMs = lockoutMs;
        this._attempts = {};  // key → count
        this._lockedAt = {};  // key → timestamp
    }

    /** Record a failed attempt. Returns true if now locked out. */
    recordFailure(key) {
        this._attempts[key] = (this._attempts[key] || 0) + 1;
        if (this._attempts[key] >= this._max) {
            this._lockedAt[key] = Date.now();
        }
        return this.isLocked(key);
    }

    /** Reset attempts after a successful auth. */
    reset(key) {
        delete this._attempts[key];
        delete this._lockedAt[key];
    }

    isLocked(key) {
        if (!this._lockedAt[key]) return false;
        if (Date.now() - this._lockedAt[key] >= this._lockMs) {
            // Lockout expired — auto-reset
            this.reset(key);
            return false;
        }
        return true;
    }

    /** Remaining seconds of lockout (0 if not locked). */
    remainingSeconds(key) {
        if (!this._lockedAt[key]) return 0;
        return Math.ceil((this._lockMs - (Date.now() - this._lockedAt[key])) / 1000);
    }

    /** Remaining attempts before lockout triggers (negative when locked). */
    attemptsLeft(key) {
        return this._max - (this._attempts[key] || 0);
    }
}

const portalLimiter = new RateLimiter(CONFIG.MAX_ATTEMPTS, CONFIG.LOCKOUT_MS);


/* ══════════════════════════════════════════════════════════════
   CANVAS NETWORK ANIMATION
   ══════════════════════════════════════════════════════════════ */

(function initCanvas() {
    const canvas = document.getElementById('bg');
    const ctx = canvas.getContext('2d');
    let W, H, nodes;

    function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
    }

    function createNodes() {
        nodes = Array.from({ length: 70 }, () => ({
            x: Math.random() * W,
            y: Math.random() * H,
            vx: (Math.random() - 0.5) * 0.4,
            vy: (Math.random() - 0.5) * 0.4,
            r: Math.random() * 1.8 + 0.6,
        }));
    }

    function draw() {
        ctx.clearRect(0, 0, W, H);

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

        requestAnimationFrame(draw);
    }

    resize();
    createNodes();
    draw();
    window.addEventListener('resize', () => { resize(); createNodes(); });
})();


/* ══════════════════════════════════════════════════════════════
   TAB SWITCHING
   ══════════════════════════════════════════════════════════════ */

document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => {
            t.classList.remove('active');
            t.setAttribute('aria-selected', 'false');
        });
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
    });
});


/* ══════════════════════════════════════════════════════════════
   PASSWORD VISIBILITY TOGGLE
   Uses data-target attribute — no inline onclick needed.
   ══════════════════════════════════════════════════════════════ */

document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        const isText = input.type === 'text';
        input.type = isText ? 'password' : 'text';
        btn.innerHTML = isText ? EYE_OPEN : EYE_CLOSED;
        btn.setAttribute('aria-label', isText ? 'Show password' : 'Hide password');
    });
});


/* ══════════════════════════════════════════════════════════════
   PASSWORD STRENGTH METER
   ══════════════════════════════════════════════════════════════ */

const STRENGTH_MAP = [
    { label: '', color: '' },          // 0 — empty
    { label: 'Weak', color: 'weak' },      // 1
    { label: 'Fair', color: 'fair' },      // 2
    { label: 'Good', color: 'good' },      // 3
    { label: 'Strong', color: 'strong' },    // 4
];

/**
 * Updates the 4-bar strength indicator for a password field.
 * @param {string} prefix - DOM id prefix, e.g. 'id' or 'reg'
 * @param {string} password
 */
function updateStrengthMeter(prefix, password) {
    if (!password) {
        for (let i = 1; i <= 4; i++) {
            const bar = document.getElementById(`${prefix}-ps-${i}`);
            if (bar) bar.className = 'pw-strength-bar';
        }
        const label = document.getElementById(`${prefix}-ps-label`);
        if (label) label.textContent = '';
        return;
    }

    const { score } = Validator.password(password);
    const level = Math.max(1, score);
    const info = STRENGTH_MAP[level] || STRENGTH_MAP[1];

    for (let i = 1; i <= 4; i++) {
        const bar = document.getElementById(`${prefix}-ps-${i}`);
        if (bar) bar.className = `pw-strength-bar${i <= level ? ` ${info.color}` : ''}`;
    }
    const label = document.getElementById(`${prefix}-ps-label`);
    if (label) {
        label.textContent = info.label;
        label.style.color = level === 4 ? 'var(--success)' : level === 3 ? '#f0c040' : level === 2 ? 'var(--warning)' : 'var(--danger)';
    }
}

// Wire strength meters
['id-password', 'reg-pw'].forEach(inputId => {
    const el = document.getElementById(inputId);
    if (!el) return;
    const prefix = inputId === 'id-password' ? 'id' : 'reg';
    el.addEventListener('input', () => updateStrengthMeter(prefix, el.value));
});


/* ══════════════════════════════════════════════════════════════
   SA ID PANEL
   ══════════════════════════════════════════════════════════════ */

/** Extracts display info from a validated 13-digit SA ID string. */
function parseID(id) {
    const yy = id.slice(0, 2);
    const mm = id.slice(2, 4);
    const dd = id.slice(4, 6);

    const genderSeq = parseInt(id.slice(6, 10), 10);
    const gender = genderSeq >= 5000 ? 'Male' : 'Female';
    const citizenship = id[10] === '0' ? 'SA Citizen' : 'Permanent Resident';

    const currentYY = new Date().getFullYear() % 100;
    const century = parseInt(yy, 10) <= currentYY ? '20' : '19';
    const fullYear = century + yy;

    const dob = new Date(`${fullYear}-${mm}-${dd}`);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    if (today.getMonth() < dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())) {
        age--;
    }

    return {
        dobDisplay: `${dd} ${MONTHS[parseInt(mm, 10) - 1]} ${fullYear}`,
        dobISO: `${fullYear}-${mm}-${dd}`,
        gender,
        citizenship,
        age,
    };
}

// DOM references — SA ID panel
const idInput = document.getElementById('id-number');
const idFeedback = document.getElementById('id-feedback');
const idInfoBox = document.getElementById('id-info-box');
const idSubmitBtn = document.getElementById('id-submit-btn');
const idBtnText = document.getElementById('id-btn-text');

/** 'register' | 'signin' */
let idMode = 'register';

/** Resets the SA ID panel to its initial empty state. */
function resetIdPanel() {
    idInput.classList.remove('valid', 'invalid');
    idInfoBox.classList.remove('show');
    setFeedback(idFeedback, '', '');
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
        const remaining = 13 - val.length;
        setFeedback(idFeedback, `${remaining} digit${remaining !== 1 ? 's' : ''} remaining`, 'info');
        return;
    }

    // Full 13-digit — run all checks
    const result = Validator.saId(val);
    if (!result.valid) {
        idInput.classList.add('invalid');
        setFeedback(idFeedback, result.message, 'err');
        return;
    }

    // Valid — populate info box
    idInput.classList.add('valid');
    setFeedback(idFeedback, '✓ Valid South African ID', 'ok');

    const info = parseID(val);
    document.getElementById('info-dob').textContent = info.dobDisplay;
    document.getElementById('info-gender').textContent = info.gender;
    document.getElementById('info-age').textContent = `${info.age} years`;
    document.getElementById('info-citizenship').textContent = info.citizenship;
    idInfoBox.classList.add('show');

    document.getElementById('id-dob').value = info.dobISO;
    document.getElementById('id-gender-field').value = info.gender;

    showIdFields();
});

/** Shows appropriate form section based on current idMode. */
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

document.getElementById('id-toggle-link').addEventListener('click', () => {
    idMode = idMode === 'register' ? 'signin' : 'register';
    if (idInput.classList.contains('valid')) showIdFields();
});

idSubmitBtn.addEventListener('click', () => {
    // Check rate limit
    if (portalLimiter.isLocked('id')) {
        showRateMsg('id-rate-msg', portalLimiter.remainingSeconds('id'));
        return;
    }

    let hasError = false;

    if (idMode === 'register') {
        const fullName = document.getElementById('id-fullname').value;
        const email = document.getElementById('id-email').value;
        const password = document.getElementById('id-password').value;

        const nameResult = Validator.name(fullName);
        const emailResult = Validator.email(email);
        const pwResult = Validator.password(password);

        if (!nameResult.valid) { showFieldError('id-fullname', 'id-fullname-feedback', nameResult.message); hasError = true; }
        if (!emailResult.valid) { showFieldError('id-email', 'id-email-feedback', emailResult.message); hasError = true; }
        if (!pwResult.valid) { showFieldError('id-password', 'id-password-feedback', pwResult.message); hasError = true; }
    } else {
        const password = document.getElementById('id-return-pw').value;
        if (!password) { showFieldError('id-return-pw', 'id-return-pw-feedback', 'Please enter your password.'); hasError = true; }
    }

    if (hasError) {
        portalLimiter.recordFailure('id');
        const left = portalLimiter.attemptsLeft('id');
        if (portalLimiter.isLocked('id')) {
            showRateMsg('id-rate-msg', portalLimiter.remainingSeconds('id'));
        } else if (left <= 2) {
            showToast(`${left} attempt${left !== 1 ? 's' : ''} remaining before temporary lockout.`, 'warn');
        }
        return;
    }

    portalLimiter.reset('id');
    setLoading(idSubmitBtn, true);
    setTimeout(() => {
        setLoading(idSubmitBtn, false);
        document.getElementById('id-main-form').style.display = 'none';
        document.getElementById('id-success').classList.add('show');
    }, 1800);
});


/* ══════════════════════════════════════════════════════════════
   EMAIL AUTH
   ══════════════════════════════════════════════════════════════ */

document.getElementById('show-email-register-btn').addEventListener('click', () => {
    document.getElementById('email-login-form').style.display = 'none';
    document.getElementById('email-register-form').style.display = 'block';
});

document.getElementById('show-email-login-btn').addEventListener('click', () => {
    document.getElementById('email-register-form').style.display = 'none';
    document.getElementById('email-login-form').style.display = 'block';
});

document.getElementById('email-login-btn').addEventListener('click', function () {
    if (portalLimiter.isLocked('email')) {
        showRateMsg('email-rate-msg', portalLimiter.remainingSeconds('email'));
        return;
    }

    const email = document.getElementById('email-addr').value;
    const password = document.getElementById('email-pw').value;

    const emailResult = Validator.email(email);
    const pwEmpty = !password;

    let hasError = false;
    if (!emailResult.valid) { showFieldError('email-addr', 'email-addr-feedback', emailResult.message); hasError = true; }
    if (pwEmpty) { showFieldError('email-pw', 'email-pw-feedback', 'Please enter your password.'); hasError = true; }

    if (hasError) {
        portalLimiter.recordFailure('email');
        const left = portalLimiter.attemptsLeft('email');
        if (portalLimiter.isLocked('email')) {
            showRateMsg('email-rate-msg', portalLimiter.remainingSeconds('email'));
        } else if (left <= 2) {
            showToast(`${left} attempt${left !== 1 ? 's' : ''} remaining before temporary lockout.`, 'warn');
        }
        return;
    }

    portalLimiter.reset('email');
    setLoading(this, true);
    setTimeout(() => {
        setLoading(this, false);
        document.getElementById('email-login-form').style.display = 'none';
        document.getElementById('email-success').classList.add('show');
    }, 1800);
});

// Live confirm-password match feedback
document.getElementById('reg-pw').addEventListener('input', () => {
    updateStrengthMeter('reg', document.getElementById('reg-pw').value);
});
document.getElementById('reg-pw2').addEventListener('input', () => {
    const pw = document.getElementById('reg-pw').value;
    const pw2 = document.getElementById('reg-pw2').value;
    if (!pw2) return;
    const result = Validator.passwordsMatch(pw, pw2);
    const fb = document.getElementById('reg-pw2-feedback');
    if (result.valid) {
        setFeedback(fb, '✓ Passwords match', 'ok');
    } else {
        setFeedback(fb, result.message, 'err');
    }
});

document.getElementById('email-register-btn').addEventListener('click', function () {
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const pw = document.getElementById('reg-pw').value;
    const pw2 = document.getElementById('reg-pw2').value;

    const nameResult = Validator.name(name);
    const emailResult = Validator.email(email);
    const pwResult = Validator.password(pw);
    const matchResult = Validator.passwordsMatch(pw, pw2);

    let hasError = false;
    if (!nameResult.valid) { showFieldError('reg-name', 'reg-name-feedback', nameResult.message); hasError = true; }
    if (!emailResult.valid) { showFieldError('reg-email', 'reg-email-feedback', emailResult.message); hasError = true; }
    if (!pwResult.valid) { showFieldError('reg-pw', 'reg-pw-feedback', pwResult.message); hasError = true; }
    if (!matchResult.valid) { showFieldError('reg-pw2', 'reg-pw2-feedback', matchResult.message); hasError = true; }

    if (hasError) return;

    setLoading(this, true);
    setTimeout(() => {
        setLoading(this, false);
        document.getElementById('email-register-form').style.display = 'none';
        document.getElementById('email-success').classList.add('show');
    }, 1800);
});


/* ══════════════════════════════════════════════════════════════
   PHONE OTP
   ══════════════════════════════════════════════════════════════ */

let otpTimer = null;
let otpSeconds = CONFIG.OTP_DURATION_S;

document.getElementById('send-otp-btn').addEventListener('click', function () {
    const dialCode = document.getElementById('phone-dial').value;
    const number = document.getElementById('phone-number').value;

    const result = Validator.phone(number, dialCode);
    if (!result.valid) {
        const fb = document.getElementById('phone-feedback');
        fb.className = 'input-feedback err';
        fb.textContent = result.message;
        document.getElementById('phone-number').classList.add('invalid');
        return;
    }

    // Reset feedback to neutral
    const fb = document.getElementById('phone-feedback');
    fb.className = 'input-feedback info';
    fb.textContent = 'Sending code…';
    document.getElementById('phone-number').classList.remove('invalid');

    setLoading(this, true);
    setTimeout(() => {
        setLoading(this, false);
        document.getElementById('otp-phone-display').textContent = `${dialCode} ${number.trim()}`;
        document.getElementById('phone-entry').style.display = 'none';
        document.getElementById('otp-section').classList.add('visible');
        startOTPTimer();
        document.querySelectorAll('.otp-digit')[0].focus();
    }, 1200);
});

function startOTPTimer() {
    otpSeconds = CONFIG.OTP_DURATION_S;
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

document.getElementById('resend-btn').addEventListener('click', () => {
    document.getElementById('resend-btn').disabled = true;
    document.querySelectorAll('.otp-digit').forEach(i => (i.value = ''));
    document.querySelectorAll('.otp-digit')[0].focus();
    startOTPTimer();
});

document.getElementById('back-to-phone-btn').addEventListener('click', () => {
    clearInterval(otpTimer);
    document.getElementById('phone-entry').style.display = 'block';
    document.getElementById('otp-section').classList.remove('visible');
    // Reset feedback
    const fb = document.getElementById('phone-feedback');
    fb.className = 'input-feedback info';
    fb.textContent = 'An OTP will be sent to this number';
});

// OTP digit — auto-advance, backspace, paste
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
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        [...pasted.slice(0, 6)].forEach((char, i) => {
            if (all[idx + i]) all[idx + i].value = char;
        });
        const nextEmpty = [...all].findIndex((el, i) => i >= idx && !el.value);
        if (nextEmpty !== -1) all[nextEmpty].focus();
        else all[all.length - 1].focus();
    });
});

document.getElementById('verify-otp-btn').addEventListener('click', function () {
    const code = [...document.querySelectorAll('.otp-digit')].map(i => i.value).join('');

    if (code.length < 6 || /\D/.test(code)) {
        showToast('Please enter the complete 6-digit code.', 'warn');
        return;
    }

    if (otpSeconds <= 0) {
        showToast('Your code has expired. Please request a new one.', 'warn');
        return;
    }

    setLoading(this, true);
    setTimeout(() => {
        clearInterval(otpTimer);
        setLoading(this, false);
        document.getElementById('otp-section').classList.remove('visible');
        document.getElementById('phone-success').classList.add('show');
    }, 1500);
});


/* ══════════════════════════════════════════════════════════════
   SOCIAL / GUEST LOGIN
   ══════════════════════════════════════════════════════════════ */

['google-btn', 'microsoft-btn', 'apple-btn'].forEach(id => {
    const btn = document.getElementById(id);
    const provider = id.replace('-btn', '');
    btn.addEventListener('click', function () {
        setLoading(this, true);
        setTimeout(() => {
            setLoading(this, false);
            document.getElementById('social-content').style.display = 'none';
            document.getElementById('social-success').classList.add('show');
        }, 1800);
    });
});

document.getElementById('guest-connect-btn').addEventListener('click', function () {
    const name = document.getElementById('guest-name').value;
    const agreed = document.getElementById('guest-terms').checked;

    const nameResult = Validator.name(name);
    if (!nameResult.valid) {
        showFieldError('guest-name', 'guest-name-feedback', nameResult.message);
        return;
    }
    if (!agreed) {
        showToast('Please accept the Terms of Use to continue.', 'warn');
        return;
    }

    setLoading(this, true);
    setTimeout(() => {
        setLoading(this, false);
        document.getElementById('social-content').style.display = 'none';
        document.getElementById('social-success').classList.add('show');
    }, 1500);
});


/* ══════════════════════════════════════════════════════════════
   UI HELPERS
   ══════════════════════════════════════════════════════════════ */

/** Toggles the loading spinner state on a button. */
function setLoading(btn, active) {
    btn.classList.toggle('loading', active);
    btn.disabled = active;
}

/**
 * Sets the text and class of a feedback element.
 * @param {Element} el
 * @param {string}  message
 * @param {''|'ok'|'err'|'info'} type
 */
function setFeedback(el, message, type) {
    if (!el) return;
    el.textContent = message;
    el.className = `input-feedback${type ? ` ${type}` : ''}`;
}

/**
 * Highlights an input as invalid and shows a message in its feedback element.
 * Automatically clears the error on next user input.
 *
 * @param {string} inputId    - id of the <input>
 * @param {string} feedbackId - id of the sibling feedback <div>
 * @param {string} message
 */
function showFieldError(inputId, feedbackId, message) {
    const input = document.getElementById(inputId);
    const fb = document.getElementById(feedbackId);
    if (!input) return;

    input.classList.add('invalid');
    input.focus();
    if (fb) setFeedback(fb, message, 'err');

    // Clear the error styling on next keystroke
    input.addEventListener('input', () => {
        input.classList.remove('invalid');
        if (fb) setFeedback(fb, '', '');
    }, { once: true });
}

/**
 * Shows or hides the rate-limit lockout message.
 * @param {string} elId - id of the message element
 * @param {number} seconds - remaining lockout seconds
 */
function showRateMsg(elId, seconds) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.style.display = 'block';
    el.textContent = `Too many attempts. Please wait ${seconds}s before trying again.`;

    // Update countdown every second
    const iv = setInterval(() => {
        seconds--;
        if (seconds <= 0) {
            clearInterval(iv);
            el.style.display = 'none';
        } else {
            el.textContent = `Too many attempts. Please wait ${seconds}s before trying again.`;
        }
    }, 1000);
}

/**
 * Displays a toast notification at the bottom of the card.
 * @param {string}            message
 * @param {'info'|'warn'|'success'} type
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('portal-toast');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `portal-toast-msg portal-toast-${type}`;
    el.textContent = message;  // textContent, not innerHTML — XSS-safe
    container.appendChild(el);

    requestAnimationFrame(() => el.classList.add('visible'));

    setTimeout(() => {
        el.classList.remove('visible');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
    }, 3500);
}