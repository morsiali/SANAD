// Read-only helpers for the people dashboard and profiles. Everything works on the filtered view,
// so a card or alert can only ever be built from information this user is allowed to see.
import type { Domain, Medication, Membership, Recipient, View } from '../../shared/types';
import { isActive } from '../../shared/routing';
import { DOMAINS, OPTIONAL_DOMAINS, isLive } from '../../shared/access';
import { dayKey, doseSlots, refillForecast, slotTime } from '../../shared/records';
import { tc } from './i18n';

export const canSeeDomain = (view: View, recipientId: string, d: Domain) => !!view.access[recipientId]?.includes(d);

/** People this user can open a profile for (care team, or their organisation for coordinators/admins). */
export const myPeople = (view: View): Recipient[] => view.recipients.filter((r) => !r.limited && view.access[r.id]);

export const myMembership = (view: View, recipientId: string, now = Date.now()): Membership | undefined =>
  view.memberships.find((m) => m.userId === view.me && m.recipientId === recipientId && isLive(m, now));

/** Tabs to show: domains the viewer can read, minus sections hidden for this person (overview/team/history always shown when allowed). */
export function profileTabs(view: View, r: Recipient): (Domain | 'history')[] {
  const can = view.access[r.id] ?? [];
  const tabs: (Domain | 'history')[] = DOMAINS.filter((d) => d !== 'wellbeing_notes' && can.includes(d) && !(OPTIONAL_DOMAINS.includes(d) && r.hidden?.includes(d)));
  // Private notes live inside the well-being tab; a psychologist without general well-being access still gets the tab.
  if (can.includes('wellbeing_notes') && !tabs.includes('wellbeing')) tabs.splice(1, 0, 'wellbeing');
  tabs.push('history');
  return tabs;
}

export interface NextDose {
  med: Medication;
  slot: string;
  at: number;
}

/** The next scheduled dose today or tomorrow (only for people whose medical record the viewer can see). */
export function nextDose(view: View, recipientId: string, now: number): NextDose | null {
  if (!canSeeDomain(view, recipientId, 'medical')) return null;
  const meds = view.medications.filter((m) => m.recipientId === recipientId && m.active);
  const all: NextDose[] = [];
  for (const day of [dayKey(now), dayKey(now + 86_400_000)]) {
    for (const med of meds) for (const s of doseSlots(med, view.doseLogs, day)) all.push({ med, slot: s.slot, at: slotTime(s.slot) });
  }
  return all.filter((x) => x.at >= now).sort((a, b) => a.at - b.at)[0] ?? null;
}

export interface PersonAlert {
  key: string;
  tone: 'warn' | 'info';
  text: string;
  vars?: Record<string, string | number>;
  to: string;
}

/**
 * Carefully scoped alerts: each one only appears when the viewer can see the domain it comes from,
 * and says no more than needed (details stay inside the profile).
 */
export function alertsFor(view: View, r: Recipient, now: number): PersonAlert[] {
  const out: PersonAlert[] = [];
  const base = `/app/people/${r.id}`;
  if (canSeeDomain(view, r.id, 'medical')) {
    const meds = view.medications.filter((m) => m.recipientId === r.id && m.active);
    const refill = meds.filter((m) => refillForecast(m, now).due);
    if (refill.length) out.push({ key: 'refill', tone: 'warn', text: refill.length === 1 ? 'Refill soon: {name}' : '{n} medicines need a refill soon', vars: { name: tc(refill[0].name), n: refill.length }, to: `${base}?tab=medical` });
    const since = now - 24 * 3_600_000;
    const missed = view.doseLogs.filter((l) => l.recipientId === r.id && l.status === 'missed' && slotTime(l.slot) >= since);
    if (missed.length) out.push({ key: 'missed', tone: 'warn', text: missed.length === 1 ? '1 dose marked missed in the last 24 hours' : '{n} doses marked missed in the last 24 hours', vars: { n: missed.length }, to: `${base}?tab=medical` });
    const unverified = view.medications.filter((m) => m.recipientId === r.id && m.active && m.verification !== 'verified').length;
    if (unverified) out.push({ key: 'unverified', tone: 'info', text: unverified === 1 ? '1 medicine not yet verified by a doctor' : '{n} medicines not yet verified by a doctor', vars: { n: unverified }, to: `${base}?tab=medical` });
  }
  const urgent = view.challenges.filter((c) => c.recipientId === r.id && isActive(c) && (c.priority === 'urgent' || c.escalated));
  if (urgent.length) out.push({ key: 'urgent', tone: 'warn', text: urgent.length === 1 ? '1 urgent or escalated problem' : '{n} urgent or escalated problems', vars: { n: urgent.length }, to: `/app/challenges?person=${r.id}&scope=all` });
  const approvals = view.approvals.filter((a) => a.recipientId === r.id && a.status === 'pending' && a.approverIds.includes(view.me));
  if (approvals.length) out.push({ key: 'approval', tone: 'warn', text: approvals.length === 1 ? '1 request waiting for your approval' : '{n} requests waiting for your approval', vars: { n: approvals.length }, to: '/app/approvals' });
  if (canSeeDomain(view, r.id, 'team')) {
    const unverifiedAuth = view.memberships.filter((m) => m.recipientId === r.id && isLive(m, now) && m.authority !== 'none' && !m.authorityVerified).length;
    if (unverifiedAuth) out.push({ key: 'authority', tone: 'info', text: 'Guardian authority waiting to be verified', to: `${base}?tab=team` });
  }
  return out;
}

/** Most recent change we know about for a person (from information visible to the viewer). */
export function lastUpdate(view: View, r: Recipient): number {
  const times = [
    r.updatedAt ?? 0,
    ...view.records.filter((x) => x.recipientId === r.id).map((x) => x.updatedAt),
    ...view.doseLogs.filter((x) => x.recipientId === r.id).map((x) => x.at),
    ...view.challenges.filter((x) => x.recipientId === r.id).map((x) => x.updatedAt),
  ];
  return Math.max(0, ...times);
}

export const displayName = (r: Pick<Recipient, 'name' | 'preferredName'>) => r.preferredName?.trim() || r.name;
