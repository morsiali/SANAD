// Who may see and change what. Enforced by the engine (server and browser) — the interface only mirrors it.
//
// Rules in short:
//  - Access to a person's information comes from an active care-team membership, granted per domain.
//  - Coordinators and organisation admins see the overview and care team of people in their own organisation,
//    and nothing clinical unless they are given a membership like anyone else.
//  - Sensitive domains are only granted with consent: by the person (authority "self"), their verified guardian,
//    or — when neither has an account — consent recorded by a coordinator or admin with written evidence.
//  - Family relationship alone never gives authority; it must be verified.
import type { Authority, Domain, Membership, Recipient, Role, State, User } from './types';

export const DOMAINS: Domain[] = ['overview', 'medical', 'wellbeing', 'wellbeing_notes', 'academic', 'social', 'activity', 'rehab', 'team'];
/** Domains that can be hidden for a person when they do not apply (overview and team always stay). */
export const OPTIONAL_DOMAINS: Domain[] = ['medical', 'wellbeing', 'academic', 'social', 'activity', 'rehab'];
/** Everything except the overview and the care-team list needs consent. */
export const SENSITIVE: Domain[] = ['medical', 'wellbeing', 'wellbeing_notes', 'academic', 'social', 'activity', 'rehab'];

export const DOMAIN_LABEL: Record<Domain, string> = {
  overview: 'Overview',
  medical: 'Medical',
  wellbeing: 'Psychological well-being',
  wellbeing_notes: 'Private therapy notes',
  academic: 'Academic development',
  social: 'Social development',
  activity: 'Sports & activity',
  rehab: 'Physiotherapy & rehab',
  team: 'Care team & permissions',
};

export const DOMAIN_HINT: Record<Domain, string> = {
  overview: 'Name, preferences, care category and general alerts',
  medical: 'Conditions, allergies, measurements, results and medicines',
  wellbeing: 'Mood check-ins, sleep, behaviour and support preferences',
  wellbeing_notes: 'Restricted professional progress notes',
  academic: 'School, learning goals, accommodations and progress',
  social: 'Social goals, activities and achievements',
  activity: 'Preferred activities, goals and participation',
  rehab: 'Physiotherapy plans, exercises, completion and milestones',
  team: 'Who is on the care team and what they can see',
};

/** What each role normally needs. Coordinators/admins can never hand out more than this without consent. */
export const ROLE_DOMAINS: Record<Role, Domain[]> = {
  self: ['overview', 'medical', 'wellbeing', 'academic', 'social', 'activity', 'rehab', 'team'],
  family: ['overview', 'medical', 'wellbeing', 'social', 'activity', 'rehab', 'team'],
  caregiver: ['overview', 'medical', 'wellbeing', 'activity', 'rehab'],
  doctor: ['overview', 'medical', 'wellbeing', 'activity', 'rehab'],
  psychologist: ['overview', 'wellbeing', 'wellbeing_notes', 'social'],
  physio: ['overview', 'activity', 'rehab'],
  educator: ['overview', 'academic', 'social'],
  coordinator: ['overview', 'team'],
  admin: ['overview', 'team'],
  transport: ['overview'],
  pharmacy: ['overview', 'medical'],
  social: ['overview', 'social'],
};

/** A guardian or the person themselves can see everything except private therapy notes, which stay with the professional unless shared. */
export const AUTHORITY_DOMAINS: Domain[] = ['overview', 'medical', 'wellbeing', 'academic', 'social', 'activity', 'rehab', 'team'];

/** Who may write each domain (on top of having the domain). */
export const WRITE_ROLES: Record<Domain, Role[] | 'members'> = {
  overview: ['self', 'family', 'coordinator', 'admin'],
  medical: 'members',
  wellbeing: 'members',
  wellbeing_notes: ['psychologist'],
  academic: 'members',
  social: 'members',
  activity: 'members',
  rehab: 'members',
  team: ['self', 'family', 'coordinator', 'admin'],
};

export const isOrgStaff = (u: Pick<User, 'role'>) => u.role === 'coordinator' || u.role === 'admin';

export function membershipsOf(state: Pick<State, 'memberships'>, recipientId: string, now = Date.now()): Membership[] {
  return state.memberships.filter((m) => m.recipientId === recipientId && isLive(m, now));
}

export const isLive = (m: Membership, now = Date.now()) => m.status === 'active' && (!m.expiresAt || m.expiresAt > now);

export function membershipFor(state: Pick<State, 'memberships'>, userId: string, recipientId: string, now = Date.now()): Membership | undefined {
  return state.memberships.find((m) => m.userId === userId && m.recipientId === recipientId && isLive(m, now));
}

/** Domains a user can see for a person. Empty = no access at all. */
export function domainsFor(state: Pick<State, 'memberships' | 'users' | 'recipients'>, userId: string, recipientId: string, now = Date.now()): Domain[] {
  const user = state.users.find((u) => u.id === userId);
  const r = state.recipients.find((x) => x.id === recipientId);
  if (!user || !r) return [];
  const out = new Set<Domain>();
  const m = membershipFor(state, userId, recipientId, now);
  if (m) {
    for (const d of m.domains) out.add(d);
    out.add('overview');
  }
  if (isOrgStaff(user) && user.orgId && user.orgId === r.orgId) {
    out.add('overview');
    out.add('team');
  }
  return DOMAINS.filter((d) => out.has(d));
}

export const canRead = (state: Pick<State, 'memberships' | 'users' | 'recipients'>, userId: string, recipientId: string, domain: Domain, now = Date.now()) =>
  domainsFor(state, userId, recipientId, now).includes(domain);

export function canWrite(state: Pick<State, 'memberships' | 'users' | 'recipients'>, userId: string, recipientId: string, domain: Domain, now = Date.now()): boolean {
  const user = state.users.find((u) => u.id === userId);
  if (!user || !canRead(state, userId, recipientId, domain, now)) return false;
  const who = WRITE_ROLES[domain];
  return who === 'members' ? !isOrgStaff(user) || !!membershipFor(state, userId, recipientId, now) : who.includes(user.role);
}

/** Verified authority holders (the person themselves or their verified guardian). */
export function authorityHolders(state: Pick<State, 'memberships'>, recipientId: string, now = Date.now()): Membership[] {
  return membershipsOf(state, recipientId, now).filter((m) => m.authority !== 'none' && m.authorityVerified);
}

export function hasAuthority(state: Pick<State, 'memberships'>, userId: string, recipientId: string, now = Date.now()): 'self' | 'guardian' | null {
  const m = authorityHolders(state, recipientId, now).find((x) => x.userId === userId);
  return m && m.authority !== 'none' ? m.authority : null;
}

/** Can this user manage the care team (invite, change access, revoke) for this person? */
export function canManageTeam(state: Pick<State, 'memberships' | 'users' | 'recipients'>, userId: string, recipientId: string, now = Date.now()): boolean {
  if (hasAuthority(state, userId, recipientId, now)) return true;
  const user = state.users.find((u) => u.id === userId);
  const r = state.recipients.find((x) => x.id === recipientId);
  return !!user && !!r && isOrgStaff(user) && !!user.orgId && user.orgId === r.orgId;
}

export const isMinor = (r: Pick<Recipient, 'age'>) => r.age < 18;

/** Stable JSON so the same action always has the same fingerprint (key order does not matter). */
export function fingerprint(value: unknown): string {
  const norm = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])])) : v;
  const text = JSON.stringify(norm(value));
  // FNV-1a, enough to bind an approval to its exact parameters (the full action is stored alongside).
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16).padStart(8, '0')}-${text.length}`;
}
