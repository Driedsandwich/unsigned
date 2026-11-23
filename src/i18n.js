import { EN_MESSAGES } from './messages-en.js';

const STORAGE_KEY = 'unsigned-lang';

export const LOCALES = Object.freeze(['en', 'ja']);

let locale = 'en';
let jaMessages = null;
const listeners = new Set();
const tables = { en: EN_MESSAGES };

async function ensureJa() {
  if (!jaMessages) {
  const mod = await import('./messages-ja.js');
  jaMessages = mod.JA_MESSAGES;
  tables.ja = jaMessages;
  }
  return jaMessages;
}

function readStorage() {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (value === 'ja' || value === 'en') return value;
  } catch {}
  return null;
}

function writeStorage(value) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, value);
  } catch {}
}

export function resolveLocale(search = globalThis.location?.search ?? '') {
  const params = new URLSearchParams(search);
  const fromUrl = params.get('lang');
  if (fromUrl === 'ja' || fromUrl === 'en') {
    writeStorage(fromUrl);
    return fromUrl;
  }
  return readStorage() ?? 'en';
}

export function getLocale() {
  return locale;
}

export async function setLocale(next) {
  const value = next === 'ja' ? 'ja' : 'en';
  if (value === 'ja') await ensureJa();
  if (value === locale) return locale;
  locale = value;
  writeStorage(value);
  if (typeof document !== 'undefined') document.documentElement.lang = value;
  for (const fn of listeners) fn(value);
  return locale;
}

export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key, vars = {}) {
  const table = tables[locale] ?? tables.en;
  let text = table[key] ?? tables.en[key] ?? key;
  for (const [name, replacement] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(replacement));
  }
  return text;
}

export async function dictForTests() {
  await ensureJa();
  return tables;
}

export function applyStaticI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const key = el.dataset.i18n;
    if (el.dataset.i18nHtml === 'true') el.innerHTML = t(key);
    else el.textContent = t(key);
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
}

export async function initI18n() {
  locale = resolveLocale();
  if (locale === 'ja') await ensureJa();
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    applyStaticI18n();
    syncLangToggle();
    syncJaIntro();
  }
}

export function syncLangToggle() {
  if (typeof document === 'undefined') return;
  for (const el of document.querySelectorAll('[data-locale]')) {
    el.setAttribute('aria-pressed', String(el.dataset.locale === locale));
  }
}

export function syncJaIntro() {
  if (typeof document === 'undefined') return;
  const intro = document.getElementById('ja-intro');
  if (!intro) return;
  intro.hidden = locale !== 'ja';
  if (locale === 'ja') {
    const body = intro.querySelector('[data-i18n="jaIntroHtml"]');
    if (body) body.innerHTML = t('jaIntroHtml');
  }
}

export function bindLangToggle(onChange = () => {}) {
  for (const el of document.querySelectorAll('[data-locale]')) {
    el.addEventListener('click', () => { void setLocale(el.dataset.locale).then(onChange); });
  }
}

export function riskCategoryLabel(category, advisory = false) {
  const map = {
    name: 'categoryName',
    date: 'categoryDate',
    weekday: 'categoryWeekday',
    'uncommon role': 'categoryRole',
    'other identifying detail': 'categoryOther',
  };
  const label = t(map[category] ?? 'categoryOther');
  return advisory ? `${t('categoryAiAdvisory')}: ${label}` : label;
}

export function sourceLabelI18n(result) {
  if (result?.simulated && result.cloudFallback) return t('sourceSimulatedCloud');
  if (result?.simulated) return t('sourceSimulated');
  if (result?.source === 'on_device') return t('sourceOnDevice');
  if (result?.source === 'in_cloud') return t('sourceInCloud');
  return t('sourceNotRun');
}

export function translateRespondentCopy(message) {
  if (!message || locale === 'en') return message;
  const structured = message.match(/^(.+)\. Choose a structured answer\. Your original text was not sent to cloud AI\.$/);
  if (structured) return t('errStructuredFallback', { detail: structured[1] });
  const review = message.match(/^AI check unavailable — review the draft yourself \((.+)\)$/);
  if (review) return t('errReviewUnavailable', { detail: review[1] });
  if (message.startsWith('Could not confirm delivery.')) return t('errSubmit');
  return message;
}