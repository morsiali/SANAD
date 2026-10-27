import type { CareNeed, Living, SupportLevel } from './care';
// SANAD domain model — shared by the server, the browser and the tests.

export type Role =
  | 'self'
  | 'family'
  | 'caregiver'
  | 'doctor'
  | 'psychologist'
  | 'physio'
  | 'educator'
  | 'coordinator'
  | 'admin'
  | 'transport'
  | 'pharmacy'
  | 'social';

export const ROLES: Role[] = ['self', 'family', 'caregiver', 'doctor', 'psychologist', 'physio', 'educator', 'coordinator', 'admin', 'transport', 'pharmacy', 'social'];

export const ROLE_LABEL: Record<Role, string> = {
  self: 'Person receiving care',
  family: 'Family',
  caregiver: 'Caregiver',
  doctor: 'Doctor',
  psychologist: 'Psychologist',
  physio: 'Physiotherapist',
  educator: 'Educator',
  coordinator: 'Care coordinator',
  admin: 'Organisation admin',
  transport: 'Transport',
  pharmacy: 'Pharmacy',
  social: 'Social services',
};

/** The household side of care: the person themselves and their family. They report problems and confirm fixes. */
export const isHousehold = (role: Role) => role === 'family' || role === 'self';
/** Roles that write professional records (assessments, plans, verified diagnoses). */
export const PROFESSIONAL_ROLES: Role[] = ['doctor', 'psychologist', 'physio', 'educator'];

export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];

export type Stage = 'reported' | 'routed' | 'accepted' | 'in_progress' | 'resolved' | 'verified';
export const STAGES: Stage[] = ['reported', 'routed', 'accepted', 'in_progress', 'resolved', 'verified'];
export const STAGE_LABEL: Record<Stage, string> = {
  reported: 'Reported',
  routed: 'Routed',
  accepted: 'Accepted',
  in_progress: 'In progress',
  resolved: 'Resolved',
  verified: 'Closed',
};

export type Category =
  | 'medication'
  | 'clinical'
  | 'transport'
  | 'daily_care'
  | 'benefits'
  | 'equipment'
  | 'wellbeing'
  | 'scheduling'
  | 'learning'
  | 'rehab'
  | 'general';

export const CATEGORY_LABEL: Record<Category, string> = {
  medication: 'Medication',
  clinical: 'Clinical',
  transport: 'Transport',
  daily_care: 'Daily care',
  benefits: 'Benefits & documents',
  equipment: 'Equipment & home',
  wellbeing: 'Wellbeing',
  scheduling: 'Scheduling',
  learning: 'School & learning',
  rehab: 'Physio & rehab',
  general: 'General',
};

export interface User {
  id: string;
  name: string;
  role: Role;
  title: string;
  org: string;
  email: string;
  initials: string;
  color: string;
  available: boolean;
  skills: string[];
  /** People this person is on the care team for. Kept in step with active memberships by the engine. */
  recipients: string[];
  /** Organisation for staff (coordinators and admins only act inside their own organisation). */
  orgId?: string | null;
}

export interface Recipient {
  id: string;
  name: string;
  age: number;
  area: string;
  note: string;
  /** Care category (see shared/care.ts). Optional so older saved data still loads; missing values are suggested from the note. */
  support?: SupportLevel;
  living?: Living;
  needs?: CareNeed[];
  /** Organisation that coordinates this person's care. */
  orgId?: string;
  preferredName?: string;
  /** How they like to be spoken to and kept informed. */
  communication?: string;
  languages?: string[];
  /** Small avatar image as a data URL (optional). */
  photo?: string;
  /** Profile sections that do not apply to this person. */
  hidden?: Domain[];
  updatedAt?: number;
  /** Bumped whenever who-can-see-what changes; approvals are bound to it. */
  accessVersion?: number;
  /** Only the name is shared (a problem about them is visible, but you are not on their care team). */
  limited?: boolean;
}

// ---------------------------------------------------------------- access, consent and approvals

/** Kinds of information on a profile. Access is granted per domain. */
export type Domain = 'overview' | 'medical' | 'wellbeing' | 'wellbeing_notes' | 'academic' | 'social' | 'activity' | 'rehab' | 'team';

/** Legal authority over the person's care decisions. Never assumed from family relationship alone. */
export type Authority = 'none' | 'self' | 'guardian';

export interface Organisation {
  id: string;
  name: string;
}

export interface Membership {
  id: string;
  recipientId: string;
  userId: string;
  relationship: string;
  authority: Authority;
  /** Authority is only used once a coordinator or admin has checked the evidence. */
  authorityVerified: boolean;
  authorityEvidence?: string;
  domains: Domain[];
  status: 'active' | 'revoked';
  grantedBy: string;
  createdAt: number;
  /** Time-limited access ends automatically. */
  expiresAt?: number | null;
  revokedAt?: number;
  revokedBy?: string;
}

export interface Invite {
  id: string;
  code: string;
  recipientId: string;
  email: string;
  role: Role;
  relationship: string;
  domains: Domain[];
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
  /** How long access lasts after acceptance (days); null = until revoked. */
  accessDays: number | null;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  acceptedBy?: string;
}

export interface Consent {
  id: string;
  recipientId: string;
  /** The person whose access changed. */
  subjectId: string;
  change: 'grant' | 'revoke';
  domains: Domain[];
  /** Who agreed: the person themselves, their verified guardian, or a coordinator recording paper/verbal consent. */
  basis: 'self' | 'guardian' | 'recorded' | 'creator';
  givenBy: string;
  evidence?: string;
  at: number;
}

export type ApprovalStatus = 'pending' | 'executed' | 'rejected' | 'expired' | 'failed' | 'cancelled';

export interface Approval {
  id: string;
  recipientId: string;
  requestedBy: string;
  /** Who may decide (verified authority holders for the person). */
  approverIds: string[];
  /** The exact action that will run, as the requester, if approved. */
  action: Action;
  /** Stable fingerprint of the action; the approver must approve this exact fingerprint. */
  fingerprint: string;
  /** Snapshot of what the action depends on (e.g. the member's current access). If it changed, the approval cannot run. */
  baseVersion: string;
  summary: Msg;
  reason: string;
  reversible: boolean;
  createdAt: number;
  expiresAt: number;
  status: ApprovalStatus;
  decidedBy?: string;
  decidedAt?: number;
  error?: Msg;
}

export interface AuditEvent {
  id: string;
  at: number;
  actorId: string;
  recipientId: string | null;
  /** Domain of the information involved; the event is only shown to people who can see that domain. */
  domain: Domain;
  type: string;
  m: Msg;
  targetId?: string;
}

// ---------------------------------------------------------------- care records

export type RecordSource = 'self' | 'caregiver' | 'professional' | 'ai';
export type Verification = 'unverified' | 'verified';

export interface RecordEdit {
  at: number;
  by: string;
  fields: string[];
  before: Record<string, string | number | null>;
}

export interface CareRecord {
  id: string;
  recipientId: string;
  domain: Domain;
  kind: string;
  title: string;
  body: string;
  value?: number | null;
  unit?: string;
  /** When it happened or was measured (defaults to when it was recorded). */
  observedAt: number;
  source: RecordSource;
  authorId: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  verification: Verification;
  verifiedBy?: string;
  verifiedAt?: number;
  archived?: boolean;
  history: RecordEdit[];
}

export interface Medication {
  id: string;
  recipientId: string;
  name: string;
  strength: string;
  dose: string;
  route: string;
  /** Times of day, "HH:MM". */
  times: string[];
  startDate?: string;
  endDate?: string;
  prescriber: string;
  instructions: string;
  reminders: boolean;
  /** Units on hand and units used per dose, as entered by a person. Used only for refill reminders. */
  onHand: number | null;
  perDose: number | null;
  supplyUpdatedAt?: number;
  active: boolean;
  source: RecordSource;
  authorId: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  verification: Verification;
  verifiedBy?: string;
  history: RecordEdit[];
}

/** One scheduled dose and what is known about it. A reminder is never treated as "taken". */
export interface DoseLog {
  id: string;
  medicationId: string;
  recipientId: string;
  /** "YYYY-MM-DD HH:MM" in local time. */
  slot: string;
  status: 'taken' | 'missed' | 'skipped' | 'unknown';
  note: string;
  by: string;
  at: number;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  doneBy?: string;
  doneAt?: number;
}

export interface Comment {
  id: string;
  authorId: string;
  text: string;
  at: number;
}

/** A translatable sentence: message key + parameters (see shared/messages.ts). */
export interface Msg {
  k: string;
  p?: Record<string, string | number | Msg>;
}

export interface HistoryEvent {
  id: string;
  at: number;
  actorId: string; // 'system' for the engine
  type: string;
  text: string; // English rendering, kept for exports and logs
  m?: Msg;
}

export interface RoutingDecision {
  ruleId: string | null;
  category: Category;
  role: Role;
  assigneeId: string | null;
  confidence: number; // 0..1
  reasons: string[];
  why: Msg[];
  priority: Priority;
  inferredPriority: boolean;
}

export interface Challenge {
  id: string;
  ref: string;
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  stage: Stage;
  recipientId: string;
  reporterId: string;
  role: Role;
  assigneeId: string | null;
  createdAt: number;
  updatedAt: number;
  /** SLA clock start (creation, or the last reopen). */
  slaFrom: number;
  dueAt: number;
  escalated: boolean;
  escalationReason?: string;
  routing: RoutingDecision;
  checklist: ChecklistItem[];
  playbookId: string | null;
  comments: Comment[];
  history: HistoryEvent[];
  watchers: string[];
  resolution?: string;
  resolvedAt?: number;
  verifiedAt?: number;
  rating?: number;
  reopenCount: number;
}

export interface Rule {
  id: string;
  name: string;
  category: Category;
  role: Role;
  keywords: string[];
  enabled: boolean;
  /** Minimum priority for anything this rule matches (e.g. falls are never "low"). */
  priorityFloor: Priority | null;
}

export interface Playbook {
  id: string;
  title: string;
  category: Category;
  summary: string;
  steps: string[];
  minutes: number;
  effort: 1 | 2 | 3;
  uses: number;
  successes: number;
  authorId: string;
  tags: string[];
  updatedAt: number;
}

export interface Notification {
  id: string;
  userId: string;
  challengeId: string | null;
  text: string;
  at: number;
  read: boolean;
  m?: Msg;
  kind: 'assigned' | 'update' | 'escalation' | 'resolved' | 'comment' | 'system';
}

export interface Settings {
  /** SLA in minutes per priority. */
  sla: Record<Priority, number>;
  autoEscalate: boolean;
  balanceLoad: boolean;
  preferContinuity: boolean;
}

export interface State {
  version: number;
  /** Data format version; older saved data is upgraded on load without losing anything. */
  schema?: number;
  seq: number;
  users: User[];
  recipients: Recipient[];
  challenges: Challenge[];
  rules: Rule[];
  playbooks: Playbook[];
  notifications: Notification[];
  settings: Settings;
  orgs: Organisation[];
  memberships: Membership[];
  invites: Invite[];
  consents: Consent[];
  approvals: Approval[];
  audit: AuditEvent[];
  records: CareRecord[];
  medications: Medication[];
  doseLogs: DoseLog[];
  plans: CarePlan[];
  tasks: CareTask[];
  appointments: Appointment[];
  documents: CareDocument[];
}

/** What a signed-in user receives: the state filtered to what they may see. */
export interface View extends State {
  me: string;
  loads: Record<string, number>;
  /** What the viewer may see for each person they can open: recipientId -> domains. */
  access: Record<string, Domain[]>;
}

export type Action =
  | { type: 'create_challenge'; title: string; description: string; recipientId: string; priority?: Priority | 'auto'; category?: Category | 'auto' }
  | { type: 'claim'; id: string }
  | { type: 'accept'; id: string }
  | { type: 'start'; id: string }
  | { type: 'move'; id: string; stage: Stage }
  | { type: 'toggle_check'; id: string; itemId: string }
  | { type: 'add_check'; id: string; text: string }
  | { type: 'apply_playbook'; id: string; playbookId: string }
  | { type: 'comment'; id: string; text: string }
  | { type: 'handoff'; id: string; role: Role; reason: string }
  | { type: 'reassign'; id: string; assigneeId: string; reason: string }
  | { type: 'set_priority'; id: string; priority: Priority }
  | { type: 'escalate'; id: string; reason: string }
  | { type: 'clear_escalation'; id: string }
  | { type: 'resolve'; id: string; resolution: string }
  | { type: 'verify'; id: string; rating: number }
  | { type: 'reopen'; id: string; reason: string }
  | { type: 'watch'; id: string; on: boolean }
  | { type: 'mark_read'; notificationId: string | 'all' }
  | { type: 'set_availability'; userId: string; available: boolean }
  | { type: 'update_profile'; name: string; title: string; skills: string[] }
  | { type: 'update_user'; userId: string; title: string; org: string; skills: string[]; recipients: string[] }
  | { type: 'add_user'; name: string; role: Role; title: string; org: string; email: string; skills: string[]; recipients: string[] }
  | { type: 'upsert_rule'; rule: Omit<Rule, 'id'> & { id?: string } }
  | { type: 'delete_rule'; id: string }
  | { type: 'upsert_playbook'; playbook: Omit<Playbook, 'id' | 'uses' | 'successes' | 'authorId' | 'updatedAt'> & { id?: string } }
  | { type: 'delete_playbook'; id: string }
  | { type: 'update_settings'; settings: Settings }
  | { type: 'add_recipient'; name: string; age: number; area: string; note: string; familyIds: string[]; support?: SupportLevel; living?: Living; needs?: CareNeed[] }
  | { type: 'update_recipient'; recipientId: string; age: number; area: string; note: string; support: SupportLevel; living: Living; needs: CareNeed[] }
  // profile & records
  | { type: 'update_preferences'; recipientId: string; preferredName: string; communication: string; languages: string[]; hidden: Domain[]; photo?: string | null }
  | { type: 'add_record'; recipientId: string; domain: Domain; kind: string; title: string; body: string; value?: number | null; unit?: string; observedAt?: number }
  | { type: 'edit_record'; recordId: string; baseVersion: number; title: string; body: string; value?: number | null; unit?: string; observedAt?: number }
  | { type: 'verify_record'; recordId: string }
  | { type: 'archive_record'; recordId: string; reason: string }
  | { type: 'add_medication'; recipientId: string; med: MedicationInput }
  | { type: 'edit_medication'; medicationId: string; baseVersion: number; med: MedicationInput }
  | { type: 'verify_medication'; medicationId: string }
  | { type: 'log_dose'; medicationId: string; slot: string; status: DoseLog['status']; note: string }
  | { type: 'update_supply'; medicationId: string; onHand: number }
  // care team, consent and approvals
  | { type: 'invite_member'; recipientId: string; email: string; role: Role; relationship: string; domains: Domain[]; accessDays: number | null; code?: string; evidence?: string }
  | { type: 'cancel_invite'; inviteId: string }
  | { type: 'accept_invite'; code: string }
  | { type: 'set_access'; membershipId: string; domains: Domain[]; evidence?: string }
  | { type: 'revoke_member'; membershipId: string; reason: string }
  | { type: 'verify_authority'; membershipId: string; evidence: string }
  | { type: 'decide_approval'; approvalId: string; decision: 'approve' | 'reject'; fingerprint: string }
  // plans, tasks, appointments, documents
  | { type: 'add_plan'; recipientId: string; title: string; goal: string; domain: Domain }
  | { type: 'update_plan'; planId: string; title: string; goal: string; status: CarePlan['status'] }
  | { type: 'add_task'; recipientId: string; task: TaskInput; draft?: boolean; allowConflict?: boolean }
  | { type: 'edit_task'; taskId: string; baseVersion: number; task: TaskInput; allowConflict?: boolean }
  | { type: 'submit_task'; taskId: string }
  | { type: 'schedule_task'; taskId: string; baseVersion: number }
  | { type: 'task_status'; taskId: string; status: 'in_progress' | 'completed' | 'blocked' | 'cancelled' | 'failed' | 'resume'; reason?: string; evidence?: string; evidenceDocId?: string }
  | { type: 'task_comment'; taskId: string; text: string }
  | { type: 'create_handover'; recipientId: string; toUserId: string; note: string; hours: number }
  | { type: 'request_cover'; recipientId: string; from: number; to: number; reason: string; domain: Domain }
  | { type: 'offer_cover'; taskId: string; allowConflict?: boolean }
  | { type: 'add_appointment'; recipientId: string; appt: AppointmentInput; prep: string[]; allowConflict?: boolean }
  | { type: 'edit_appointment'; appointmentId: string; baseVersion: number; appt: AppointmentInput; allowConflict?: boolean }
  | { type: 'appointment_status'; appointmentId: string; status: 'completed' | 'cancelled' | 'missed'; outcome?: string }
  | { type: 'add_document'; recipientId: string; domain: Domain; title: string; description: string; fileName: string; mime: string; size: number; dataUrl?: string; fileKey?: string }
  | { type: 'archive_document'; documentId: string; reason: string }
  | { type: 'note_export'; recipientId: string; what: 'progress' }
  | { type: 'cancel_approval'; approvalId: string };

// ---------------------------------------------------------------- plans, tasks, appointments, documents

export type TaskStatus = 'draft' | 'awaiting_approval' | 'scheduled' | 'in_progress' | 'completed' | 'blocked' | 'cancelled' | 'failed';
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';
export type TaskKind = 'task' | 'prep' | 'handover' | 'coverage';

export interface CarePlan {
  id: string;
  recipientId: string;
  title: string;
  goal: string;
  /** Who can see the plan and its tasks. */
  domain: Domain;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'completed' | 'archived';
}

export interface TaskEvent {
  at: number;
  by: string;
  m: Msg;
}

export interface HandoverItem {
  type: 'task' | 'record' | 'dose' | 'problem' | 'appointment';
  id: string;
  title: string;
  at: number;
  state: string;
}

export interface CareTask {
  id: string;
  recipientId: string;
  planId: string | null;
  /** Subtask of another task (e.g. a preparation step). */
  parentId: string | null;
  appointmentId: string | null;
  kind: TaskKind;
  title: string;
  notes: string;
  domain: Domain;
  ownerId: string | null;
  status: TaskStatus;
  /** Status to return to when unblocked. */
  resumeStatus?: TaskStatus;
  priority: Priority;
  dueAt: number | null;
  recurrence: Recurrence;
  seriesId: string;
  dependsOn: string[];
  /** Ask a verified guardian (or the person) before it is scheduled. */
  needsApproval: boolean;
  approvalId?: string;
  evidenceRequired: boolean;
  evidence?: string;
  evidenceDocId?: string;
  statusReason?: string;
  comments: Comment[];
  events: TaskEvent[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  version: number;
  remindedAt?: number;
  escalatedAt?: number;
  /** Cover requests: the time to cover. */
  coverFrom?: number;
  coverTo?: number;
  /** Handovers: what was passed on, limited to what both people may see. */
  handover?: { fromId: string; items: HandoverItem[] };
}

export type AppointmentKind = 'medical' | 'therapy' | 'physio' | 'school' | 'activity' | 'other';

export interface Appointment {
  id: string;
  recipientId: string;
  title: string;
  kind: AppointmentKind;
  domain: Domain;
  startAt: number;
  endAt: number;
  location: string;
  withWhom: string;
  /** Care-team members attending (used for conflict checks). */
  attendeeIds: string[];
  notes: string;
  status: 'scheduled' | 'completed' | 'cancelled' | 'missed';
  outcome?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface CareDocument {
  id: string;
  recipientId: string;
  domain: Domain;
  title: string;
  description: string;
  fileName: string;
  mime: string;
  size: number;
  /** inline: kept in the data (browser demo, small files). server: stored as a file, fetched through an authorised endpoint. */
  storage: 'inline' | 'server';
  dataUrl?: string;
  /** Server storage key (never chosen by the client). */
  fileKey?: string;
  uploadedBy: string;
  uploadedAt: number;
  source: RecordSource;
  archived?: boolean;
}

export interface TaskInput {
  title: string;
  notes: string;
  domain: Domain;
  ownerId: string | null;
  priority: Priority;
  dueAt: number | null;
  recurrence: Recurrence;
  dependsOn: string[];
  needsApproval: boolean;
  evidenceRequired: boolean;
  planId: string | null;
  parentId?: string | null;
}

export interface AppointmentInput {
  title: string;
  kind: AppointmentKind;
  domain: Domain;
  startAt: number;
  endAt: number;
  location: string;
  withWhom: string;
  attendeeIds: string[];
  notes: string;
}

export interface MedicationInput {
  name: string;
  strength: string;
  dose: string;
  route: string;
  times: string[];
  startDate?: string;
  endDate?: string;
  prescriber: string;
  instructions: string;
  reminders: boolean;
  onHand: number | null;
  perDose: number | null;
  active: boolean;
}

export class EngineError extends Error {
  status: number;
  m: Msg;
  constructor(m: Msg, status = 400, english?: string) {
    super(english ?? m.k);
    this.m = m;
    this.status = status;
  }
}
