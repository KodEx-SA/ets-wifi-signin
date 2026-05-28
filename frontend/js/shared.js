'use strict';

// ================================================================
// THEME
// ================================================================
const Theme = (() => {
  const KEY = 'ets-theme';
  const html = document.documentElement;

  function apply(theme) {
    html.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);
  }

  function toggle() {
    apply(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  }

  function init() {
    const saved = localStorage.getItem(KEY);
    const preferred = window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light' : 'dark';
    apply(saved || preferred);
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.addEventListener('click', toggle);
    });
  }

  return { init, toggle, apply };
})();

// ================================================================
// ESCAPE HTML — prevents XSS in all innerHTML usage
// ================================================================
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ================================================================
// TOAST NOTIFICATIONS
// ================================================================
const Toast = (() => {
  const ICONS = {
    success: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00e87a" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    warn: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffb020" stroke-width="2.5" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    error: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff3b5c" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    info: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00d2ff" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  };

  function show(message, type = 'info', duration = 3500) {
    let container = document.getElementById('toast-container');

    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = (ICONS[type] || ICONS.info) + `<span>${escapeHtml(message)}</span>`;
    container.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    setTimeout(() => {
      el.classList.remove('show');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
    }, duration);
  }

  return {
    show,
    success: m => show(m, 'success'),
    warn: m => show(m, 'warn'),
    error: m => show(m, 'error'),
    info: m => show(m, 'info'),
  };
})();

// ================================================================
// CONFIRM MODAL
// ================================================================
const Modal = {
  confirm(title, body, isDanger = true) {
    
    return new Promise(resolve => {
      document.getElementById('ets-modal')?.remove();
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.id = 'ets-modal';
      backdrop.innerHTML = `
        <div class="modal-box">
          <div class="modal-title">${escapeHtml(title)}</div>
          <div class="modal-body">${escapeHtml(body)}</div>
          <div class="modal-footer">
            <button class="btn btn-ghost btn-sm" id="modal-cancel">Cancel</button>
            <button class="btn btn-sm ${isDanger ? 'btn-danger' : 'btn-primary'}"
                    id="modal-ok">Confirm</button>
          </div>
        </div>`;
        
      document.body.appendChild(backdrop);
      requestAnimationFrame(() => backdrop.classList.add('show'));
      backdrop.querySelector('#modal-ok').addEventListener('click',
        () => { backdrop.remove(); resolve(true); });
      backdrop.querySelector('#modal-cancel').addEventListener('click',
        () => { backdrop.remove(); resolve(false); });
      backdrop.addEventListener('click',
        e => { if (e.target === backdrop) { backdrop.remove(); resolve(false); } });
    });
  }
};

// ================================================================
// API CLIENT
// ================================================================
const API = (() => {
  const BASE = '/api';

  function getAccessToken() { return sessionStorage.getItem('ets-access-token'); }
  function getSessionToken() { return sessionStorage.getItem('ets-session-token'); }

  function saveAuth(data) {
    if (data.accessToken) sessionStorage.setItem('ets-access-token', data.accessToken);
    if (data.sessionToken) sessionStorage.setItem('ets-session-token', data.sessionToken);
  }

  function clearAuth() {
    sessionStorage.removeItem('ets-access-token');
    sessionStorage.removeItem('ets-session-token');
  }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getAccessToken();
    
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const sToken = getSessionToken();
    if (sToken) headers['X-Session-Token'] = sToken;

    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({ error: 'Invalid server response.' }));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { status: res.status });
    return data;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path) => request('DELETE', path),
    saveAuth,
    clearAuth,
    getAccessToken,
    getSessionToken,
  };
})();

// ================================================================
// VALIDATORS
// ================================================================
const Validator = {
  name(v) { // expects full name with at least 2 characters and a space, allows letters, spaces, apostrophes, and hyphens
    const s = v?.trim() ?? '';
    if (!s) return { valid: false, message: 'Please enter your full name.' };
    if (s.length < 2) return { valid: false, message: 'Name must be at least 2 characters.' };
    if (!s.includes(' ')) return { valid: false, message: 'Please enter first and last name.' };
    if (!/^[\p{L}\s'\-]+$/u.test(s)) return { valid: false, message: 'Name contains invalid characters.' };
    return { valid: true };
  },
  
  email(v) { // basic email format validation
    const s = v?.trim() ?? '';
    if (!s) return { valid: false, message: 'Please enter your email address.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s))
      return { valid: false, message: 'Please enter a valid email address.' };
    return { valid: true };
  },
  
  password(v) { // checks for minimum length and character variety, returns a strength score
    if (!v) return { valid: false, message: 'Please create a password.', score: 0 };
    if (v.length < 8) return { valid: false, message: 'Password must be at least 8 characters.', score: 1 };
    const score = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(v)).length;
    if (score < 2) return { valid: false, message: 'Add uppercase, lowercase, numbers or symbols.', score };
    return { valid: true, score };
  },
  
  passwordsMatch(pw, pw2) { // checks if password and confirmation match
    if (!pw2) return { valid: false, message: 'Please confirm your password.' };
    if (pw !== pw2) return { valid: false, message: 'Passwords do not match.' };
    return { valid: true };
  },
  
  phone(v, dial = '+27') { // validates phone numbers for various country codes, normalises input by removing spaces, dashes, and parentheses
    const d = v?.replace(/[\s\-()]/g, '') ?? '';
    if (!d) return { valid: false, message: 'Please enter your mobile number.' };
    
    const rules = { // regex patterns for different country dialing codes, can be expanded as needed
      '+27': /^0?[678]\d{8}$/, '+263': /^0?\d{8,9}$/,
      '+267': /^\d{7,8}$/, '+258': /^\d{8,9}$/,
      '+254': /^0?\d{9}$/, '+234': /^0?\d{8,10}$/,
      '+1': /^\d{10}$/, '+44': /^0?\d{10}$/,
    };
    
    if (!rules[dial]?.test(d)) return { valid: false, message: 'Invalid phone number format.' };
    return { valid: true };
  },

  saId(v) { // validates South African ID numbers, checks length, date of birth, age, and checksum
    const id = v?.trim() ?? '';
    if (id.length !== 13 || /\D/.test(id)) // must be exactly 13 digits
      return { valid: false, message: 'ID must be exactly 13 digits.' };

    const yy = +id.slice(0, 2), mm = +id.slice(2, 4), dd = +id.slice(4, 6); // extract date of birth components
    const cy = yy <= new Date().getFullYear() % 100 ? 2000 : 1900; // determine century based on current year
    const dob = new Date(cy + yy, mm - 1, dd); // create date object (months are 0-indexed)
    
    if (dob.getMonth() !== mm - 1 || dob.getDate() !== dd)
      return { valid: false, message: 'Invalid date in ID number.' };
    
    let age = new Date().getFullYear() - dob.getFullYear();
    const t = new Date();
    
    if (t.getMonth() < dob.getMonth() ||
      (t.getMonth() === dob.getMonth() && t.getDate() < dob.getDate())) age--;
    if (age < 18) return { valid: false, message: 'You must be at least 18 years old.' };
    
    let sum = 0, alt = false;
    for (let i = id.length - 1; i >= 0; i--) { // Luhn algorithm for checksum validation
      let n = +id[i]; // eslint-disable-line no-unused-vars

      if (alt) { // double every second digit and sum digits if >9
        n *= 2; if (n > 9) n -= 9; // eslint-disable-line no-unused-vars
      }
      sum += n; alt = !alt;
    }

    if (sum % 10 !== 0) return { valid: false, message: 'Invalid ID number - checksum failed.' };
    return { valid: true };
  },
};

// ================================================================
// UI HELPERS
// ================================================================
function setLoading(btn, active) {
  if (!btn) return;
  btn.classList.toggle('loading', active);
  btn.disabled = active;
}

function setFeedback(el, message, type = '') {
  if (!el) return;
  el.textContent = message;
  el.className = `input-feedback${type ? ' ' + type : ''}`;
}

function showFieldError(inputId, feedbackId, message) {
  const input = document.getElementById(inputId);
  const fb = document.getElementById(feedbackId);
  if (!input) return;
  input.classList.add('invalid');
  if (fb) setFeedback(fb, message, 'err');
  input.focus();
  input.addEventListener('input', () => {
    input.classList.remove('invalid');
    if (fb) setFeedback(fb, '', '');
  }, { once: true });
}

function updateStrengthMeter(prefix, password) {
  const levels = ['', 'weak', 'fair', 'good', 'strong'];
  const { score } = Validator.password(password || '');
  const level = password ? Math.max(1, score) : 0;
  for (let i = 1; i <= 4; i++) {
    const bar = document.getElementById(`${prefix}-bar-${i}`);
    if (bar) bar.className = `pw-strength-bar${i <= level ? ' ' + levels[level] : ''}`;
  }
  const lbl = document.getElementById(`${prefix}-strength-label`);
  if (lbl) lbl.textContent = levels[level] ? levels[level].charAt(0).toUpperCase() +
    levels[level].slice(1) : '';
}

const EYE_OPEN = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_CLOSED = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/></svg>`;

function wirePasswordToggles() {
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const isText = input.type === 'text';
      input.type = isText ? 'password' : 'text';
      btn.innerHTML = isText ? EYE_OPEN : EYE_CLOSED;
    });
  });
}

function getDeviceFingerprint() {
  const KEY = 'ets-device-id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    id = Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
    localStorage.setItem(KEY, id);
  }
  return id;
}

// ================================================================
// INIT
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  Theme.init();
  wirePasswordToggles();
});
