// Care profiles, records, medicines, care teams, consent and approvals.
// Called from apply() in engine.ts, so every rule here runs on the server and in the browser alike.
import type { Action, Approval, CareRecord, Consent, Domain, Membership, Msg, Recipient, RecordEdit, Role, State, User } from './types';
import { DOMAINS, OPTIONAL_DOMAINS, ROLE_DOMAINS, SENSITIVE, authorityHolders, canManageTeam, canRead, canWrite, fingerprint, hasAuthority, isLive, isMinor, isOrgStaff, membershipFor, membershipsOf } from './access';
import { kindOf, slotTime, sourceFor } from './records';
import { fail, nextId, notify, requireText } from './engine';
import { msg } from './messages';
import { applyPlans, planVersion } from './plans-engine';

export interface CareCtx {
  /** Set when an approved request is being carried out. */
  approvedBy?: string;
  /** Secure random code generator (server/browser); tests fall back to a deterministic one. */
  rand?: () => string;
  /** Set only by the server's upload endpoint, after it has stored and checked the file. */
  serverFile?: boolean;
}

export interface CareResult {
  m: Msg;
  createdId?: string;
}

const DAY = 86_400_000;
export const APPROVAL_HOURS = 72;
export const INVITE_DAYS = 7;
const PHOTO_MAX = 150_000;

const recipientOf = (state: State, id: string): Recipient => {
  const r = state.recipients.find((x) => x.id === id);
  if (!r) throw fail('e_who', undefined, 404);
  return r;
};

const domainList = (ds: Domain[]) => ds.join(',');

function need(state: State, me: User, recipientId: string, domain: Domain, mode: 'read' | 'write', now: number) {
  const ok = mode === 'read' ? canRead(state, me.id, recipientId, domain, now) : canWrite(state, me.id, recipientId, domain, now);
  if (!ok) throw fail(mode === 'read' ? 'e_no_access' : 'e_no_write', { domain }, 403);
}

export function audit(state: State, actorId: string, recipientId: string | null, domain: Domain, type: string, m: Msg, now: number, targetId?: string) {
  state.audit.push({ id: nextId(state, 'a'), at: now, actorId, recipientId, domain, type, m, targetId });
}

function bumpAccess(r: Recipient, now: number) {
  r.accessVersion = (r.accessVersion ?? 1) + 1;
  r.updatedAt = now;
}

function touch(state: State, recipientId: string, now: number) {
  const r = state.recipients.find((x) => x.id === recipientId);
  if (r) r.updatedAt = now;
}

function cleanDomains(input: unknown): Domain[] {
  const list = Array.isArray(input) ? input : [];
  const set = new Set<Domain>(list.filter((d): d is Domain => DOMAINS.includes(d as Domain)));
  set.add('overview');
  return DOMAINS.filter((d) => set.has(d));
}

function checkNotesDomain(domains: Domain[], role: Role) {
  if (domains.includes('wellbeing_notes') && role !== 'psychologist') throw fail('e_notes_role', undefined, 400);
}

const userOf = (state: State, id: string) => state.users.find((u) => u.id === id);
const nameOf = (state: State, id: string) => userOf(state, id)?.name ?? 'Someone';

/** People who should hear about changes to a person's care (authority holders and household members on the team). */
function householdOf(state: State, recipientId: string, now: number, domain: Domain = 'overview'): string[] {
  return membershipsOf(state, recipientId, now)
    .filter((m) => (m.authority !== 'none' || userOf(state, m.userId)?.role === 'family') && m.domains.includes(domain))
    .map((m) => m.userId);
}

type ConsentPath = { basis: Consent['basis']; givenBy: string; evidence?: string } | { approvers: string[] };

/**
 * Decides how newly granted sensitive domains are consented to:
 * an approved request, the actor's own verified authority, the verified authority holders (→ approval),
 * or — only when nobody holds authority yet — consent recorded by a coordinator/admin with evidence.
 */
function consentPath(state: State, me: User, r: Recipient, added: Domain[], evidence: string | undefined, now: number, ctx: CareCtx): ConsentPath {
  if (ctx.approvedBy) {
    const a = hasAuthority(state, ctx.approvedBy, r.id, now);
    return { basis: a === 'self' ? 'self' : 'guardian', givenBy: ctx.approvedBy };
  }
  if (!added.some((d) => SENSITIVE.includes(d))) return { basis: 'recorded', givenBy: me.id, evidence: 'No sensitive information shared' };
  const mine = hasAuthority(state, me.id, r.id, now);
  if (mine) return { basis: mine === 'self' ? 'self' : 'guardian', givenBy: me.id };
  const holders = authorityHolders(state, r.id, now).map((m) => m.userId).filter((id) => id !== me.id);
  if (holders.length) return { approvers: holders };
  if (isOrgStaff(me) && me.orgId && me.orgId === r.orgId) {
    const ev = (evidence ?? '').trim();
    if (ev.length < 10) throw fail('e_evidence', undefined, 400);
    return { basis: 'recorded', givenBy: me.id, evidence: ev };
  }
  throw fail('e_manage_team', undefined, 403);
}

function addConsent(state: State, c: Omit<Consent, 'id'>) {
  state.consents.push({ id: nextId(state, 'k'), ...c });
}

/** Creates a pending approval for the exact action. Nothing changes until an approver accepts it. */
export function requestApproval(state: State, me: User, r: Recipient, action: Action, approvers: string[], summary: Msg, reason: string, now: number, reversible = true): Approval {
  const a: Approval = {
    id: nextId(state, 'p'),
    recipientId: r.id,
    requestedBy: me.id,
    approverIds: approvers,
    action,
    fingerprint: fingerprint(action),
    baseVersion: targetVersion(state, action, now),
    summary,
    reason,
    reversible,
    createdAt: now,
    expiresAt: now + APPROVAL_HOURS * 3_600_000,
    status: 'pending',
  };
  state.approvals.push(a);
  notify(state, approvers, null, msg('n_approval_needed', { name: me.name, summary, recipient: r.name }), 'system', now);
  audit(state, me.id, r.id, 'team', 'approval_requested', msg('au_approval_requested', { actor: me.name, summary }), now, a.id);
  return a;
}

/** What an approval depends on. If this changes between request and decision, a new approval is needed. */
export function targetVersion(state: State, action: Action, now: number): string {
  const planV = planVersion(state, action);
  if (planV !== null) return planV;
  if (action.type === 'set_access') {
    const mem = state.memberships.find((m) => m.id === action.membershipId);
    return mem ? `${mem.status}:${isLive(mem, now)}:${mem.domains.join(',')}` : 'missing';
  }
  if (action.type === 'invite_member') {
    // Depends on whether this email is already on the team or invited — not on unrelated team changes.
    const user = state.users.find((u) => u.email.toLowerCase() === action.email.toLowerCase());
    const member = !!user && !!membershipFor(state, user.id, action.recipientId, now);
    const pending = state.invites.filter((i) => i.recipientId === action.recipientId && i.email === action.email && i.status === 'pending').length;
    return `${member}:${pending}`;
  }
  return 'n/a';
}

const fallbackCode = (state: State) => `inv${state.seq.toString(36)}${(state.seq * 7919).toString(36)}`;

/** Runs any registered action (care-team actions here, plus plan/task/appointment actions). */
export function dispatch(state: State, me: User, action: Action, now: number, ctx: CareCtx = {}): CareResult | null {
  return applyCare(state, me, action, now, ctx) ?? applyPlans(state, me, action, now, ctx);
}

export function applyCare(state: State, me: User, action: Action, now: number, ctx: CareCtx = {}): CareResult | null {
  switch (action.type) {
    // ------------------------------------------------------------ profile
    case 'update_preferences': {
      const r = recipientOf(state, action.recipientId);
      need(state, me, r.id, 'overview', 'write', now);
      if (action.photo && (action.photo.length > PHOTO_MAX || !/^data:image\/(png|jpeg|webp);base64,/.test(action.photo))) throw fail('e_photo');
      r.preferredName = (action.preferredName ?? '').trim().slice(0, 60);
      r.communication = (action.communication ?? '').trim().slice(0, 600);
      r.languages = (action.languages ?? []).map((l) => String(l).trim()).filter(Boolean).slice(0, 6);
      r.hidden = (action.hidden ?? []).filter((d) => OPTIONAL_DOMAINS.includes(d));
      if (action.photo !== undefined) r.photo = action.photo ?? undefined;
      r.updatedAt = now;
      audit(state, me.id, r.id, 'overview', 'preferences', msg('au_prefs', { actor: me.name }), now);
      return { m: msg('m_prefs_saved') };
    }

    // ------------------------------------------------------------ records
    case 'add_record': {
      const r = recipientOf(state, action.recipientId);
      const def = kindOf(action.kind);
      if (!def || def.domain !== action.domain) throw fail('e_kind');
      need(state, me, r.id, def.domain, 'write', now);
      if (def.roles && !def.roles.includes(me.role)) throw fail('e_kind_role', { kind: def.kind, roles: def.roles.join(',') }, 403);
      const title = requireText(action.title, 'lbl_title', 2).slice(0, 160);
      const body = (action.body ?? '').trim().slice(0, 4000);
      let value: number | null = null;
      let unit = '';
      if (def.measure) {
        value = Number(action.value);
        const { min = -1e9, max = 1e9 } = def.measure;
        if (action.value === null || action.value === undefined || !Number.isFinite(value) || value < min || value > max) throw fail('e_value', { min: def.measure.min ?? 0, max: def.measure.max ?? 9999 });
        unit = def.measure.units?.includes(action.unit ?? '') ? action.unit! : def.measure.unit;
      }
      const observedAt = Number.isFinite(action.observedAt) ? Math.min(Number(action.observedAt), now + DAY) : now;
      const autoVerified = def.verifiers.includes(me.role);
      const rec: CareRecord = {
        id: nextId(state, 'd'),
        recipientId: r.id,
        domain: def.domain,
        kind: def.kind,
        title,
        body,
        value,
        unit,
        observedAt,
        source: sourceFor(me.role),
        authorId: me.id,
        createdAt: now,
        updatedAt: now,
        version: 1,
        verification: autoVerified ? 'verified' : 'unverified',
        verifiedBy: autoVerified ? me.id : undefined,
        verifiedAt: autoVerified ? now : undefined,
        history: [],
      };
      state.records.push(rec);
      touch(state, r.id, now);
      audit(state, me.id, r.id, def.domain, 'record_added', msg('au_record_added', { actor: me.name, kind: def.kind, title }), now, rec.id);
      return { m: msg('m_record_added', { kind: def.kind }), createdId: rec.id };
    }

    case 'edit_record': {
      const rec = state.records.find((x) => x.id === action.recordId && !x.archived);
      if (!rec) throw fail('e_record', undefined, 404);
      need(state, me, rec.recipientId, rec.domain, 'write', now);
      if (rec.authorId !== me.id) throw fail('e_record_author', undefined, 403);
      if (action.baseVersion !== rec.version) throw fail('e_stale', undefined, 409);
      const def = kindOf(rec.kind)!;
      const next: Record<string, string | number | null> = { title: requireText(action.title, 'lbl_title', 2).slice(0, 160), body: (action.body ?? '').trim().slice(0, 4000) };
      if (def.measure) {
        const v = Number(action.value);
        if (!Number.isFinite(v) || v < (def.measure.min ?? -1e9) || v > (def.measure.max ?? 1e9)) throw fail('e_value', { min: def.measure.min ?? 0, max: def.measure.max ?? 9999 });
        next.value = v;
        next.unit = def.measure.units?.includes(action.unit ?? '') ? action.unit! : rec.unit ?? def.measure.unit;
      }
      if (Number.isFinite(action.observedAt)) next.observedAt = Math.min(Number(action.observedAt), now + DAY);
      const fields = Object.keys(next).filter((k) => (rec as unknown as Record<string, unknown>)[k] !== next[k]);
      if (!fields.length) return { m: msg('m_no_change') };
      const edit: RecordEdit = { at: now, by: me.id, fields, before: Object.fromEntries(fields.map((k) => [k, ((rec as unknown as Record<string, unknown>)[k] ?? null) as string | number | null])) };
      Object.assign(rec, next);
      rec.history.push(edit);
      rec.version += 1;
      rec.updatedAt = now;
      // Content changed: a verification by someone else no longer applies.
      if (rec.verification === 'verified' && rec.verifiedBy !== me.id) {
        rec.verification = 'unverified';
        rec.verifiedBy = undefined;
        rec.verifiedAt = undefined;
      }
      touch(state, rec.recipientId, now);
      audit(state, me.id, rec.recipientId, rec.domain, 'record_edited', msg('au_record_edited', { actor: me.name, kind: rec.kind, title: rec.title }), now, rec.id);
      return { m: msg('m_saved') };
    }

    case 'verify_record': {
      const rec = state.records.find((x) => x.id === action.recordId && !x.archived);
      if (!rec) throw fail('e_record', undefined, 404);
      need(state, me, rec.recipientId, rec.domain, 'read', now);
      const def = kindOf(rec.kind)!;
      if (!def.verifiers.includes(me.role) || !membershipFor(state, me.id, rec.recipientId, now)) throw fail('e_verify_role', { roles: def.verifiers.join(',') || 'doctor' }, 403);
      rec.verification = 'verified';
      rec.verifiedBy = me.id;
      rec.verifiedAt = now;
      rec.updatedAt = now;
      audit(state, me.id, rec.recipientId, rec.domain, 'record_verified', msg('au_record_verified', { actor: me.name, kind: rec.kind, title: rec.title }), now, rec.id);
      return { m: msg('m_verified') };
    }

    case 'archive_record': {
      const rec = state.records.find((x) => x.id === action.recordId && !x.archived);
      if (!rec) throw fail('e_record', undefined, 404);
      need(state, me, rec.recipientId, rec.domain, 'write', now);
      // The person or their guardian may archive household entries; professional entries can only be withdrawn by their author.
      if (rec.authorId !== me.id && (rec.source === 'professional' || !hasAuthority(state, me.id, rec.recipientId, now))) throw fail('e_record_author', undefined, 403);
      const reason = requireText(action.reason, 'lbl_reason', 3).slice(0, 300);
      rec.archived = true;
      rec.history.push({ at: now, by: me.id, fields: ['archived'], before: { archived: 0, reason } });
      rec.version += 1;
      rec.updatedAt = now;
      audit(state, me.id, rec.recipientId, rec.domain, 'record_archived', msg('au_record_archived', { actor: me.name, kind: rec.kind, title: rec.title, reason }), now, rec.id);
      return { m: msg('m_archived') };
    }

    // ------------------------------------------------------------ medicines
    case 'add_medication':
    case 'edit_medication': {
      const existing = action.type === 'edit_medication' ? state.medications.find((x) => x.id === action.medicationId) : undefined;
      if (action.type === 'edit_medication' && !existing) throw fail('e_med', undefined, 404);
      const recipientId = existing ? existing.recipientId : (action as { recipientId: string }).recipientId;
      recipientOf(state, recipientId);
      need(state, me, recipientId, 'medical', 'write', now);
      if (existing && action.type === 'edit_medication' && action.baseVersion !== existing.version) throw fail('e_stale', undefined, 409);
      const i = action.med;
      const times = [...new Set((i.times ?? []).map((t) => String(t).trim()))].filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)).sort();
      if (!times.length) throw fail('e_times');
      const num = (v: unknown, min: number) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) && Number(v) >= min ? Number(v) : NaN);
      const onHand = num(i.onHand, 0);
      const perDose = num(i.perDose, 0.01);
      if (Number.isNaN(onHand) || Number.isNaN(perDose)) throw fail('e_supply');
      const date = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
      const fields = {
        name: requireText(i.name, 'lbl_med_name', 2).slice(0, 80),
        strength: (i.strength ?? '').trim().slice(0, 40),
        dose: requireText(i.dose, 'lbl_dose', 1).slice(0, 60),
        route: (i.route ?? '').trim().slice(0, 40) || 'By mouth',
        times,
        startDate: date(i.startDate),
        endDate: date(i.endDate),
        prescriber: (i.prescriber ?? '').trim().slice(0, 80),
        instructions: (i.instructions ?? '').trim().slice(0, 1000),
        reminders: !!i.reminders,
        onHand,
        perDose,
        active: i.active !== false,
      };
      if (fields.startDate && fields.endDate && fields.endDate < fields.startDate) throw fail('e_dates');
      const isDoctor = me.role === 'doctor';
      if (!existing) {
        const med = {
          id: nextId(state, 'm'),
          recipientId,
          ...fields,
          supplyUpdatedAt: now,
          source: sourceFor(me.role),
          authorId: me.id,
          createdAt: now,
          updatedAt: now,
          version: 1,
          verification: isDoctor ? ('verified' as const) : ('unverified' as const),
          verifiedBy: isDoctor ? me.id : undefined,
          history: [],
        };
        state.medications.push(med);
        touch(state, recipientId, now);
        audit(state, me.id, recipientId, 'medical', 'med_added', msg('au_med_added', { actor: me.name, med: med.name }), now, med.id);
        return { m: msg('m_med_added', { name: med.name }), createdId: med.id };
      }
      const clinical = ['name', 'strength', 'dose', 'route', 'times'] as const;
      const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter((k) => JSON.stringify(existing[k] ?? null) !== JSON.stringify(fields[k] ?? null));
      if (!changed.length) return { m: msg('m_no_change') };
      existing.history.push({ at: now, by: me.id, fields: changed, before: Object.fromEntries(changed.map((k) => [k, JSON.stringify(existing[k] ?? null)])) });
      Object.assign(existing, fields);
      if (changed.includes('onHand')) existing.supplyUpdatedAt = now;
      existing.version += 1;
      existing.updatedAt = now;
      let m = msg('m_saved');
      if (changed.some((k) => (clinical as readonly string[]).includes(k)) && !isDoctor) {
        existing.verification = 'unverified';
        existing.verifiedBy = undefined;
        m = msg('m_med_needs_check');
      }
      touch(state, recipientId, now);
      audit(state, me.id, recipientId, 'medical', 'med_edited', msg('au_med_edited', { actor: me.name, med: existing.name, fields: changed.join(', ') }), now, existing.id);
      return { m };
    }

    case 'verify_medication': {
      const med = state.medications.find((x) => x.id === action.medicationId);
      if (!med) throw fail('e_med', undefined, 404);
      if (me.role !== 'doctor' || !canRead(state, me.id, med.recipientId, 'medical', now) || !membershipFor(state, me.id, med.recipientId, now)) throw fail('e_verify_role', { roles: 'doctor' }, 403);
      med.verification = 'verified';
      med.verifiedBy = me.id;
      med.updatedAt = now;
      audit(state, me.id, med.recipientId, 'medical', 'med_verified', msg('au_med_verified', { actor: me.name, med: med.name }), now, med.id);
      return { m: msg('m_verified') };
    }

    case 'log_dose': {
      const med = state.medications.find((x) => x.id === action.medicationId);
      if (!med) throw fail('e_med', undefined, 404);
      need(state, me, med.recipientId, 'medical', 'write', now);
      if (!['taken', 'missed', 'skipped', 'unknown'].includes(action.status)) throw fail('e_dose_status');
      const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(String(action.slot));
      if (!m || !med.times.includes(m[2])) throw fail('e_slot');
      const at = slotTime(action.slot);
      if (at > now + 2 * 3_600_000 || at < now - 7 * DAY) throw fail('e_slot_range');
      if (action.status === 'taken' && at > now + 2 * 3_600_000) throw fail('e_slot_range');
      const note = (action.note ?? '').trim().slice(0, 500);
      const log = { id: nextId(state, 'l'), medicationId: med.id, recipientId: med.recipientId, slot: action.slot, status: action.status, note, by: me.id, at: now };
      state.doseLogs.push(log);
      touch(state, med.recipientId, now);
      audit(state, me.id, med.recipientId, 'medical', 'dose_logged', msg('au_dose', { actor: me.name, med: med.name, slot: action.slot, status: action.status }), now, log.id);
      if (action.status === 'missed') {
        const r = recipientOf(state, med.recipientId);
        // Neutral notice only. SANAD never suggests taking a late or double dose — that is for the prescriber or pharmacist.
        notify(state, householdOf(state, r.id, now, 'medical').filter((id) => id !== me.id), null, msg('n_dose_missed', { recipient: r.name, med: med.name, slot: action.slot }), 'update', now);
      }
      return { m: msg('m_dose_logged', { status: action.status }), createdId: log.id };
    }

    case 'update_supply': {
      const med = state.medications.find((x) => x.id === action.medicationId);
      if (!med) throw fail('e_med', undefined, 404);
      need(state, me, med.recipientId, 'medical', 'write', now);
      const n = Number(action.onHand);
      if (!Number.isFinite(n) || n < 0 || n > 100000) throw fail('e_supply');
      med.history.push({ at: now, by: me.id, fields: ['onHand'], before: { onHand: med.onHand } });
      med.onHand = n;
      med.supplyUpdatedAt = now;
      med.updatedAt = now;
      med.version += 1;
      audit(state, me.id, med.recipientId, 'medical', 'supply', msg('au_supply', { actor: me.name, med: med.name, n }), now, med.id);
      return { m: msg('m_supply_saved') };
    }

    // ------------------------------------------------------------ care team
    case 'invite_member': {
      const r = recipientOf(state, action.recipientId);
      if (!ctx.approvedBy && !canManageTeam(state, me.id, r.id, now)) throw fail('e_manage_team', undefined, 403);
      const email = requireText(action.email, 'lbl_email', 5).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail('e_email');
      if (!action.role || action.role === 'admin' || action.role === 'coordinator') throw fail('e_invite_role');
      const domains = cleanDomains(action.domains);
      checkNotesDomain(domains, action.role);
      if (action.role === 'self' && state.memberships.some((m) => m.recipientId === r.id && m.authority === 'self' && m.status === 'active')) throw fail('e_self_exists');
      const existingUser = state.users.find((u) => u.email.toLowerCase() === email);
      if (existingUser && membershipFor(state, existingUser.id, r.id, now)) throw fail('e_already_member', { name: existingUser.name }, 409);
      if (state.invites.some((x) => x.recipientId === r.id && x.email === email && x.status === 'pending')) throw fail('e_invite_exists', undefined, 409);
      const days = action.accessDays == null ? null : Math.round(Number(action.accessDays));
      if (days !== null && (!Number.isFinite(days) || days < 1 || days > 730)) throw fail('e_days');
      const relationship = (action.relationship ?? '').trim().slice(0, 60);
      const clean: Action = { type: 'invite_member', recipientId: r.id, email, role: action.role, relationship, domains, accessDays: days };
      const path = consentPath(state, me, r, domains, action.evidence, now, ctx);
      if ('approvers' in path) {
        const a = requestApproval(state, me, r, clean, path.approvers, msg('s_invite', { email, role: action.role, domains: domainList(domains) }), relationship, now);
        return { m: msg('m_access_requested', { names: path.approvers.map((id) => nameOf(state, id)).join(', ') }), createdId: a.id };
      }
      const invite = {
        id: nextId(state, 'i'),
        code: (ctx.rand ?? (() => fallbackCode(state)))(),
        recipientId: r.id,
        email,
        role: action.role,
        relationship,
        domains,
        invitedBy: me.id,
        createdAt: now,
        expiresAt: now + INVITE_DAYS * DAY,
        accessDays: days,
        status: 'pending' as const,
      };
      state.invites.push(invite);
      addConsent(state, { recipientId: r.id, subjectId: invite.id, change: 'grant', domains, basis: path.basis, givenBy: path.givenBy, evidence: path.evidence, at: now });
      bumpAccess(r, now);
      audit(state, me.id, r.id, 'team', 'invited', msg('au_invite', { actor: me.name, email, role: action.role, domains: domainList(domains) }), now, invite.id);
      if (existingUser) notify(state, [existingUser.id], null, msg('n_invited', { name: me.name, recipient: r.name, role: action.role }), 'system', now);
      return { m: msg('m_invited', { email }), createdId: invite.id };
    }

    case 'cancel_invite': {
      const inv = state.invites.find((x) => x.id === action.inviteId);
      if (!inv || inv.status !== 'pending') throw fail('e_invite_code', undefined, 404);
      if (!canManageTeam(state, me.id, inv.recipientId, now)) throw fail('e_manage_team', undefined, 403);
      inv.status = 'cancelled';
      bumpAccess(recipientOf(state, inv.recipientId), now);
      audit(state, me.id, inv.recipientId, 'team', 'invite_cancelled', msg('au_invite_cancelled', { actor: me.name, email: inv.email }), now, inv.id);
      return { m: msg('m_invite_cancelled') };
    }

    case 'accept_invite': {
      const inv = state.invites.find((x) => x.code === String(action.code ?? '').trim());
      if (!inv || inv.status === 'cancelled') throw fail('e_invite_code', undefined, 404);
      if (inv.status === 'accepted') throw fail('e_invite_used', undefined, 409);
      if (inv.status === 'expired' || inv.expiresAt < now) {
        inv.status = 'expired';
        throw fail('e_invite_expired', undefined, 410);
      }
      if (inv.email !== me.email.toLowerCase()) throw fail('e_invite_email', undefined, 403);
      if (inv.role !== me.role) throw fail('e_invite_role_mismatch', { role: inv.role }, 403);
      const r = recipientOf(state, inv.recipientId);
      if (membershipFor(state, me.id, r.id, now)) throw fail('e_already_member', { name: me.name }, 409);
      const mem: Membership = {
        id: nextId(state, 'g'),
        recipientId: r.id,
        userId: me.id,
        relationship: inv.relationship,
        authority: inv.role === 'self' && !isMinor(r) ? 'self' : 'none',
        authorityVerified: false,
        domains: inv.domains,
        status: 'active',
        grantedBy: inv.invitedBy,
        createdAt: now,
        expiresAt: inv.accessDays ? now + inv.accessDays * DAY : null,
      };
      state.memberships.push(mem);
      inv.status = 'accepted';
      inv.acceptedBy = me.id;
      for (const c of state.consents) if (c.subjectId === inv.id) c.subjectId = me.id;
      bumpAccess(r, now);
      notify(state, [inv.invitedBy, ...householdOf(state, r.id, now)].filter((id) => id !== me.id), null, msg('n_joined_team', { name: me.name, recipient: r.name }), 'system', now);
      audit(state, me.id, r.id, 'team', 'invite_accepted', msg('au_invite_accepted', { actor: me.name, domains: domainList(mem.domains) }), now, mem.id);
      return { m: msg('m_invite_accepted', { name: r.name }), createdId: mem.id };
    }

    case 'set_access': {
      const mem = state.memberships.find((x) => x.id === action.membershipId);
      if (!mem || !isLive(mem, now)) throw fail('e_membership', undefined, 404);
      const r = recipientOf(state, mem.recipientId);
      if (!ctx.approvedBy && !canManageTeam(state, me.id, r.id, now)) throw fail('e_manage_team', undefined, 403);
      const target = userOf(state, mem.userId)!;
      const domains = cleanDomains(action.domains);
      if (mem.authority === 'self' && me.id !== mem.userId && !ctx.approvedBy) throw fail('e_self_authority', undefined, 403);
      checkNotesDomain(domains.filter((d) => !mem.domains.includes(d)), target.role);
      const added = domains.filter((d) => !mem.domains.includes(d));
      const removed = mem.domains.filter((d) => !domains.includes(d));
      if (!added.length && !removed.length) return { m: msg('m_no_change') };
      const clean: Action = { type: 'set_access', membershipId: mem.id, domains };
      const path = consentPath(state, me, r, added, action.evidence, now, ctx);
      if ('approvers' in path) {
        const a = requestApproval(state, me, r, clean, path.approvers, msg('s_set_access', { name: target.name, domains: domainList(added) }), '', now);
        return { m: msg('m_access_requested', { names: path.approvers.map((id) => nameOf(state, id)).join(', ') }), createdId: a.id };
      }
      mem.domains = domains;
      if (added.length) addConsent(state, { recipientId: r.id, subjectId: mem.userId, change: 'grant', domains: added, basis: path.basis, givenBy: path.givenBy, evidence: path.evidence, at: now });
      if (removed.length) addConsent(state, { recipientId: r.id, subjectId: mem.userId, change: 'revoke', domains: removed, basis: hasAuthority(state, me.id, r.id, now) ?? 'recorded', givenBy: ctx.approvedBy ?? me.id, at: now });
      bumpAccess(r, now);
      notify(state, [mem.userId], null, msg('n_access_changed', { recipient: r.name, domains: domainList(domains) }), 'system', now);
      audit(state, ctx.approvedBy ?? me.id, r.id, 'team', 'access_changed', msg('au_access', { actor: nameOf(state, ctx.approvedBy ?? me.id), name: target.name, domains: domainList(domains) }), now, mem.id);
      return { m: msg('m_access_saved', { name: target.name }) };
    }

    case 'revoke_member': {
      const mem = state.memberships.find((x) => x.id === action.membershipId);
      if (!mem || mem.status !== 'active') throw fail('e_membership', undefined, 404);
      const r = recipientOf(state, mem.recipientId);
      const leaving = mem.userId === me.id;
      if (!leaving && !canManageTeam(state, me.id, r.id, now)) throw fail('e_manage_team', undefined, 403);
      if (!leaving && mem.authority === 'self') throw fail('e_self_authority', undefined, 403);
      const reason = (action.reason ?? '').trim().slice(0, 300);
      mem.status = 'revoked';
      mem.revokedAt = now;
      mem.revokedBy = me.id;
      addConsent(state, { recipientId: r.id, subjectId: mem.userId, change: 'revoke', domains: mem.domains, basis: hasAuthority(state, me.id, r.id, now) ?? 'recorded', givenBy: me.id, evidence: reason || undefined, at: now });
      bumpAccess(r, now);
      if (!leaving) notify(state, [mem.userId], null, msg('n_access_revoked', { recipient: r.name }), 'system', now);
      audit(state, me.id, r.id, 'team', 'revoked', msg('au_revoke', { actor: me.name, name: nameOf(state, mem.userId), reason: reason || '—' }), now, mem.id);
      return { m: msg('m_revoked', { name: nameOf(state, mem.userId) }) };
    }

    case 'verify_authority': {
      const mem = state.memberships.find((x) => x.id === action.membershipId);
      if (!mem || !isLive(mem, now)) throw fail('e_membership', undefined, 404);
      const r = recipientOf(state, mem.recipientId);
      if (!isOrgStaff(me) || !me.orgId || me.orgId !== r.orgId) throw fail('e_authority_verify', undefined, 403);
      if (mem.authority === 'none') throw fail('e_no_authority_claim');
      const evidence = requireText(action.evidence, 'lbl_evidence', 10).slice(0, 300);
      mem.authorityVerified = true;
      mem.authorityEvidence = evidence;
      bumpAccess(r, now);
      notify(state, [mem.userId], null, msg('n_authority_verified', { recipient: r.name }), 'system', now);
      audit(state, me.id, r.id, 'team', 'authority_verified', msg('au_authority', { actor: me.name, name: nameOf(state, mem.userId), authority: mem.authority }), now, mem.id);
      return { m: msg('m_authority_verified', { name: nameOf(state, mem.userId) }) };
    }

    // ------------------------------------------------------------ approvals
    case 'decide_approval': {
      const a = state.approvals.find((x) => x.id === action.approvalId);
      if (!a) throw fail('e_approval', undefined, 404);
      if (!a.approverIds.includes(me.id)) throw fail('e_approval_not_yours', undefined, 403);
      if (a.status !== 'pending') throw fail('e_approval_closed', { status: a.status }, 409);
      if (a.expiresAt < now) {
        a.status = 'expired';
        audit(state, 'system', a.recipientId, 'team', 'approval_expired', msg('au_approval_expired', { summary: a.summary }), now, a.id);
        return { m: msg('e_approval_expired') };
      }
      if (action.fingerprint !== a.fingerprint || fingerprint(a.action) !== a.fingerprint) throw fail('e_approval_changed', undefined, 409);
      // The approver must still hold verified authority at the moment of deciding.
      if (!hasAuthority(state, me.id, a.recipientId, now)) throw fail('e_approval_not_yours', undefined, 403);
      a.decidedBy = me.id;
      a.decidedAt = now;
      if (action.decision === 'reject') {
        a.status = 'rejected';
        notify(state, [a.requestedBy], null, msg('n_approval_rejected', { name: me.name, summary: a.summary }), 'system', now);
        audit(state, me.id, a.recipientId, 'team', 'approval_rejected', msg('au_approval_rejected', { actor: me.name, summary: a.summary }), now, a.id);
        return { m: msg('m_rejected') };
      }
      const r = recipientOf(state, a.recipientId);
      const requester = userOf(state, a.requestedBy);
      if (targetVersion(state, a.action, now) !== a.baseVersion) {
        a.status = 'failed';
        a.error = msg('e_approval_stale');
        audit(state, me.id, r.id, 'team', 'approval_failed', msg('au_approval_failed', { summary: a.summary }), now, a.id);
        notify(state, [a.requestedBy], null, msg('n_approval_failed', { summary: a.summary }), 'system', now);
        return { m: msg('e_approval_stale') };
      }
      try {
        if (!requester) throw fail('e_person', undefined, 404);
        // Re-check that the requester may still ask for this (authorisation at execution time).
        if ((a.action.type === 'invite_member' || a.action.type === 'set_access') && !canManageTeam(state, requester.id, r.id, now)) throw fail('e_manage_team', undefined, 403);
        const res = dispatch(state, requester, a.action, now, { ...ctx, approvedBy: me.id });
        if (!res) throw fail('e_unknown', { type: a.action.type });
        a.status = 'executed';
        notify(state, [a.requestedBy], null, msg('n_approval_done', { name: me.name, summary: a.summary }), 'system', now);
        audit(state, me.id, r.id, 'team', 'approval_executed', msg('au_approval_executed', { actor: me.name, summary: a.summary }), now, a.id);
        return { m: msg('m_approved_done'), createdId: res.createdId };
      } catch (e) {
        a.status = 'failed';
        a.error = (e as { m?: Msg }).m ?? msg('e_unknown', { type: a.action.type });
        audit(state, me.id, r.id, 'team', 'approval_failed', msg('au_approval_failed', { summary: a.summary }), now, a.id);
        return { m: a.error };
      }
    }

    case 'cancel_approval': {
      const a = state.approvals.find((x) => x.id === action.approvalId);
      if (!a) throw fail('e_approval', undefined, 404);
      if (a.requestedBy !== me.id) throw fail('e_approval_not_yours', undefined, 403);
      if (a.status !== 'pending') throw fail('e_approval_closed', { status: a.status }, 409);
      a.status = 'cancelled';
      audit(state, me.id, a.recipientId, 'team', 'approval_cancelled', msg('au_approval_cancelled', { actor: me.name, summary: a.summary }), now, a.id);
      return { m: msg('m_approval_cancelled') };
    }
  }
  return null;
}

/** Links a staff member to a person (coordinator "Edit details"/"Add member"). Only non-sensitive access is granted directly. */
export function linkMember(state: State, actor: User, target: User, recipientId: string, now: number): Msg | null {
  const r = recipientOf(state, recipientId);
  if (membershipFor(state, target.id, r.id, now)) return null;
  const direct: Domain[] = ['overview', ...(target.role === 'family' ? (['team'] as Domain[]) : [])];
  const mem: Membership = {
    id: nextId(state, 'g'),
    recipientId: r.id,
    userId: target.id,
    relationship: target.role === 'family' ? 'Family' : target.title,
    authority: 'none',
    authorityVerified: false,
    domains: direct,
    status: 'active',
    grantedBy: actor.id,
    createdAt: now,
  };
  state.memberships.push(mem);
  bumpAccess(r, now);
  audit(state, actor.id, r.id, 'team', 'linked', msg('au_linked', { actor: actor.name, name: target.name, domains: domainList(direct) }), now, mem.id);
  const wanted = ROLE_DOMAINS[target.role].filter((d) => !direct.includes(d) && d !== 'wellbeing_notes');
  if (!wanted.length) return null;
  const holders = authorityHolders(state, r.id, now).map((m) => m.userId).filter((id) => id !== actor.id);
  if (holders.length) {
    requestApproval(state, actor, r, { type: 'set_access', membershipId: mem.id, domains: [...direct, ...wanted] }, holders, msg('s_set_access', { name: target.name, domains: domainList(wanted) }), '', now);
    return msg('m_linked_pending', { name: target.name, names: holders.map((id) => nameOf(state, id)).join(', ') });
  }
  return msg('m_linked_overview', { name: target.name });
}

export function unlinkMember(state: State, actor: User, userId: string, recipientId: string, now: number) {
  const mem = membershipFor(state, userId, recipientId, now);
  if (!mem || mem.authority === 'self') return;
  mem.status = 'revoked';
  mem.revokedAt = now;
  mem.revokedBy = actor.id;
  const r = recipientOf(state, recipientId);
  addConsent(state, { recipientId, subjectId: userId, change: 'revoke', domains: mem.domains, basis: 'recorded', givenBy: actor.id, at: now });
  bumpAccess(r, now);
  audit(state, actor.id, recipientId, 'team', 'revoked', msg('au_revoke', { actor: actor.name, name: nameOf(state, userId), reason: '—' }), now, mem.id);
}

/** Keeps user.recipients in step with live memberships (used by routing and dashboards). */
export function syncLinks(state: State, now: number) {
  const live = state.memberships.filter((m) => isLive(m, now)).sort((a, b) => a.createdAt - b.createdAt);
  for (const u of state.users) {
    const ids = [...new Set(live.filter((m) => m.userId === u.id).map((m) => m.recipientId))];
    if (ids.join() !== u.recipients.join()) u.recipients = ids;
  }
}

/** Time-based housekeeping: approvals and invitations expire. Returns true when something changed. */
export function expireCare(state: State, now: number): boolean {
  let changed = false;
  for (const a of state.approvals) {
    if (a.status === 'pending' && a.expiresAt < now) {
      a.status = 'expired';
      audit(state, 'system', a.recipientId, 'team', 'approval_expired', msg('au_approval_expired', { summary: a.summary }), now, a.id);
      notify(state, [a.requestedBy], null, msg('n_approval_expired', { summary: a.summary }), 'system', now);
      changed = true;
    }
  }
  for (const i of state.invites) {
    if (i.status === 'pending' && i.expiresAt < now) {
      i.status = 'expired';
      changed = true;
    }
  }
  const before = state.users.map((u) => u.recipients.join()).join('|');
  syncLinks(state, now);
  if (state.users.map((u) => u.recipients.join()).join('|') !== before) changed = true;
  return changed;
}
