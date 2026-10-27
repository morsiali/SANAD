import type { Role } from '../../shared/types';

export interface Template {
  label: string;
  title: string;
  description: string;
}

export interface RoleConfig {
  focus: string;
  templates: Template[];
}

export const ROLE_CONFIG: Record<Role, RoleConfig> = {
  self: {
    focus: 'Your own care in one place: what is planned, who is helping, and a quick way to ask for help.',
    templates: [
      { label: 'Need a ride', title: 'Need a ride to my appointment', description: 'Pickup from home.' },
      { label: 'Medicine running low', title: 'My medicine is running low', description: 'Need a refill before it runs out.' },
      { label: 'Feeling low', title: 'Feeling low and would like to talk', description: 'Would like someone to call me.' },
    ],
  },
  psychologist: {
    focus: 'Well-being concerns routed to you for the people whose care team you are on.',
    templates: [
      { label: 'Session change', title: 'Therapy session needs to move', description: 'Please find a new time this week.' },
      { label: 'Transport to session', title: 'Ride needed to the therapy session', description: 'Pickup from home.' },
    ],
  },
  physio: {
    focus: 'Rehab questions and exercise plans for the people on your caseload.',
    templates: [
      { label: 'Equipment needed', title: 'Walking frame needs adjusting', description: 'Height is wrong after the last visit.' },
      { label: 'Book transport', title: 'Ride needed to the physio session', description: 'Wheelchair-accessible vehicle needed.' },
    ],
  },
  educator: {
    focus: 'School and learning matters for the students whose care team you are on.',
    templates: [
      { label: 'Accessibility at school', title: 'Lift at school is out of service', description: 'Needs another way between floors this week.' },
      { label: 'Learning support', title: 'Needs extra learning support in class', description: 'Describe what would help.' },
    ],
  },
  admin: {
    focus: 'Care teams, consent and verification across your organisation.',
    templates: [],
  },
  family: {
    focus: 'Raise anything that worries you. SANAD sends it straight to the person who can fix it, and you can follow every step.',
    templates: [
      { label: 'Missed medication', title: 'Missed her medication this morning', description: 'She forgot to take the morning tablets.' },
      { label: 'Need a ride', title: 'Need a ride to an appointment', description: 'Pickup from home, wheelchair not needed.' },
      { label: 'Feeling lonely', title: 'Feeling lonely during the day', description: 'Would like someone to visit and talk.' },
      { label: 'Card renewal', title: 'Insurance card renewal', description: 'The Thiqa card expires soon, paperwork needed.' },
    ],
  },
  caregiver: {
    focus: 'Your visits, your people, and the problems only you can solve today.',
    templates: [
      { label: 'Supplies running low', title: 'Supplies running low', description: 'Test strips and insulin pens running low, refill needed.' },
      { label: 'A fall at home', title: 'Slipped and fell at home', description: 'Describe any injury and whether they can get up.' },
      { label: 'Equipment broken', title: 'Walker is broken', description: 'Unsafe to use, needs repair or a loan unit.' },
      { label: 'Clinical concern', title: 'Blood pressure is high', description: 'Readings today and any symptoms.' },
    ],
  },
  doctor: {
    focus: 'Clinical concerns and appointments routed to you, with the history attached.',
    templates: [
      { label: 'Refill needed', title: 'Prescription refill needed', description: 'Renewed prescription sent, please prepare the refill.' },
      { label: 'Home visit needed', title: 'Care visit needed for wound dressing', description: 'Daily dressing change for the next week.' },
      { label: 'Book transport', title: 'Ride to clinic for follow-up', description: 'Patient needs transport for the follow-up visit.' },
    ],
  },
  coordinator: {
    focus: 'Everything across the network: triage, escalations and team load.',
    templates: [
      { label: 'Missed care visit', title: 'Care visit missed this morning', description: 'The caregiver did not come, meals and hygiene needed.' },
      { label: 'Transport no-show', title: 'Driver did not show for pickup', description: 'Patient waiting for the ride.' },
      { label: 'Benefits issue', title: 'Allowance application stuck', description: 'Paperwork needs follow-up.' },
    ],
  },
  transport: {
    focus: 'Rides to book, rides at risk, and anything blocking a pickup.',
    templates: [
      { label: 'Appointment moved', title: 'Clinic appointment moved — reschedule needed', description: 'The clinic changed the time, booking needs updating.' },
      { label: 'Not ready at pickup', title: 'Patient not ready at pickup, needs care visit', description: 'Patient needed help dressing before the ride.' },
    ],
  },
  pharmacy: {
    focus: 'Refills, deliveries and prescriptions that need a decision.',
    templates: [
      { label: 'Prescription expired', title: 'Prescription expired — renewal needed at clinic', description: 'Cannot refill until the doctor renews it. Follow-up appointment needed.' },
      { label: 'Delivery failed', title: 'Medicine delivery failed', description: 'Nobody home at delivery, need a new pickup time.' },
    ],
  },
  social: {
    focus: 'Benefits, documents, equipment and wellbeing — the things that keep people independent.',
    templates: [
      { label: 'Home adaptation', title: 'Grab bar needed in the bathroom', description: 'Assessment and installation.' },
      { label: 'Clinical concern', title: 'Seems confused during visit', description: 'Noticed confusion and memory issues today.' },
    ],
  },
};
