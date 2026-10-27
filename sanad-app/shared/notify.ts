// Quiet hours and muting for in-app notifications. Pure functions, shared by server and browser.
import type { NotifyPrefs } from './types';

export const DEFAULT_PREFS: NotifyPrefs = { tz: 'Asia/Dubai', quiet: false, quietFrom: '22:00', quietTo: '07:00', urgentThrough: true, muted: [] };

export const MUTABLE: NotifyPrefs['muted'] = ['reminders', 'updates', 'monitoring'];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Cleans preferences sent by a client; returns null when something is not acceptable. */
export function cleanPrefs(p: Partial<NotifyPrefs> | undefined): NotifyPrefs | null {
  if (!p || typeof p !== 'object') return null;
  const tz = String(p.tz ?? '');
  if (!validTimeZone(tz)) return null;
  const from = String(p.quietFrom ?? '');
  const to = String(p.quietTo ?? '');
  if (!HHMM.test(from) || !HHMM.test(to) || from === to) return null;
  const muted = Array.isArray(p.muted) ? [...new Set(p.muted.filter((m) => MUTABLE.includes(m)))] : [];
  return { tz, quiet: p.quiet === true, quietFrom: from, quietTo: to, urgentThrough: p.urgentThrough !== false, muted };
}

/** Minutes since local midnight in a time zone. */
export function localMinutes(at: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
  const h = Number(parts.find((x) => x.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((x) => x.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}

const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** When quiet hours are on and `at` falls inside them: the moment they end. Otherwise null. */
export function quietUntil(prefs: NotifyPrefs | undefined, at: number): number | null {
  if (!prefs?.quiet) return null;
  const now = localMinutes(at, prefs.tz);
  const from = mins(prefs.quietFrom);
  const to = mins(prefs.quietTo);
  const inside = from < to ? now >= from && now < to : now >= from || now < to;
  if (!inside) return null;
  const wait = (to - now + 1440) % 1440;
  const until = at + wait * 60_000;
  return until - (until % 60_000);
}

/** Which muting group a notification belongs to (escalations and approvals are never muted). */
export type NotifyGroup = 'reminders' | 'updates' | 'monitoring' | 'always';
