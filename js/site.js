// Vernon Auto Repair — front-end behaviour.
// No dependencies. Everything here is progressive: phone links, directions and content
// all work without JavaScript.
import { validateCallback, normalizePhone, formatPhone, LIMITS } from './validate.js';

const CONFIG = {
  // Privacy-friendly analytics. Loaded only after the visitor opts in.
  // Set to '' to switch analytics off entirely (and drop plausible.io from the CSP in _headers).
  analyticsSrc: '',
  turnstileSrc: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
  consentCookie: 'vr_consent',
  consentVersion: 1,
  consentMaxAgeDays: 365,
  shopPhone: '(718) 666-7592',
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ------------------------------------------------------------------ */
/* Small page details                                                  */
/* ------------------------------------------------------------------ */
$$('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });

/* ------------------------------------------------------------------ */
/* Mobile menu                                                         */
/* ------------------------------------------------------------------ */
(function menu() {
  const toggle = $('.menu-toggle');
  const nav = $('#mobile-nav');
  if (!toggle || !nav) return;
  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    nav.hidden = !open;
  };
  toggle.addEventListener('click', () => setOpen(nav.hidden));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !nav.hidden) { setOpen(false); toggle.focus(); }
  });
})();

/* ------------------------------------------------------------------ */
/* Cookie consent                                                      */
/* ------------------------------------------------------------------ */
const gpc = navigator.globalPrivacyControl === true;

function readConsent() {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CONFIG.consentCookie}=([^;]*)`));
  if (!match) return null;
  const parts = /^v(\d+)\.a([01])\.m([01])$/.exec(decodeURIComponent(match[1]));
  if (!parts || Number(parts[1]) !== CONFIG.consentVersion) return null; // re-ask after policy changes
  return { analytics: parts[2] === '1' && !gpc, maps: parts[3] === '1' };
}

function writeConsent(consent) {
  const value = `v${CONFIG.consentVersion}.a${consent.analytics && !gpc ? 1 : 0}.m${consent.maps ? 1 : 0}`;
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CONFIG.consentCookie}=${value}; Max-Age=${CONFIG.consentMaxAgeDays * 86400}; Path=/; SameSite=Lax${secure}`;
}

let analyticsLoaded = false;
function loadAnalytics() {
  if (analyticsLoaded || !CONFIG.analyticsSrc) return;
  analyticsLoaded = true;
  const s = document.createElement('script');
  s.defer = true;
  s.src = CONFIG.analyticsSrc;
  s.dataset.domain = location.hostname;
  document.head.appendChild(s);
}

const mapFrame = $('#map-frame');
function loadMap() {
  if (!mapFrame || mapFrame.classList.contains('is-loaded')) return;
  const iframe = document.createElement('iframe');
  iframe.src = mapFrame.dataset.src;
  iframe.title = 'Google Map showing Vernon Auto Repair at 38-01 Vernon Blvd, Long Island City';
  iframe.loading = 'lazy';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.allowFullscreen = true;
  mapFrame.appendChild(iframe);
  mapFrame.classList.add('is-loaded');
}
function unloadMap() {
  if (!mapFrame) return;
  $('iframe', mapFrame)?.remove();
  mapFrame.classList.remove('is-loaded');
}

function applyConsent(next, prev) {
  if (next.analytics) loadAnalytics();
  if (next.maps) loadMap(); else if (prev?.maps) unloadMap();
  // A script that's already running can't be unloaded; reload so it's gone.
  if (prev?.analytics && !next.analytics && analyticsLoaded) location.reload();
}

(function consentUi() {
  const banner = $('#cookie-banner');
  const dialog = $('#cookie-dialog');
  const analyticsBox = $('#consent-analytics');
  const mapsBox = $('#consent-maps');
  let current = readConsent();

  if (current) applyConsent(current, null);
  else if (banner) banner.hidden = false;

  if (gpc) {
    if (analyticsBox) { analyticsBox.checked = false; analyticsBox.disabled = true; }
    const note = $('#gpc-note');
    if (note) note.hidden = false;
  }

  const save = (next) => {
    const prev = current;
    writeConsent(next);
    current = readConsent() || next;
    if (banner) banner.hidden = true;
    if (dialog?.open) dialog.close();
    applyConsent(current, prev);
  };

  const openDialog = () => {
    if (!dialog) return;
    const c = current || { analytics: false, maps: false };
    if (analyticsBox) analyticsBox.checked = c.analytics && !gpc;
    if (mapsBox) mapsBox.checked = c.maps;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-consent], [data-cookie-settings], [data-dialog-close], [data-load-map]');
    if (!el) return;
    if (el.matches('[data-cookie-settings]')) return openDialog();
    if (el.matches('[data-dialog-close]')) return dialog?.close();
    if (el.matches('[data-load-map]')) return loadMap(); // one-off load for this page view only
    const choice = el.dataset.consent;
    if (choice === 'all') save({ analytics: true, maps: true });
    else if (choice === 'essential') save({ analytics: false, maps: false });
    else if (choice === 'save') save({ analytics: !!analyticsBox?.checked, maps: !!mapsBox?.checked });
  });
})();

/* ------------------------------------------------------------------ */
/* Callback form                                                       */
/* ------------------------------------------------------------------ */
(function callbackForm() {
  const form = $('#callback-form');
  if (!form) return;

  // "Call us" mode: used when the site is hosted without the form backend
  // (data-form="off" on <html>), or when the server says the form isn't configured.
  const formOff = $('#form-off');
  function switchFormOff() {
    form.hidden = true;
    if (formOff) formOff.hidden = false;
    const title = $('#contact-title');
    const intro = $('#contact-intro');
    const urgent = $('#contact-urgent');
    if (title) title.textContent = 'Get in touch';
    if (intro) intro.textContent = 'The quickest way to reach us is by phone, any time of day or night. You can also stop by the shop at 38-01 Vernon Blvd.';
    if (urgent) urgent.hidden = true;
  }
  if (document.documentElement.dataset.form === 'off') { switchFormOff(); return; }

  const fields = ['name', 'phone', 'vehicle', 'problem'];
  const input = (name) => form.elements.namedItem(name);
  const status = $('#form-status');
  const statusText = $('#form-status-text');
  const submit = $('#form-submit');
  const spinner = $('#form-spinner');
  const submitLabel = $('#form-submit-label');
  const success = $('#form-success');
  const counter = $('#f-problem-count');
  const captchaEl = $('[data-captcha]', form);
  const touched = new Set();

  const FALLBACK = `We couldn’t send your request just now. Please call us at ${CONFIG.shopPhone}. We’re open 24 hours.`;

  let session = null;          // { csrfToken, turnstileSiteKey }
  let sessionPromise = null;
  let turnstilePromise = null;
  let widgetId = null;
  let captchaToken = '';

  /* --- UI helpers --- */
  function showStatus(message) {
    statusText.textContent = message;
    status.hidden = false;
  }
  function hideStatus() { status.hidden = true; statusText.textContent = ''; }

  function setFieldError(name, message) {
    const el = input(name);
    const err = $(`#f-${name}-error`);
    if (!el || !err) return;
    if (message) {
      el.setAttribute('aria-invalid', 'true');
      $('span', err).textContent = message;
      err.hidden = false;
    } else {
      el.removeAttribute('aria-invalid');
      $('span', err).textContent = '';
      err.hidden = true;
    }
  }
  function showErrors(errors) {
    fields.forEach((f) => setFieldError(f, errors[f]));
  }
  function focusField(name) {
    const el = input(name);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.closest('.field')?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function readValues() {
    const v = {};
    fields.forEach((f) => { v[f] = input(f).value; });
    v.company = input('company').value; // honeypot
    return v;
  }
  function setBusy(busy) {
    submit.disabled = busy;
    spinner.hidden = !busy;
    submitLabel.textContent = busy ? 'Sending…' : 'Request callback';
  }

  /* --- Live validation, gentle: only after a field has been left once --- */
  form.addEventListener('focusout', (e) => {
    const name = e.target.name;
    if (!fields.includes(name)) return;
    touched.add(name);
    if (name === 'phone') {
      const digits = normalizePhone(e.target.value);
      if (digits) e.target.value = formatPhone(digits);
    }
    const { errors } = validateCallback(readValues());
    setFieldError(name, e.target.value.trim() ? errors[name] : '');
  });
  form.addEventListener('input', (e) => {
    const name = e.target.name;
    if (name === 'problem') counter.textContent = `${e.target.value.length} / ${LIMITS.problem.max}`;
    if (touched.has(name) && e.target.getAttribute('aria-invalid') === 'true') {
      const { errors } = validateCallback(readValues());
      setFieldError(name, errors[name]);
    }
  });

  /* --- Session (CSRF token + CAPTCHA site key), fetched only when the form is near --- */
  function ensureSession(force = false) {
    if (force) { session = null; sessionPromise = null; }
    if (session) return Promise.resolve(session);
    if (!sessionPromise) {
      sessionPromise = fetch('/api/session', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('session'))))
        .then((data) => {
          if (data && data.formEnabled === false) { switchFormOff(); throw new Error('form-off'); }
          if (!data || typeof data.csrfToken !== 'string') throw new Error('session');
          session = data;
          return renderCaptcha(data.turnstileSiteKey).then(() => session);
        })
        .catch((err) => { sessionPromise = null; throw err; });
    }
    return sessionPromise;
  }

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!turnstilePromise) {
      turnstilePromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = CONFIG.turnstileSrc;
        s.async = true;
        s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
        s.onerror = () => { turnstilePromise = null; reject(new Error('turnstile')); };
        document.head.appendChild(s);
      });
    }
    return turnstilePromise;
  }

  function renderCaptcha(siteKey) {
    if (widgetId !== null || !captchaEl) return Promise.resolve();
    if (!siteKey) return Promise.reject(new Error('captcha-config'));
    return loadTurnstile().then((ts) => {
      if (widgetId !== null) return;
      widgetId = ts.render(captchaEl, {
        sitekey: siteKey,
        action: 'callback',
        theme: 'light',
        size: 'flexible',
        callback: (token) => { captchaToken = token; },
        'expired-callback': () => { captchaToken = ''; },
        'error-callback': () => { captchaToken = ''; },
      });
    });
  }

  function resetCaptcha() {
    captchaToken = '';
    if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId);
  }

  const warmUp = () => ensureSession().catch(() => {});
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) { io.disconnect(); warmUp(); }
    }, { rootMargin: '600px 0px' });
    io.observe(form);
  } else {
    warmUp();
  }
  form.addEventListener('focusin', warmUp, { once: true });

  /* --- Submit --- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideStatus();

    const values = readValues();
    const { ok, errors } = validateCallback(values);
    fields.forEach((f) => touched.add(f));
    showErrors(errors);
    if (!ok) {
      focusField(fields.find((f) => errors[f]));
      return;
    }

    setBusy(true);
    try {
      try {
        await ensureSession();
      } catch {
        showStatus(FALLBACK);
        return;
      }
      if (!captchaToken) {
        showStatus('Please complete the security check above the button, then press Request callback again.');
        captchaEl?.scrollIntoView({ block: 'center' });
        return;
      }

      let res;
      let data = {};
      try {
        res = await fetch('/api/contact', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-CSRF-Token': session.csrfToken,
          },
          body: JSON.stringify({
            name: values.name,
            phone: values.phone,
            vehicle: values.vehicle,
            problem: values.problem,
            company: values.company,
            csrfToken: session.csrfToken,
            turnstileToken: captchaToken,
          }),
        });
        data = await res.json().catch(() => ({}));
      } catch {
        showStatus(FALLBACK);
        return;
      } finally {
        resetCaptcha(); // CAPTCHA tokens are single-use
      }

      if (res.ok && data.ok) {
        form.reset();
        counter.textContent = `0 / ${LIMITS.problem.max}`;
        touched.clear();
        form.hidden = true;
        success.hidden = false;
        success.focus();
        return;
      }

      if (res.status === 422 && data.errors) {
        showErrors(data.errors);
        const first = fields.find((f) => data.errors[f]);
        if (first) focusField(first);
        else showStatus(typeof data.message === 'string' ? data.message : FALLBACK);
        return;
      }
      if (res.status === 403 && data.error === 'session_expired') {
        ensureSession(true).catch(() => {});
        showStatus('This page was open for a while, so we refreshed its security check. Please press Request callback again.');
        return;
      }
      showStatus(typeof data.message === 'string' ? data.message : FALLBACK);
    } finally {
      setBusy(false);
    }
  });

  $('#form-again')?.addEventListener('click', () => {
    success.hidden = true;
    form.hidden = false;
    hideStatus();
    input('name').focus();
  });
})();
