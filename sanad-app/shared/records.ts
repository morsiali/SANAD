// What can be recorded in each profile section, who may record it, and how it is shown.
import type { CareRecord, DoseLog, Domain, Medication, RecordSource, Role } from './types';

export interface RecordKind {
  kind: string;
  domain: Domain;
  label: string;
  /** Hint shown in the form. */
  hint: string;
  /** Numeric value with a unit (measurements, check-ins). */
  measure?: { unit: string; min?: number; max?: number; label: string; units?: string[] };
  /** Only these roles may create it (e.g. diagnoses by doctors). Default: anyone who can write the section. */
  roles?: Role[];
  /** Only professionals in these roles can mark it verified. */
  verifiers: Role[];
}

const PRO_MED: Role[] = ['doctor'];

export const RECORD_KINDS: RecordKind[] = [
  // Medical
  { kind: 'condition', domain: 'medical', label: 'Health condition', hint: 'Describe the condition in plain words. A doctor can verify it.', verifiers: PRO_MED },
  { kind: 'diagnosis', domain: 'medical', label: 'Diagnosis', hint: 'Only doctors on the care team can enter a diagnosis.', roles: ['doctor'], verifiers: PRO_MED },
  { kind: 'allergy', domain: 'medical', label: 'Allergy or precaution', hint: 'What to avoid and what happens (e.g. rash).', verifiers: PRO_MED },
  { kind: 'history', domain: 'medical', label: 'Medical history', hint: 'Past operations, hospital stays or important events.', verifiers: PRO_MED },
  { kind: 'provider', domain: 'medical', label: 'Treating professional or facility', hint: 'Name, speciality and contact details.', verifiers: PRO_MED },
  { kind: 'observation', domain: 'medical', label: 'Symptom or observation', hint: 'What you noticed and when. Describe, don’t diagnose.', verifiers: PRO_MED },
  {
    kind: 'measurement',
    domain: 'medical',
    label: 'Measurement',
    hint: 'One reading with its unit, e.g. blood glucose 7.8 mmol/L.',
    measure: { unit: 'mmol/L', label: 'Reading', units: ['mmol/L', 'mg/dL', 'mmHg', 'kg', 'bpm', '°C', '%'] },
    verifiers: PRO_MED,
  },
  { kind: 'result', domain: 'medical', label: 'Test result or report', hint: 'Test name, date and the result as written on the report.', verifiers: PRO_MED },
  { kind: 'followup', domain: 'medical', label: 'Follow-up instruction', hint: 'Instructions given by the treating professional.', roles: ['doctor'], verifiers: PRO_MED },

  // Psychological well-being
  { kind: 'checkin', domain: 'wellbeing', label: 'Well-being check-in', hint: 'How they feel today, in their words where possible.', measure: { unit: '/5', min: 1, max: 5, label: 'Mood (1 low – 5 good)' }, verifiers: [] },
  { kind: 'sleep', domain: 'wellbeing', label: 'Sleep', hint: 'Hours slept and anything notable.', measure: { unit: 'h', min: 0, max: 24, label: 'Hours slept' }, verifiers: [] },
  { kind: 'stress', domain: 'wellbeing', label: 'Stress observation', hint: 'What seemed stressful and what helped.', measure: { unit: '/5', min: 1, max: 5, label: 'Stress (1 calm – 5 very stressed)' }, verifiers: [] },
  { kind: 'behaviour', domain: 'wellbeing', label: 'Behaviour observation', hint: 'What happened, before and after. Describe, don’t label.', verifiers: [] },
  { kind: 'support', domain: 'wellbeing', label: 'Support preference', hint: 'What helps, what to avoid, how they like to be supported.', verifiers: [] },
  { kind: 'session', domain: 'wellbeing', label: 'Session schedule', hint: 'Day, time and place of sessions.', roles: ['psychologist'], verifiers: ['psychologist'] },
  { kind: 'goal', domain: 'wellbeing', label: 'Professional goal', hint: 'A goal agreed with the psychologist.', roles: ['psychologist'], verifiers: ['psychologist'] },
  { kind: 'progress_note', domain: 'wellbeing_notes', label: 'Progress note (private)', hint: 'Only people with access to private therapy notes can read this.', roles: ['psychologist'], verifiers: ['psychologist'] },

  // Academic
  { kind: 'school', domain: 'academic', label: 'School and grade', hint: 'School or education provider and current grade or stage.', verifiers: ['educator'] },
  { kind: 'learning_goal', domain: 'academic', label: 'Learning goal', hint: 'A goal agreed with the school or family.', verifiers: ['educator'] },
  { kind: 'iep', domain: 'academic', label: 'Individual education plan', hint: 'Summary of the plan provided by the school.', roles: ['educator'], verifiers: ['educator'] },
  { kind: 'accommodation', domain: 'academic', label: 'Accommodation or access need', hint: 'e.g. extra time, a quiet room, speech-to-text.', verifiers: ['educator'] },
  { kind: 'assessment', domain: 'academic', label: 'Assessment or milestone', hint: 'What was assessed and the outcome.', roles: ['educator'], verifiers: ['educator'] },
  { kind: 'attendance', domain: 'academic', label: 'Attendance', hint: 'Attendance for a period.', measure: { unit: '%', min: 0, max: 100, label: 'Attendance' }, roles: ['educator'], verifiers: ['educator'] },
  { kind: 'teacher_note', domain: 'academic', label: 'Teacher observation', hint: 'What the teacher noticed in class.', roles: ['educator'], verifiers: [] },

  // Social
  { kind: 'social_goal', domain: 'social', label: 'Personal social goal', hint: 'A goal they chose, or agreed with a professional. More social is not automatically better.', verifiers: [] },
  { kind: 'participation', domain: 'social', label: 'Activity they joined', hint: 'An activity they chose to take part in.', verifiers: [] },
  { kind: 'community', domain: 'social', label: 'Community involvement', hint: 'Groups, clubs, volunteering or faith community.', verifiers: [] },
  { kind: 'social_obs', domain: 'social', label: 'Observation', hint: 'What went well or was hard, measured against their own goals.', verifiers: [] },
  { kind: 'achievement', domain: 'social', label: 'Achievement', hint: 'Something meaningful to them.', verifiers: [] },

  // Sports & activity
  { kind: 'preference', domain: 'activity', label: 'Preferred activity', hint: 'Activities they enjoy.', verifiers: [] },
  { kind: 'activity_goal', domain: 'activity', label: 'Activity goal', hint: 'A goal they chose, within any recorded restrictions.', verifiers: [] },
  { kind: 'activity_log', domain: 'activity', label: 'Activity session', hint: 'What they did and for how long.', measure: { unit: 'min', min: 0, max: 600, label: 'Minutes' }, verifiers: [] },

  // Physiotherapy & rehab
  { kind: 'rehab_plan', domain: 'rehab', label: 'Physiotherapy plan', hint: 'Only physiotherapists can create plans.', roles: ['physio'], verifiers: ['physio'] },
  { kind: 'exercise', domain: 'rehab', label: 'Assigned exercise', hint: 'Exercise, sets, repetitions and instructions.', roles: ['physio'], verifiers: ['physio'] },
  { kind: 'restriction', domain: 'rehab', label: 'Restriction', hint: 'Clinician-documented limits on activity.', roles: ['physio', 'doctor'], verifiers: ['physio', 'doctor'] },
  { kind: 'completion', domain: 'rehab', label: 'Exercise completed', hint: 'Which exercises were done today.', verifiers: [] },
  { kind: 'pain', domain: 'rehab', label: 'Pain, fatigue or difficulty', hint: 'How it felt during or after exercises.', measure: { unit: '/10', min: 0, max: 10, label: 'Pain (0 none – 10 worst)' }, verifiers: [] },
  { kind: 'milestone', domain: 'rehab', label: 'Functional milestone', hint: 'e.g. climbed stairs without a rail.', roles: ['physio'], verifiers: ['physio'] },
];

export const kindOf = (kind: string) => RECORD_KINDS.find((k) => k.kind === kind);
export const kindsFor = (domain: Domain) => RECORD_KINDS.filter((k) => k.domain === domain);

export function sourceFor(role: Role): RecordSource {
  if (role === 'self') return 'self';
  if (role === 'doctor' || role === 'psychologist' || role === 'physio' || role === 'educator') return 'professional';
  return 'caregiver';
}

export const SOURCE_LABEL: Record<RecordSource, string> = {
  self: 'Self-reported',
  caregiver: 'Caregiver observation',
  professional: 'Professional entry',
  ai: 'AI-generated summary',
};

// ---------------------------------------------------------------- medicines

export const DOSE_STATUS_LABEL: Record<DoseLog['status'], string> = {
  taken: 'Taken',
  missed: 'Missed',
  skipped: 'Skipped on purpose',
  unknown: 'Not known',
};

/** "YYYY-MM-DD" for a timestamp in local time. */
export function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function slotTime(slot: string): number {
  const [date, time] = slot.split(' ');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = (time ?? '00:00').split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi).getTime();
}

/** Scheduled slots for one day, with whatever has been logged. Slots with no log are "not logged" — never assumed taken. */
export function doseSlots(med: Medication, logs: DoseLog[], day: string): { slot: string; log?: DoseLog }[] {
  if (!med.active) return [];
  if (med.startDate && day < med.startDate) return [];
  if (med.endDate && day > med.endDate) return [];
  return [...med.times].sort().map((t) => {
    const slot = `${day} ${t}`;
    const log = logs.filter((l) => l.medicationId === med.id && l.slot === slot).sort((a, b) => b.at - a.at)[0];
    return { slot, log };
  });
}

export interface RefillForecast {
  /** Days of supply left at the recorded schedule, or null when supply or dose was not entered. */
  daysLeft: number | null;
  runsOutOn: number | null;
  /** Remind when 7 days or less remain. */
  due: boolean;
}

/**
 * Transparent rule, not a prediction: units on hand ÷ (units per dose × doses per day),
 * counted from when the supply was last entered. Logged "taken" doses are not subtracted twice.
 */
export function refillForecast(med: Medication, now: number): RefillForecast {
  if (!med.active || med.onHand == null || !med.perDose || !med.times.length) return { daysLeft: null, runsOutOn: null, due: false };
  const perDay = med.perDose * med.times.length;
  const elapsedDays = Math.max(0, (now - (med.supplyUpdatedAt ?? med.updatedAt)) / 86_400_000);
  const left = Math.max(0, med.onHand / perDay - elapsedDays);
  const daysLeft = Math.floor(left * 10) / 10;
  return { daysLeft, runsOutOn: now + left * 86_400_000, due: left <= 7 };
}

/** Records shown newest first, without archived ones. */
export const liveRecords = (records: CareRecord[], recipientId: string, domain?: Domain) =>
  records.filter((r) => r.recipientId === recipientId && !r.archived && (!domain || r.domain === domain)).sort((a, b) => b.observedAt - a.observedAt);
