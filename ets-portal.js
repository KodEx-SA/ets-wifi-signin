/* ========== Canvas Network Animation ========== */
const canvas = document.getElementById('bg');
const ctx = canvas.getContext('2d');
let W, H, nodes;

function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
}

function initNodes() {
    nodes = Array.from({ length: 70 }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 1.8 + 0.6
    }));
}

function drawNetwork() {
    ctx.clearRect(0, 0, W, H);
    nodes.forEach(n => {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > W) n.vx *= -1;
        if (n.y < 0 || n.y > H) n.vy *= -1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,210,255,0.45)';
        ctx.fill();
    });
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

resize(); initNodes(); drawNetwork();
window.addEventListener('resize', () => { resize(); initNodes(); });

/* ========== Tab Switching ========== */
document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    });
});

/* ========== Password Toggle ========== */
function togglePw(id, btn) {
    const inp = document.getElementById(id);
    const isText = inp.type === 'text';
    inp.type = isText ? 'password' : 'text';
    btn.innerHTML = isText
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/></svg>`;
}

/* ========== SA ID Validation ========== */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function luhnCheck(id) {
    let sum = 0, alt = false;
    for (let i = id.length - 1; i >= 0; i--) {
        let n = parseInt(id[i]);
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n;
        alt = !alt;
    }
    return sum % 10 === 0;
}

function parseID(id) {
    const yy = id.slice(0, 2), mm = id.slice(2, 4), dd = id.slice(4, 6);
    const genderSeq = parseInt(id.slice(6, 10));
    const citizenship = id[10] === '0' ? 'SA Citizen' : 'Permanent Resident';
    const gender = genderSeq >= 5000 ? 'Male' : 'Female';
    const currentYY = new Date().getFullYear() % 100;
    const century = parseInt(yy) <= currentYY ? '20' : '19';
    const fullYear = century + yy;
    const dobDate = new Date(`${fullYear}-${mm}-${dd}`);
    const today = new Date();
    let age = today.getFullYear() - dobDate.getFullYear();
    const m = today.getMonth() - dobDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dobDate.getDate())) age--;
    const dobDisplay = `${dd} ${MONTHS[parseInt(mm) - 1]} ${fullYear}`;
    const dobISO = `${fullYear}-${mm}-${dd}`;
    return { dobDisplay, dobISO, gender, citizenship, age };
}

let idMode = 'register'; // 'register' | 'signin'

const idInput = document.getElementById('id-number');
const idFeedback = document.getElementById('id-feedback');
const idInfoBox = document.getElementById('id-info-box');
const idSubmit = document.getElementById('id-submit-btn');
const idBtnText = document.getElementById('id-btn-text');

idInput.addEventListener('input', () => {
    const val = idInput.value.replace(/\D/g, '');
    idInput.value = val;
    idInput.classList.remove('valid', 'invalid');
    idInfoBox.classList.remove('show');
    idFeedback.className = 'input-feedback';
    idFeedback.textContent = '';
    document.getElementById('id-register-fields').style.display = 'none';
    document.getElementById('id-returning-fields').style.display = 'none';
    document.getElementById('id-toggle-text').style.display = 'none';
    idSubmit.disabled = true;
    idBtnText.textContent = 'Enter Valid ID Number';

    if (val.length === 0) return;

    if (val.length < 13) {
        idFeedback.textContent = `${13 - val.length} digits remaining`;
        idFeedback.className = 'input-feedback info';
        return;
    }

    if (val.length === 13) {
        // Validate month/day
        const mm = parseInt(val.slice(2, 4));
        const dd = parseInt(val.slice(4, 6));
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

        // Valid!
        idInput.classList.add('valid');
        idFeedback.textContent = '✓ Valid South African ID';
        idFeedback.className = 'input-feedback ok';

        const info = parseID(val);
        document.getElementById('info-dob').textContent = info.dobDisplay;
        document.getElementById('info-gender').textContent = info.gender;
        document.getElementById('info-age').textContent = `${info.age} years`;
        document.getElementById('info-citizenship').textContent = info.citizenship;
        idInfoBox.classList.add('show');

        // Auto-fill fields
        document.getElementById('id-dob').value = info.dobISO;
        document.getElementById('id-gender-field').value = info.gender;

        showIdFields(info);
    }
});

function showIdFields(info) {
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
    idSubmit.disabled = false;
}

function toggleIdMode() {
    idMode = idMode === 'register' ? 'signin' : 'register';
    if (idInput.classList.contains('valid')) {
        const info = parseID(idInput.value);
        showIdFields(info);
    }
}

idSubmit.addEventListener('click', () => {
    setLoading(idSubmit, true);
    setTimeout(() => {
        setLoading(idSubmit, false);
        document.getElementById('id-main-form').style.display = 'none';
        document.getElementById('id-success').classList.add('show');
    }, 1800);
});

/* ========== Email Forms ========== */
function showEmailLogin() {
    document.getElementById('email-login-form').style.display = 'block';
    document.getElementById('email-register-form').style.display = 'none';
}
function showEmailRegister() {
    document.getElementById('email-login-form').style.display = 'none';
    document.getElementById('email-register-form').style.display = 'block';
}

function handleEmailSubmit() {
    const btn = event.currentTarget;
    setLoading(btn, true);
    setTimeout(() => {
        setLoading(btn, false);
        document.getElementById('email-login-form').style.display = 'none';
        document.getElementById('email-success').classList.add('show');
    }, 1800);
}

function handleEmailRegister() {
    const pw = document.getElementById('reg-pw').value;
    const pw2 = document.getElementById('reg-pw2').value;
    if (pw !== pw2) { alert('Passwords do not match.'); return; }
    const btn = event.currentTarget;
    setLoading(btn, true);
    setTimeout(() => {
        setLoading(btn, false);
        document.getElementById('email-register-form').style.display = 'none';
        document.getElementById('email-success').classList.add('show');
    }, 1800);
}

/* ========== Phone OTP ========== */
let otpTimer, otpSeconds = 300;

function sendOTP() {
    const phone = document.getElementById('phone-number').value.trim();
    if (!phone) { alert('Please enter your phone number.'); return; }
    const btn = document.querySelector('#phone-entry .btn-primary');
    setLoading(btn, true);
    setTimeout(() => {
        setLoading(btn, false);
        document.getElementById('otp-phone-display').textContent = phone;
        document.getElementById('phone-entry').style.display = 'none';
        document.getElementById('otp-section').classList.add('visible');
        startOTPTimer();
        document.querySelectorAll('.otp-digit')[0].focus();
    }, 1200);
}

function startOTPTimer() {
    otpSeconds = 300;
    document.getElementById('resend-btn').disabled = true;
    clearInterval(otpTimer);
    otpTimer = setInterval(() => {
        otpSeconds--;
        const m = Math.floor(otpSeconds / 60);
        const s = String(otpSeconds % 60).padStart(2, '0');
        document.getElementById('otp-countdown').textContent = `${m}:${s}`;
        if (otpSeconds <= 0) {
            clearInterval(otpTimer);
            document.getElementById('resend-btn').disabled = false;
            document.getElementById('otp-countdown').textContent = 'Expired';
        }
    }, 1000);
}

function resendOTP() {
    startOTPTimer();
    document.querySelectorAll('.otp-digit').forEach(i => i.value = '');
    document.querySelectorAll('.otp-digit')[0].focus();
}

function backToPhone() {
    clearInterval(otpTimer);
    document.getElementById('phone-entry').style.display = 'block';
    document.getElementById('otp-section').classList.remove('visible');
}

// OTP digit navigation
document.querySelectorAll('.otp-digit').forEach((inp, idx, all) => {
    inp.addEventListener('input', () => {
        inp.value = inp.value.replace(/\D/, '');
        if (inp.value && idx < all.length - 1) all[idx + 1].focus();
    });
    inp.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !inp.value && idx > 0) all[idx - 1].focus();
    });
});

function verifyOTP() {
    const code = [...document.querySelectorAll('.otp-digit')].map(i => i.value).join('');
    if (code.length < 6) { alert('Please enter the complete 6-digit code.'); return; }
    const btn = event.currentTarget;
    setLoading(btn, true);
    setTimeout(() => {
        clearInterval(otpTimer);
        setLoading(btn, false);
        document.getElementById('otp-section').classList.remove('visible');
        document.getElementById('phone-success').classList.add('show');
    }, 1500);
}

/* ========== Social / Guest ========== */
function handleSocialLogin(provider) {
    const btn = event.currentTarget;
    setLoading(btn, true);
    setTimeout(() => {
        setLoading(btn, false);
        document.querySelector('#panel-social > div:first-child').style.display = 'none';
        document.getElementById('social-success').classList.add('show');
    }, 1800);
}

function handleGuestConnect() {
    const name = document.getElementById('guest-name').value.trim();
    const agreed = document.getElementById('guest-terms').checked;
    if (!name) { alert('Please enter your name.'); return; }
    if (!agreed) { alert('Please accept the Terms of Use.'); return; }
    const btn = event.currentTarget;
    setLoading(btn, true);
    setTimeout(() => {
        setLoading(btn, false);
        document.getElementById('social-success').classList.add('show');
    }, 1500);
}

/* ========== Loading Helper ========== */
function setLoading(btn, state) {
    if (state) btn.classList.add('loading');
    else btn.classList.remove('loading');
}