// SANAD domain model — shared by the server, the browser and the tests.

export type Role =
  | 'family'
  | 'caregiver'
  | 'doctor'
  | 'coordinator'
  | 'transport'
  | 'pharmacy'
  | 'social';

export const ROLES: Role[] = ['family', 'caregiver', 'doctor', 'coordinator', 'transport', 'pharmacy', 'social'];

export const ROLE_LABEL: Record<Role, string> = {
  family: 'Family',
  caregiver: 'Caregiver',
  doctor: 'Doctor',
  coordinator: 'Care coordinator',
  transport: 'Transport',
  pharmacy: 'Pharmacy',
  social: 'Social services',
};

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
  /** Care recipients this person is linked to (family members, regular carers). */
  recipients: string[];
}

export interface Recipient {
  id: string;
  name: string;
  age: number;
  area: string;
  note: string;
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
  seq: number;
  users: User[];
  recipients: Recipient[];
  challenges: Challenge[];
  rules: Rule[];
  playbooks: Playbook[];
  notifications: Notification[];
  settings: Settings;
}

/** What a signed-in user receives: the state filtered to what they may see. */
export interface View extends State {
  me: string;
  loads: Record<string, number>;
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
  | { type: 'add_recipient'; name: string; age: number; area: string; note: string; familyIds: string[] };

export class EngineError extends Error {
  status: number;
  m: Msg;
  constructor(m: Msg, status = 400, english?: string) {
    super(english ?? m.k);
    this.m = m;
    this.status = status;
  }
}
