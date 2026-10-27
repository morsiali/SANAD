import type { Challenge, Role, View } from '../../shared/types';
import { locale, t, tc, tn } from './i18n';

export function timeAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return t('just now');
  const m = s / 60;
  if (m < 60) return t('{n} min ago', { n: Math.floor(m) });
  const h = m / 60;
  if (h < 24) return t('{n} h ago', { n: Math.floor(h) });
  const d = h / 24;
  if (d < 7) return tn('{n} day ago', '{n} days ago', Math.floor(d));
  return new Date(at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}

export function dateTime(at: number): string {
  return new Date(at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function slaText(c: Challenge, now: number): { text: string; tone: 'ok' | 'soon' | 'late' | 'done' } {
  if (c.stage === 'resolved' || c.stage === 'verified') {
    const inTime = (c.resolvedAt ?? 0) <= c.dueAt;
    return { text: t(inTime ? 'Solved in time' : 'Solved late'), tone: 'done' };
  }
  const mins = (c.dueAt - now) / 60000;
  const abs = Math.abs(mins);
  const span = abs < 60 ? t('{n} min', { n: Math.max(1, Math.round(abs)) }) : abs < 48 * 60 ? t('{n} h', { n: Math.round(abs / 6) / 10 }) : t('{n} days', { n: Math.round(abs / 1440) });
  if (mins < 0) return { text: t('{t} overdue', { t: span }), tone: 'late' };
  return { text: t('{t} left', { t: span }), tone: mins < 60 ? 'soon' : 'ok' };
}

export function greeting(now: number): string {
  const h = new Date(now).getHours();
  return t(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
}

export const firstName = (name: string) => {
  const n = tc(name);
  const dr = /^(Dr\.|د\.)\s/.test(n);
  return n.split(' ').slice(0, dr ? 2 : 1).join(' ');
};

export function recipientName(view: View, id: string): string {
  return tc(view.recipients.find((r) => r.id === id)?.name ?? t('Unknown'));
}

export const ROLE_ICON: Record<Role, string> = {
  self: 'user',
  psychologist: 'brain',
  physio: 'walk',
  educator: 'book',
  admin: 'shield',
  family: 'home',
  caregiver: 'heart',
  doctor: 'stethoscope',
  coordinator: 'compass',
  transport: 'car',
  pharmacy: 'pill',
  social: 'users',
};

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
