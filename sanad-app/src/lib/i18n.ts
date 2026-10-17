// Language support: English (default) and Arabic (right-to-left).
// - t('English text', vars) for interface text, with {placeholders}
// - tm(msg) for sentences produced by the engine
// - tc(text) for the demo world's own content (names, seeded titles)
// In Arabic mode a small DOM translator also converts any remaining static text nodes and
// attributes, so labels like role names or option text never show up in English.
import { renderMsg, txContent, type Lang } from '../../shared/messages';
import type { Msg } from '../../shared/types';
import { contentAr } from '../../shared/ar-content';
import { UI_AR } from './ar-ui';

export type { Lang };
const KEY = 'sanad.lang';

function readLang(): Lang {
  try {
    const fromHash = location.hash.match(/[?&]lang=(ar|en)/)?.[1] as Lang | undefined;
    if (fromHash) return fromHash;
    const v = localStorage.getItem(KEY);
    return v === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

let current: Lang = readLang();

export const getLang = () => current;
export const isAr = () => current === 'ar';

export function setLangGlobal(lang: Lang) {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* storage unavailable */
  }
  applyDocument();
}

export function applyDocument() {
  document.documentElement.lang = current;
  document.documentElement.dir = current === 'ar' ? 'rtl' : 'ltr';
}

const fill = (tpl: string, vars?: Record<string, string | number>) =>
  vars ? tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : tpl;

/** Interface text. The English string is the key. */
export function t(en: string, vars?: Record<string, string | number>): string {
  return fill(current === 'ar' ? UI_AR[en] ?? en : en, vars);
}

/** Plural helper: t1('{n} challenge', '{n} challenges', n) */
export function tn(one: string, many: string, n: number, vars?: Record<string, string | number>) {
  return t(n === 1 ? one : many, { n, ...vars });
}

export const tm = (m: Msg | null | undefined, fallback = '') => (m ? renderMsg(m, current) : fallback);
export const tc = (text: string | null | undefined) => (text ? txContent(text, current) : '');

/** Locale for dates — Arabic text with Western digits, as used across the UAE. */
export const locale = () => (current === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB');

// ---------------------------------------------------------------- DOM translator
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'svg', 'SVG']);
const ATTRS = ['placeholder', 'aria-label', 'title'];

function translateText(raw: string): string | null {
  const s = raw.trim();
  if (!s || !/[A-Za-z]/.test(s)) return null;
  const direct = UI_AR[s] ?? contentAr[s];
  if (direct) return raw.replace(s, direct);
  if (s.includes('·')) {
    const parts = s.split(/(\s*·\s*)/);
    let changed = false;
    const out = parts.map((p) => {
      const tr = UI_AR[p.trim()] ?? contentAr[p.trim()];
      if (tr) {
        changed = true;
        return p.replace(p.trim(), tr);
      }
      return p;
    });
    if (changed) return raw.replace(s, out.join(''));
  }
  return null;
}

function skip(node: Node): boolean {
  let el: Node | null = node.nodeType === 1 ? node : node.parentNode;
  while (el && el.nodeType === 1) {
    const e = el as Element;
    if (SKIP.has(e.tagName) || e.hasAttribute('data-raw')) return true;
    el = e.parentNode;
  }
  return false;
}

function translateNode(node: Node) {
  if (node.nodeType === 3) {
    if (skip(node)) return;
    const tr = translateText(node.nodeValue ?? '');
    if (tr !== null && tr !== node.nodeValue) node.nodeValue = tr;
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  if (SKIP.has(el.tagName) && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v) {
      const tr = translateText(v);
      if (tr !== null && tr !== v) el.setAttribute(a, tr);
    }
  }
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
  if (el.hasAttribute('data-raw')) return;
  for (const child of Array.from(el.childNodes)) translateNode(child);
}

let observer: MutationObserver | null = null;

export function startDomTranslator(root: HTMLElement) {
  observer?.disconnect();
  observer = null;
  if (current !== 'ar') return;
  translateNode(root);
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') translateNode(r.target);
      else if (r.type === 'attributes') translateNode(r.target);
      else r.addedNodes.forEach(translateNode);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
