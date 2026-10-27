// Demo world: four families in Dubai, a second organisation in Sharjah, and the people who support them.
// All people and records are synthetic.
// The history is produced by replaying real actions through the engine, so every
// routing decision, notification and audit entry is genuine.
import type { Action, AppointmentInput, Consent, Domain, Membership, Playbook, Rule, State, TaskInput, User } from './types';
import { apply, sweep } from './engine';
import { syncLinks } from './care-engine';
import { ROLE_DOMAINS } from './access';
import { dayKey } from './records';

const H = 3.6e6;


const users: User[] = [
  { id: 'u-mariam', name: 'Mariam Al Noor', role: 'family', title: 'Daughter of Fatima', org: 'Family', email: 'mariam@sanad.ae', initials: 'MA', color: '#476ADB', available: true, skills: [], recipients: ['r-fatima'] },
  { id: 'u-khalid', name: 'Khalid Al Mansoori', role: 'family', title: 'Son of Hamad', org: 'Family', email: 'khalid@sanad.ae', initials: 'KA', color: '#3E8E3A', available: true, skills: [], recipients: ['r-hamad'] },
  { id: 'u-aisha', name: 'Aisha Rahman', role: 'caregiver', title: 'Home care nurse', org: 'Rahma Home Care', email: 'aisha@sanad.ae', initials: 'AR', color: '#1F9E8F', available: true, skills: ['insulin', 'wound', 'mobility', 'fall'], recipients: ['r-fatima', 'r-khadija'] },
  { id: 'u-joseph', name: 'Joseph Mathew', role: 'caregiver', title: 'Care assistant', org: 'Rahma Home Care', email: 'joseph@sanad.ae', initials: 'JM', color: '#C9861A', available: true, skills: ['bathing', 'meals', 'hygiene', 'wheelchair'], recipients: ['r-hamad'] },
  { id: 'u-kareem', name: 'Dr. Kareem Hassan', role: 'doctor', title: 'Geriatrician', org: 'Al Barsha Health Centre', email: 'kareem@sanad.ae', initials: 'KH', color: '#7A5AC8', available: true, skills: ['diabetes', 'blood pressure', 'glucose', 'memory'], recipients: ['r-fatima', 'r-hamad'] },
  { id: 'u-layla', name: 'Dr. Layla Haddad', role: 'doctor', title: 'Family physician', org: 'Qusais Clinic', email: 'layla@sanad.ae', initials: 'LH', color: '#D2566B', available: true, skills: ['wound', 'infection', 'knee', 'physio'], recipients: ['r-khadija'] },
  { id: 'u-sara', name: 'Sara Al Hashimi', role: 'coordinator', title: 'Care coordinator', org: 'SANAD Care Hub', email: 'sara@sanad.ae', initials: 'SA', color: '#202128', available: true, skills: [], recipients: [] },
  { id: 'u-yousef', name: 'Yousef Karim', role: 'transport', title: 'Dispatcher', org: 'CareRide', email: 'yousef@sanad.ae', initials: 'YK', color: '#2B7BB9', available: true, skills: ['wheelchair', 'dialysis'], recipients: [] },
  { id: 'u-omar', name: 'Omar Farouk', role: 'pharmacy', title: 'Pharmacist', org: 'Al Noor Pharmacy', email: 'omar@sanad.ae', initials: 'OF', color: '#9A6B3F', available: true, skills: ['refill', 'insulin', 'delivery'], recipients: [] },
  { id: 'u-noura', name: 'Noura Al Suwaidi', role: 'social', title: 'Social worker', org: 'Community Development Authority', email: 'noura@sanad.ae', initials: 'NA', color: '#476ADB', available: true, skills: ['thiqa', 'emirates id', 'loneliness', 'equipment'], recipients: [] },
  { id: 'u-khadija', name: 'Khadija Saeed', role: 'self', title: 'Person receiving care', org: 'Self', email: 'khadija@sanad.ae', initials: 'KS', color: '#D2566B', available: true, skills: [], recipients: [] },
  { id: 'u-huda', name: 'Huda Al Hammadi', role: 'family', title: 'Mother of Rashid', org: 'Family', email: 'huda@sanad.ae', initials: 'HH', color: '#7A5AC8', available: true, skills: [], recipients: [] },
  { id: 'u-salma', name: 'Dr. Salma Idris', role: 'psychologist', title: 'Clinical psychologist', org: 'Mind Well Clinic', email: 'salma@sanad.ae', initials: 'SI', color: '#1F9E8F', available: true, skills: ['anxiety', 'coping', 'transitions'], recipients: [] },
  { id: 'u-faisal', name: 'Faisal Nasser', role: 'physio', title: 'Physiotherapist', org: 'Move Well Rehab', email: 'faisal@sanad.ae', initials: 'FN', color: '#3E8E3A', available: true, skills: ['knee', 'strength', 'exercises', 'walking'], recipients: [] },
  { id: 'u-grace', name: 'Grace Thomas', role: 'educator', title: 'Class teacher', org: 'Al Mizhar Primary School', email: 'grace@sanad.ae', initials: 'GT', color: '#C9861A', available: true, skills: ['iep', 'homework', 'robotics'], recipients: [] },
  { id: 'u-majid', name: 'Majid Saeed', role: 'admin', title: 'Organisation admin', org: 'SANAD Care Hub', email: 'majid@sanad.ae', initials: 'MS', color: '#202128', available: true, skills: [], recipients: [], orgId: 'org-hub' },
  { id: 'u-hind', name: 'Hind Al Zaabi', role: 'coordinator', title: 'Care coordinator', org: 'Noor Community Care', email: 'hind@sanad.ae', initials: 'HZ', color: '#2B7BB9', available: true, skills: [], recipients: [], orgId: 'org-noor' },
];

/** Care teams. Authority is only "verified" where a coordinator checked evidence (synthetic). */
const teams: { r: string; u: string; rel: string; authority?: 'self' | 'guardian'; evidence?: string; domains?: Domain[]; basis: Consent['basis']; by: string; consentEvidence?: string }[] = [
  { r: 'r-fatima', u: 'u-mariam', rel: 'Daughter', authority: 'guardian', evidence: 'Lasting power of attorney checked by the coordinator (synthetic)', basis: 'guardian', by: 'u-mariam' },
  { r: 'r-fatima', u: 'u-aisha', rel: 'Home care nurse', basis: 'guardian', by: 'u-mariam' },
  { r: 'r-fatima', u: 'u-kareem', rel: 'Geriatrician', basis: 'guardian', by: 'u-mariam' },
  { r: 'r-hamad', u: 'u-khalid', rel: 'Son', basis: 'recorded', by: 'u-sara', consentEvidence: 'Hamad gave verbal consent at intake, witnessed and recorded by Sara (synthetic)' },
  { r: 'r-hamad', u: 'u-joseph', rel: 'Care assistant', basis: 'recorded', by: 'u-sara', consentEvidence: 'Hamad gave verbal consent at intake, witnessed and recorded by Sara (synthetic)' },
  { r: 'r-hamad', u: 'u-kareem', rel: 'Geriatrician', basis: 'recorded', by: 'u-sara', consentEvidence: 'Hamad gave verbal consent at intake, witnessed and recorded by Sara (synthetic)' },
  { r: 'r-khadija', u: 'u-khadija', rel: 'Self', authority: 'self', evidence: 'Her own account', basis: 'self', by: 'u-khadija' },
  { r: 'r-khadija', u: 'u-aisha', rel: 'Home care nurse', basis: 'self', by: 'u-khadija' },
  { r: 'r-khadija', u: 'u-layla', rel: 'Family physician', basis: 'self', by: 'u-khadija' },
  { r: 'r-khadija', u: 'u-faisal', rel: 'Physiotherapist', basis: 'self', by: 'u-khadija' },
  { r: 'r-rashid', u: 'u-huda', rel: 'Mother', authority: 'guardian', evidence: 'Birth certificate and family book checked by the coordinator (synthetic)', domains: ['overview', 'medical', 'wellbeing', 'academic', 'social', 'activity', 'rehab', 'team'], basis: 'guardian', by: 'u-huda' },
  { r: 'r-rashid', u: 'u-grace', rel: 'Class teacher', basis: 'guardian', by: 'u-huda' },
  { r: 'r-rashid', u: 'u-salma', rel: 'Psychologist', basis: 'guardian', by: 'u-huda' },
  { r: 'r-rashid', u: 'u-faisal', rel: 'Physiotherapist', basis: 'guardian', by: 'u-huda' },
  { r: 'r-rashid', u: 'u-layla', rel: 'Family physician', basis: 'guardian', by: 'u-huda' },
];

const rules: Rule[] = [
  { id: 'rule-med-supply', name: 'Medication supply', category: 'medication', role: 'pharmacy', enabled: true, priorityFloor: null, keywords: ['refill', 'ran out', 'run out', 'running low', 'out of stock', 'pharmacy', 'prescription', 'insulin pen', 'medicine delivery', 'medication delivery', 'inhaler', 'strips', 'صرف', 'اعاده صرف', 'وصفه', 'الوصفه', 'صيدليه', 'نفد', 'نفدت', 'نفاد', 'على وشك النفاد', 'اقلام الانسولين', 'قلم انسولين', 'شرائط', 'توصيل الدواء', 'بخاخ'] },
  { id: 'rule-med-admin', name: 'Medication at home', category: 'medication', role: 'caregiver', enabled: true, priorityFloor: 'high', keywords: ['missed dose', 'missed her dose', 'missed his dose', 'forgot to take', 'did not take', 'didnt take', 'wrong dose', 'pill organiser', 'pill organizer', 'tablets', 'نسي الجرعه', 'نسيت الجرعه', 'نسيت ان تتناول', 'فاتته الجرعه', 'فاتتها الجرعه', 'جرعه', 'حبوب', 'اقراص', 'لم تتناول', 'لم يتناول', 'منظم الحبوب'] },
  { id: 'rule-clinical', name: 'Clinical concern', category: 'clinical', role: 'doctor', enabled: true, priorityFloor: null, keywords: ['fever', 'blood pressure', 'sugar level', 'glucose', 'dizzy', 'dizziness', 'symptom', 'lab result', 'test result', 'swelling', 'infection', 'cough', 'breathing', 'chest pain', 'side effect', 'confused', 'confusion', 'rash', 'pain', 'حمي', 'حراره', 'ضغط الدم', 'سكر الدم', 'مستوي السكر', 'قراءات السكر', 'دوخه', 'دوار', 'اعراض', 'تحليل', 'نتائج الفحص', 'تورم', 'التهاب', 'عدوي', 'سعال', 'كحه', 'تنفس', 'الم الصدر', 'اعراض جانبيه', 'تشوش', 'طفح', 'الم'] },
  { id: 'rule-falls', name: 'Falls & safety', category: 'daily_care', role: 'caregiver', enabled: true, priorityFloor: 'high', keywords: ['fall', 'fell', 'fallen', 'slipped', 'tripped', 'injury', 'bruise', 'unsafe', 'wandering', 'سقط', 'سقطت', 'سقوط', 'وقع', 'وقعت', 'انزلق', 'انزلقت', 'تعثر', 'تعثرت', 'اصابه', 'كدمه', 'غير امن', 'تجول'] },
  { id: 'rule-transport', name: 'Transport', category: 'transport', role: 'transport', enabled: true, priorityFloor: null, keywords: ['ride to', 'ride from', 'ride', 'transport', 'pickup', 'pick up', 'pick-up', 'taxi', 'van', 'driver', 'drop off', 'dialysis trip', 'no show', 'stranded', 'رحله الي', 'رحله', 'توصيله', 'مواصلات', 'نقل', 'سائق', 'السائق', 'سياره', 'تاكسي', 'رحله غسيل الكلي', 'لم يحضر السائق', 'عالق'] },
  { id: 'rule-daily', name: 'Daily care', category: 'daily_care', role: 'caregiver', enabled: true, priorityFloor: null, keywords: ['bath', 'shower', 'meal', 'eating', 'food', 'hygiene', 'dressing', 'toilet', 'care visit', 'caregiver', 'laundry', 'walking', 'mobility', 'exercise', 'استحمام', 'حمام', 'وجبه', 'وجبات', 'طعام', 'اكل', 'نظافه', 'ملابس', 'زياره رعايه', 'مقدم الرعايه', 'مشي', 'حركه', 'تمارين'] },
  { id: 'rule-benefits', name: 'Benefits & documents', category: 'benefits', role: 'social', enabled: true, priorityFloor: null, keywords: ['benefit', 'thiqa', 'insurance', 'emirates id', 'document', 'application', 'allowance', 'pension', 'paperwork', 'renewal', 'expired', 'expiring', 'card', 'ثقه', 'تامين', 'الهويه', 'هويه', 'وثيقه', 'وثائق', 'مستند', 'طلب', 'معاش', 'بدل', 'اوراق', 'تجديد', 'منتهي', 'انتهت', 'تنتهي', 'بطاقه'] },
  { id: 'rule-equipment', name: 'Equipment & home', category: 'equipment', role: 'social', enabled: true, priorityFloor: null, keywords: ['wheelchair repair', 'broken wheelchair', 'walker', 'hospital bed', 'grab bar', 'ramp', 'hearing aid', 'oxygen', 'commode', 'equipment', 'broken', 'air conditioning', 'ac not working', 'كرسي متحرك معطل', 'اصلاح الكرسي', 'مشايه', 'سرير طبي', 'مقبض', 'منحدر', 'سماعه', 'اكسجين', 'معدات', 'معطل', 'معطله', 'مكسور', 'خربان', 'مكيف', 'التكييف'] },
  { id: 'rule-wellbeing', name: 'Wellbeing', category: 'wellbeing', role: 'social', enabled: true, priorityFloor: null, keywords: ['lonely', 'loneliness', 'isolated', 'sad', 'low mood', 'anxious', 'bored', 'companionship', 'visit', 'mood', 'not sleeping', 'وحده', 'وحيد', 'وحيده', 'عزله', 'حزين', 'حزينه', 'حزن', 'احباط', 'مزاج', 'قلق', 'ملل', 'زياره', 'لا ينام', 'لا تنام', 'مؤانسه'] },
  { id: 'rule-learning', name: 'School & learning', category: 'learning', role: 'educator', enabled: true, priorityFloor: null, keywords: ['school', 'teacher', 'homework', 'class', 'lesson', 'exam', 'iep', 'learning support', 'مدرسه', 'المدرسه', 'معلم', 'المعلم', 'معلمه', 'واجب', 'الواجب', 'الصف', 'حصه', 'امتحان'] },
  { id: 'rule-rehab', name: 'Physio & rehab', category: 'rehab', role: 'physio', enabled: true, priorityFloor: null, keywords: ['physiotherapy', 'physio session', 'physio exercises', 'rehab', 'rehabilitation', 'home exercises', 'exercise plan', 'walking frame', 'علاج طبيعي', 'العلاج الطبيعي', 'جلسه العلاج الطبيعي', 'تمارين التاهيل', 'تاهيل', 'اطار المشي'] },
  { id: 'rule-therapy', name: 'Therapy & emotional support', category: 'wellbeing', role: 'psychologist', enabled: true, priorityFloor: null, keywords: ['therapy', 'therapist', 'psychologist', 'counselling', 'counseling', 'panic', 'meltdown', 'coping', 'نوبه هلع', 'اخصائي نفسي', 'علاج نفسي', 'جلسه نفسيه', 'انهيار'] },
  { id: 'rule-scheduling', name: 'Appointments', category: 'scheduling', role: 'doctor', enabled: true, priorityFloor: null, keywords: ['appointment', 'reschedule', 'booking', 'follow-up', 'follow up', 'clinic', 'consultation', 'check-up', 'checkup', 'referral', 'موعد', 'تاجيل', 'اعاده جدوله', 'حجز', 'متابعه', 'عياده', 'استشاره', 'فحص', 'تحويل'] },
];

const playbookDefs: Omit<Playbook, 'updatedAt'>[] = [
  { id: 'pb-refill', title: 'Same-day refill with home delivery', category: 'medication', summary: 'Get a running-low or missed refill to the home today.', steps: ['Confirm the medicine, dose and remaining supply with the family', 'Check the prescription is valid (renew with the doctor if expired)', 'Prepare and label the refill', 'Book same-day delivery and share the ETA', 'Confirm receipt with the caregiver'], minutes: 90, effort: 1, uses: 14, successes: 13, authorId: 'u-omar', tags: ['refill', 'ran out', 'running low', 'pharmacy', 'delivery', 'insulin', 'strips'] },
  { id: 'pb-missed-dose', title: 'Missed dose — safe recovery', category: 'medication', summary: 'What to do when a scheduled dose was skipped.', steps: ['Check the time since the missed dose and the medicine type', 'Call the pharmacist or doctor for guidance before giving a late dose', 'Record the dose in the medication log', 'Set up a pill organiser and phone reminders', 'Tell the family what changed'], minutes: 30, effort: 1, uses: 9, successes: 8, authorId: 'u-aisha', tags: ['missed', 'dose', 'forgot', 'medication', 'tablets', 'reminder'] },
  { id: 'pb-fall', title: 'After a fall: first 24 hours', category: 'daily_care', summary: 'Safe response and follow-up after a fall at home.', steps: ['Check for injury; call 998 if head injury, severe pain or cannot get up', 'Help up safely only if uninjured; record time and place', 'Notify the doctor for a same-day review', 'Check the area for hazards (rugs, lighting, wet floors)', 'Increase check-ins for 24 hours'], minutes: 60, effort: 2, uses: 6, successes: 6, authorId: 'u-aisha', tags: ['fall', 'fell', 'slipped', 'injury', 'safety', 'bruise'] },
  { id: 'pb-ride-noshow', title: 'Missed or late ride recovery', category: 'transport', summary: 'Get someone to their appointment when a ride fails.', steps: ['Call the driver and confirm their location', 'If more than 15 min late, dispatch the nearest backup vehicle', 'Call the clinic to hold or move the slot', 'Confirm pickup with the family', 'Log the no-show against the driver'], minutes: 25, effort: 1, uses: 11, successes: 10, authorId: 'u-yousef', tags: ['ride', 'late', 'no show', 'driver', 'pickup', 'appointment', 'transport'] },
  { id: 'pb-recurring-ride', title: 'Set up recurring dialysis transport', category: 'transport', summary: 'Book a fixed weekly ride schedule with a wheelchair van.', steps: ['Confirm the dialysis days and session times', 'Assign a wheelchair-accessible van and a regular driver', 'Share the schedule with the family and the clinic', 'Add reminders the evening before each ride'], minutes: 45, effort: 2, uses: 4, successes: 4, authorId: 'u-yousef', tags: ['dialysis', 'recurring', 'wheelchair', 'van', 'schedule', 'transport'] },
  { id: 'pb-glucose', title: 'High or unstable blood sugar review', category: 'clinical', summary: 'Triage readings and adjust the plan the same day.', steps: ['Collect the last 3 days of glucose readings', 'Ask about meals, missed doses and symptoms', 'Video or phone review with the doctor', 'Update the dose or diet plan in writing', 'Re-check readings in 48 hours'], minutes: 40, effort: 2, uses: 7, successes: 6, authorId: 'u-kareem', tags: ['glucose', 'sugar', 'diabetes', 'insulin', 'readings', 'dizzy'] },
  { id: 'pb-bp', title: 'Blood pressure out of range', category: 'clinical', summary: 'Confirm, triage and adjust when readings are high or low.', steps: ['Re-measure after 5 minutes of rest, both arms', 'Check for red-flag symptoms (chest pain, confusion, weakness) — call 998 if present', 'Share readings with the doctor', 'Adjust medication if advised and recheck in 24 hours'], minutes: 30, effort: 1, uses: 5, successes: 5, authorId: 'u-kareem', tags: ['blood pressure', 'bp', 'dizzy', 'headache', 'readings'] },
  { id: 'pb-thiqa', title: 'Renew Thiqa or health insurance card', category: 'benefits', summary: 'Renew before expiry so care is not interrupted.', steps: ['Check the expiry date and Emirates ID validity', 'Collect passport, Emirates ID and family book copies', 'Submit the renewal online and save the reference', 'Share the new card with the clinic and pharmacy'], minutes: 60, effort: 2, uses: 5, successes: 4, authorId: 'u-noura', tags: ['thiqa', 'insurance', 'renewal', 'card', 'expired', 'emirates id', 'documents'] },
  { id: 'pb-equipment', title: 'Repair or replace mobility equipment', category: 'equipment', summary: 'Get a wheelchair, walker or bed working again quickly.', steps: ['Photograph the fault and note the model', 'Request a loan unit for the meantime', 'Book the repair or apply for funded replacement', 'Confirm delivery and safe fit with the caregiver'], minutes: 120, effort: 2, uses: 3, successes: 3, authorId: 'u-noura', tags: ['wheelchair', 'walker', 'broken', 'repair', 'equipment', 'bed'] },
  { id: 'pb-loneliness', title: 'Companionship & social connection plan', category: 'wellbeing', summary: 'Reduce isolation with regular, real contact.', steps: ['Have a short conversation about what they enjoy', 'Arrange a weekly volunteer or majlis visit', 'Schedule family video calls', 'Check mood again in two weeks'], minutes: 45, effort: 1, uses: 4, successes: 3, authorId: 'u-noura', tags: ['lonely', 'loneliness', 'sad', 'isolated', 'visit', 'mood'] },
  { id: 'pb-reschedule', title: 'Reschedule an appointment without losing the slot', category: 'scheduling', summary: 'Move a clinic visit and keep transport in sync.', steps: ['Find the next two available slots', 'Confirm the best one with the family', 'Update the transport booking', 'Send reminders the day before'], minutes: 20, effort: 1, uses: 8, successes: 8, authorId: 'u-sara', tags: ['appointment', 'reschedule', 'clinic', 'booking', 'follow-up'] },
  { id: 'pb-caregiver-gap', title: 'Cover a missed care visit', category: 'daily_care', summary: 'Find cover when a scheduled carer cannot make it.', steps: ['Confirm what was missed (meals, hygiene, medication)', 'Find an available carer nearby', 'Brief them on the care plan', 'Check in with the family after the visit'], minutes: 50, effort: 2, uses: 5, successes: 4, authorId: 'u-sara', tags: ['care visit', 'missed', 'caregiver', 'cover', 'meal', 'bath'] },
];

interface Step {
  at: number; // hours ago
  by: string;
  action: Action | ((ids: Record<string, string>, state: State) => Action);
  label?: string;
}

const script: Step[] = [
  // Resolved & closed history (feeds analytics and "similar fixes").
  { at: 300, by: 'u-mariam', label: 'old1', action: { type: 'create_challenge', title: 'Insulin pens running low', description: 'Only two pens left for Mum, need a refill before the weekend.', recipientId: 'r-fatima', priority: 'auto' } },
  { at: 299, by: 'u-omar', action: (i) => ({ type: 'apply_playbook', id: i.old1, playbookId: 'pb-refill' }) },
  { at: 297.5, by: 'u-omar', action: (i) => ({ type: 'resolve', id: i.old1, resolution: 'Refilled 5 pens, delivered to the home at 4pm. Prescription valid until March.' }) },
  { at: 296, by: 'u-mariam', action: (i) => ({ type: 'verify', id: i.old1, rating: 5 }) },

  { at: 250, by: 'u-khalid', label: 'old2', action: { type: 'create_challenge', title: 'Driver did not show for dialysis pickup', description: 'Dad was waiting outside for 30 minutes, no ride came. Session starts at 9.', recipientId: 'r-hamad', priority: 'auto' } },
  { at: 249.8, by: 'u-yousef', action: (i) => ({ type: 'apply_playbook', id: i.old2, playbookId: 'pb-ride-noshow' }) },
  { at: 249.3, by: 'u-yousef', action: (i) => ({ type: 'resolve', id: i.old2, resolution: 'Backup van dispatched, arrived 9:20; clinic held the slot. Driver logged.' }) },
  { at: 248, by: 'u-khalid', action: (i) => ({ type: 'verify', id: i.old2, rating: 4 }) },

  { at: 200, by: 'u-aisha', label: 'old3', action: { type: 'create_challenge', title: 'Thiqa card expired', description: 'Pharmacy rejected the card for Khadija, insurance renewal needed.', recipientId: 'r-khadija', priority: 'medium' } },
  { at: 190, by: 'u-noura', action: (i) => ({ type: 'apply_playbook', id: i.old3, playbookId: 'pb-thiqa' }) },
  { at: 170, by: 'u-noura', action: (i) => ({ type: 'resolve', id: i.old3, resolution: 'Renewal approved, new card shared with Qusais Clinic and pharmacy.' }) },
  { at: 160, by: 'u-sara', action: (i) => ({ type: 'verify', id: i.old3, rating: 5 }) },

  { at: 150, by: 'u-mariam', label: 'old4', action: { type: 'create_challenge', title: 'Mum seems lonely in the afternoons', description: 'She is sad and bored while I am at work. Can someone visit?', recipientId: 'r-fatima', priority: 'low' } },
  { at: 140, by: 'u-noura', action: (i) => ({ type: 'apply_playbook', id: i.old4, playbookId: 'pb-loneliness' }) },
  { at: 100, by: 'u-noura', action: (i) => ({ type: 'resolve', id: i.old4, resolution: 'Weekly majlis visit on Tuesdays and Thursdays with a volunteer from the community centre.' }) },
  { at: 98, by: 'u-mariam', action: (i) => ({ type: 'verify', id: i.old4, rating: 5 }) },

  { at: 120, by: 'u-joseph', label: 'old5', action: { type: 'create_challenge', title: 'Hamad slipped in the bathroom', description: 'Slipped getting out of the shower, small bruise on the arm, no other injury.', recipientId: 'r-hamad', priority: 'auto' } },
  { at: 119.5, by: 'u-joseph', action: (i) => ({ type: 'accept', id: i.old5 }) },
  { at: 119.4, by: 'u-joseph', action: (i) => ({ type: 'apply_playbook', id: i.old5, playbookId: 'pb-fall' }) },
  { at: 117, by: 'u-joseph', action: (i) => ({ type: 'resolve', id: i.old5, resolution: 'Doctor reviewed by phone, no fracture. Non-slip mat and grab bar requested.' }) },
  { at: 112, by: 'u-khalid', action: (i) => ({ type: 'verify', id: i.old5, rating: 4 }) },

  { at: 80, by: 'u-mariam', label: 'old6', action: { type: 'create_challenge', title: 'Reschedule the eye clinic appointment', description: 'The follow-up clashes with a family event, can we move it to next week?', recipientId: 'r-fatima', priority: 'low' } },
  { at: 76, by: 'u-kareem', action: (i) => ({ type: 'apply_playbook', id: i.old6, playbookId: 'pb-reschedule' }) },
  { at: 75, by: 'u-kareem', action: (i) => ({ type: 'resolve', id: i.old6, resolution: 'Moved to next Wednesday 10:30, transport booking updated.' }) },

  { at: 60, by: 'u-aisha', label: 'old7', action: { type: 'create_challenge', title: 'Khadija knee swelling after physio', description: 'Swelling and some pain around the right knee since yesterday.', recipientId: 'r-khadija', priority: 'auto' } },
  { at: 59, by: 'u-layla', action: (i) => ({ type: 'start', id: i.old7 }) },
  { at: 55, by: 'u-layla', action: (i) => ({ type: 'resolve', id: i.old7, resolution: 'Normal post-physio swelling. Ice, elevation and lighter exercises for 3 days.' }) },
  { at: 50, by: 'u-aisha', action: (i) => ({ type: 'verify', id: i.old7, rating: 5 }) },

  // Live work in every stage.
  { at: 30, by: 'u-mariam', label: 'thiqa', action: { type: 'create_challenge', title: 'Fatima’s Thiqa card expires next week', description: 'Renewal paperwork needed before her next pharmacy visit.', recipientId: 'r-fatima', priority: 'medium' } },
  { at: 29, by: 'u-noura', action: (i) => ({ type: 'apply_playbook', id: i.thiqa, playbookId: 'pb-thiqa' }) },
  { at: 28.5, by: 'u-noura', action: (i) => ({ type: 'toggle_check', id: i.thiqa, itemId: '__first' }) },
  { at: 28, by: 'u-noura', action: (i) => ({ type: 'comment', id: i.thiqa, text: 'Mariam, could you upload a copy of the family book? Everything else is ready.' }) },

  { at: 20, by: 'u-khalid', label: 'dialysis', action: { type: 'create_challenge', title: 'Need a regular ride to dialysis', description: 'Dad has dialysis Sunday, Tuesday and Thursday at 9am. He uses a wheelchair.', recipientId: 'r-hamad', priority: 'medium' } },
  { at: 19, by: 'u-yousef', action: (i) => ({ type: 'accept', id: i.dialysis }) },

  { at: 26, by: 'u-joseph', label: 'wheelchair', action: { type: 'create_challenge', title: 'Wheelchair brake is broken', description: 'The left brake does not lock, unsafe for transfers.', recipientId: 'r-hamad', priority: 'high' } },

  { at: 6, by: 'u-aisha', label: 'glucose', action: { type: 'create_challenge', title: 'Fatima’s glucose readings are high', description: 'Sugar level was 14 and 15 mmol/L this morning and yesterday evening. She feels a bit dizzy.', recipientId: 'r-fatima', priority: 'auto' } },
  { at: 5, by: 'u-kareem', action: (i) => ({ type: 'apply_playbook', id: i.glucose, playbookId: 'pb-glucose' }) },
  { at: 4.8, by: 'u-kareem', action: (i) => ({ type: 'toggle_check', id: i.glucose, itemId: '__first' }) },
  { at: 4.5, by: 'u-kareem', action: (i) => ({ type: 'comment', id: i.glucose, text: 'Thanks Aisha. Please send me tonight’s reading before dinner, I’ll call at 7pm.' }) },

  { at: 3, by: 'u-mariam', label: 'missed', action: { type: 'create_challenge', title: 'Mum missed her morning tablets', description: 'She forgot to take the morning dose, I only noticed at lunch.', recipientId: 'r-fatima', priority: 'auto' } },

  { at: 2, by: 'u-aisha', label: 'strips', action: { type: 'create_challenge', title: 'Glucose test strips ran out', description: 'Only 3 strips left for Fatima, need a refill today.', recipientId: 'r-fatima', priority: 'auto' } },

  { at: 1.2, by: 'u-khalid', label: 'ac', action: { type: 'create_challenge', title: 'Something is wrong with the majlis', description: 'Dad says the room is too hot to sit in during the day.', recipientId: 'r-hamad', priority: 'medium' } },

  { at: 0.5, by: 'u-aisha', label: 'khadija', action: { type: 'create_challenge', title: 'Khadija feels low and isolated', description: 'She has been sad since surgery and does not want to go out. Lives alone.', recipientId: 'r-khadija', priority: 'auto' } },

  { at: 0.2, by: 'u-mariam', label: 'ride', action: { type: 'create_challenge', title: 'Ride to Thursday eye appointment', description: 'Pickup from Al Barsha at 9:30 for the 10:30 clinic visit.', recipientId: 'r-fatima', priority: 'medium' } },
];

/** The most recent `count` occurrences of a daily time that are at least an hour in the past. */
function pastSlots(now: number, time: string, count: number): { slot: string; hoursAgo: number }[] {
  const out: { slot: string; hoursAgo: number }[] = [];
  for (let d = 0; out.length < count && d < 10; d++) {
    const day = dayKey(now - d * 24 * H);
    const [y, mo, dd] = day.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    const at = new Date(y, mo - 1, dd, h, mi).getTime();
    if (at <= now - H) out.push({ slot: `${day} ${time}`, hoursAgo: (now - at) / H });
  }
  return out;
}

const rec = (at: number, by: string, recipientId: string, domain: Domain, kind: string, title: string, body = '', value?: number, unit?: string): Step => ({
  at,
  by,
  action: { type: 'add_record', recipientId, domain, kind, title, body, value: value ?? null, unit, observedAt: undefined },
});

/** Profile records, medicines and dose logs, written through the engine by the people who would write them. */
function careScript(now: number): Step[] {
  const steps: Step[] = [
    // Fatima — medical
    rec(400, 'u-kareem', 'r-fatima', 'medical', 'condition', 'Type 2 diabetes', 'Diagnosed in 2015. Managed with metformin and evening insulin.'),
    rec(390, 'u-mariam', 'r-fatima', 'medical', 'allergy', 'Penicillin', 'Rash and itching (reported by family).'),
    rec(380, 'u-mariam', 'r-fatima', 'medical', 'provider', 'Dr. Kareem Hassan — Al Barsha Health Centre', 'Geriatrician. Clinic phone number is on the appointment card.'),
    rec(72, 'u-aisha', 'r-fatima', 'medical', 'measurement', 'Blood glucose (fasting)', '', 7.9, 'mmol/L'),
    rec(48, 'u-aisha', 'r-fatima', 'medical', 'measurement', 'Blood glucose (fasting)', '', 8.4, 'mmol/L'),
    rec(20, 'u-aisha', 'r-fatima', 'medical', 'measurement', 'Blood glucose (evening)', '', 14, 'mmol/L'),
    rec(7, 'u-aisha', 'r-fatima', 'medical', 'measurement', 'Blood glucose (fasting)', '', 15.1, 'mmol/L'),
    rec(6.2, 'u-aisha', 'r-fatima', 'medical', 'observation', 'Felt dizzy after lunch', 'Sat down for 20 minutes, then felt better.'),
    rec(30, 'u-mariam', 'r-fatima', 'wellbeing', 'checkin', 'Quiet but content', 'Enjoyed the majlis visit.', 3),
    { at: 200, by: 'u-kareem', label: 'met', action: { type: 'add_medication', recipientId: 'r-fatima', med: { name: 'Metformin', strength: '500 mg', dose: '1 tablet', route: 'By mouth', times: ['08:00', '20:00'], prescriber: 'Dr. Kareem Hassan', instructions: 'Take with food.', reminders: true, onHand: 30, perDose: 1, active: true } } },
    { at: 199, by: 'u-kareem', label: 'ins', action: { type: 'add_medication', recipientId: 'r-fatima', med: { name: 'Insulin glargine', strength: '100 units/mL pen', dose: '10 units', route: 'Injection under the skin', times: ['21:00'], prescriber: 'Dr. Kareem Hassan', instructions: 'Same time every evening. Rotate injection sites.', reminders: true, onHand: 600, perDose: 10, active: true } } },
    // Hamad
    rec(500, 'u-kareem', 'r-hamad', 'medical', 'condition', 'Chronic kidney disease (dialysis)', 'Haemodialysis on Sunday, Tuesday and Thursday at 9:00.'),
    rec(50, 'u-joseph', 'r-hamad', 'medical', 'measurement', 'Weight before dialysis', '', 72.4, 'kg'),
    rec(26, 'u-joseph', 'r-hamad', 'medical', 'measurement', 'Weight before dialysis', '', 73.1, 'kg'),
    rec(300, 'u-khalid', 'r-hamad', 'activity', 'preference', 'Short walks in the garden with support'),
    rec(24, 'u-khalid', 'r-hamad', 'wellbeing', 'checkin', 'Good spirits', 'Talked about his grandchildren all afternoon.', 4),
    { at: 450, by: 'u-kareem', action: { type: 'add_medication', recipientId: 'r-hamad', med: { name: 'Calcium acetate', strength: '667 mg', dose: '1 capsule', route: 'By mouth', times: ['08:00', '13:00', '19:00'], prescriber: 'Dr. Kareem Hassan', instructions: 'With meals.', reminders: true, onHand: 200, perDose: 1, active: true } } },
    // Khadija
    rec(600, 'u-layla', 'r-khadija', 'medical', 'history', 'Right knee replacement', 'Operated at Qusais Clinic in September 2026.'),
    rec(598, 'u-layla', 'r-khadija', 'medical', 'allergy', 'No known allergies', 'Confirmed at the pre-surgery check.'),
    rec(300, 'u-faisal', 'r-khadija', 'rehab', 'rehab_plan', 'Knee rehabilitation — weeks 4 to 8', 'Goal: walk 500 m without a stick and climb stairs with one rail. Review every 2 weeks.'),
    rec(299.9, 'u-faisal', 'r-khadija', 'rehab', 'exercise', 'Straight-leg raises', '3 sets of 10, twice a day. Stop if there is sharp pain.'),
    rec(299.8, 'u-faisal', 'r-khadija', 'rehab', 'exercise', 'Heel slides', '3 sets of 10, twice a day.'),
    rec(299.7, 'u-faisal', 'r-khadija', 'rehab', 'restriction', 'No kneeling or deep squats', 'Until the 12-week review.'),
    rec(120, 'u-khadija', 'r-khadija', 'rehab', 'pain', 'Pain after exercises', '', 5),
    rec(72, 'u-khadija', 'r-khadija', 'rehab', 'pain', 'Pain after exercises', '', 4),
    rec(48, 'u-faisal', 'r-khadija', 'rehab', 'milestone', 'Walked to the corner shop with a stick'),
    rec(30, 'u-khadija', 'r-khadija', 'rehab', 'completion', 'Straight-leg raises and heel slides', 'Morning set done.'),
    rec(29, 'u-khadija', 'r-khadija', 'rehab', 'pain', 'Pain after exercises', '', 4),
    rec(6, 'u-khadija', 'r-khadija', 'rehab', 'pain', 'Pain after exercises', '', 3),
    rec(3, 'u-khadija', 'r-khadija', 'wellbeing', 'checkin', 'Feeling low', 'I don’t feel like going out since the operation.', 2),
    rec(2.8, 'u-khadija', 'r-khadija', 'wellbeing', 'support', 'What helps me', 'A phone call from my sister in the evening. I don’t like surprise visits.'),
    { at: 160, by: 'u-layla', action: { type: 'add_medication', recipientId: 'r-khadija', med: { name: 'Paracetamol', strength: '500 mg', dose: '2 tablets', route: 'By mouth', times: ['08:00', '20:00'], prescriber: 'Dr. Layla Haddad', instructions: 'For knee pain. No more than 8 tablets in 24 hours.', reminders: true, onHand: 40, perDose: 2, active: true } } },
    // Rashid
    rec(700, 'u-layla', 'r-rashid', 'medical', 'condition', 'Mild spastic diplegia (cerebral palsy)', 'Uses a walking frame for longer distances.'),
    rec(690, 'u-huda', 'r-rashid', 'medical', 'allergy', 'No known allergies'),
    rec(650, 'u-grace', 'r-rashid', 'academic', 'school', 'Al Mizhar Primary School — Grade 5'),
    rec(640, 'u-grace', 'r-rashid', 'academic', 'iep', 'Individual education plan 2026–27', 'Extra time in tests, speech-to-text for long writing, a seat near the door.'),
    rec(639, 'u-grace', 'r-rashid', 'academic', 'accommodation', 'Lift pass and early release between lessons'),
    rec(630, 'u-grace', 'r-rashid', 'academic', 'learning_goal', 'Write a one-page report using speech-to-text'),
    rec(600, 'u-grace', 'r-rashid', 'academic', 'attendance', 'Attendance, first half-term', '', 91),
    rec(200, 'u-grace', 'r-rashid', 'academic', 'assessment', 'Reading — meeting the grade level'),
    rec(100, 'u-grace', 'r-rashid', 'academic', 'attendance', 'Attendance, second half-term', '', 94),
    rec(50, 'u-grace', 'r-rashid', 'academic', 'teacher_note', 'Led his group in the robotics lesson'),
    rec(620, 'u-huda', 'r-rashid', 'social', 'social_goal', 'Join the robotics club at lunchtime', 'His own choice. Two lunchtimes a week is enough for him.'),
    rec(26, 'u-grace', 'r-rashid', 'social', 'participation', 'Robotics club'),
    rec(10, 'u-huda', 'r-rashid', 'social', 'achievement', 'Presented his robot at the school fair'),
    rec(80, 'u-huda', 'r-rashid', 'wellbeing', 'behaviour', 'Upset when the timetable changed without warning', 'Calmed down with his visual schedule.'),
    rec(9, 'u-huda', 'r-rashid', 'wellbeing', 'checkin', 'Happy after the fair', '', 4),
    rec(500, 'u-salma', 'r-rashid', 'wellbeing', 'session', 'Sessions: Mondays at 16:00, Mind Well Clinic'),
    rec(499, 'u-salma', 'r-rashid', 'wellbeing', 'goal', 'Use coping cards when plans change'),
    rec(60, 'u-salma', 'r-rashid', 'wellbeing_notes', 'progress_note', 'Session 6', 'Practised the coping cards for transitions. He says he used them twice at school this week. Continue weekly.'),
    rec(400, 'u-faisal', 'r-rashid', 'rehab', 'rehab_plan', 'Lower-limb strengthening', 'Twice-weekly sessions and a 15-minute home programme each day.'),
    rec(399, 'u-faisal', 'r-rashid', 'rehab', 'exercise', 'Sit-to-stand', '2 sets of 8 from a chair, slow and controlled.'),
    rec(380, 'u-huda', 'r-rashid', 'activity', 'preference', 'Swimming and wheelchair basketball'),
    rec(30, 'u-huda', 'r-rashid', 'activity', 'activity_log', 'Swimming', '', 45),
    // A request waiting for Mariam's decision (approval centre demo).
    { at: 2, by: 'u-sara', action: { type: 'invite_member', recipientId: 'r-fatima', email: 'nadia@rahma.ae', role: 'caregiver', relationship: 'Weekend relief carer', domains: ['overview', 'medical'], accessDays: 30 } },
  ];
  // Dose logs for Fatima's metformin: earlier doses taken, the latest one missed (matches the reported problem).
  const slots = [...pastSlots(now, '08:00', 2), ...pastSlots(now, '20:00', 2)].sort((a, b) => b.hoursAgo - a.hoursAgo);
  slots.forEach((x, i) => {
    const last = i === slots.length - 1;
    steps.push({ at: Math.max(0.05, x.hoursAgo - 0.5), by: last ? 'u-mariam' : 'u-aisha', action: (ids) => ({ type: 'log_dose', medicationId: ids.met, slot: x.slot, status: last ? 'missed' : 'taken', note: last ? 'Noticed at lunchtime.' : '' }) });
  });
  return steps;
}

/** A tiny, valid one-page PDF with a few lines of text (synthetic sample documents). */
export function samplePdf(lines: string[]): string {
  const esc = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = lines.map((l, i) => `BT /F1 ${i === 0 ? 16 : 11} Tf 56 ${770 - i * 22} Td (${esc(l)}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const b64 = typeof btoa === 'function' ? btoa(body) : Buffer.from(body, 'binary').toString('base64');
  return `data:application/pdf;base64,${b64}`;
}

/** Hours ago (for seed steps) of a local clock time `days` from now. */
function clock(now: number, days: number, hh: number, mm = 0): number {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}
/** The next date (from tomorrow) that falls on one of the given weekdays (0 = Sunday). */
function nextWeekday(now: number, days: number[], hh: number, mm = 0, skip = 0): number {
  let found = 0;
  for (let i = 1; i < 30; i++) {
    const t = clock(now, i, hh, mm);
    if (!days.includes(new Date(t).getDay())) continue;
    if (found === skip) return t;
    found += 1;
  }
  return clock(now, 7, hh, mm);
}
const future = (now: number, hh: number, mm = 0) => {
  const t = clock(now, 0, hh, mm);
  return t > now + 3_600_000 ? t : clock(now, 1, hh, mm);
};

/** Care plans, tasks, appointments, cover, a handover and sample documents — written through the engine. */
function planScript(now: number): Step[] {
  const task = (title: string, domain: Domain, ownerId: string | null, dueAt: number | null, extra: Partial<TaskInput> = {}): TaskInput => ({ title, notes: '', domain, ownerId, priority: 'medium', dueAt, recurrence: 'none', dependsOn: [], needsApproval: false, evidenceRequired: false, planId: null, ...extra });
  const appt = (title: string, kind: AppointmentInput['kind'], domain: Domain, startAt: number, minutes: number, withWhom: string, location: string, attendeeIds: string[]): AppointmentInput => ({ title, kind, domain, startAt, endAt: startAt + minutes * 60_000, location, withWhom, attendeeIds, notes: '' });
  const thursday = nextWeekday(now, [4], 10, 30);
  const friday = nextWeekday(now, [5], 8, 0);
  const monday = nextWeekday(now, [1], 16, 0);
  const dialysis1 = nextWeekday(now, [0, 2, 4], 9, 0);
  const dialysis2 = nextWeekday(now, [0, 2, 4], 9, 0, 1);
  return [
    // Plans
    { at: 150, by: 'u-kareem', label: 'planSugar', action: { type: 'add_plan', recipientId: 'r-fatima', title: 'Keep blood sugar in range', goal: 'Fasting readings in the range agreed with Dr. Kareem. Review in two weeks.', domain: 'medical' } },
    { at: 300, by: 'u-grace', label: 'planSchool', action: { type: 'add_plan', recipientId: 'r-rashid', title: 'Settle into Grade 5', goal: 'Rashid feels ready for changes in the school day and uses his accommodations.', domain: 'academic' } },
    { at: 299, by: 'u-faisal', label: 'planLegs', action: { type: 'add_plan', recipientId: 'r-rashid', title: 'Stronger legs for longer walks', goal: 'Walk the school corridor without the frame by the end of term (his goal).', domain: 'rehab' } },
    { at: 280, by: 'u-faisal', label: 'planKnee', action: { type: 'add_plan', recipientId: 'r-khadija', title: 'Back to walking without a stick', goal: 'Walk 500 m without a stick by week 8.', domain: 'rehab' } },
    // Tasks
    { at: 100, by: 'u-kareem', action: (i) => ({ type: 'add_task', recipientId: 'r-fatima', task: task('Send the evening glucose reading to Dr. Kareem', 'medical', 'u-aisha', future(now, 19), { priority: 'high', recurrence: 'daily', planId: i.planSugar }) }) },
    { at: 30, by: 'u-mariam', action: (i) => ({ type: 'add_task', recipientId: 'r-fatima', task: task('Collect the Metformin refill', 'medical', 'u-mariam', clock(now, 2, 12), { priority: 'high', evidenceRequired: true, planId: i.planSugar }) }) },
    { at: 90, by: 'u-mariam', label: 'eyeBook', action: { type: 'add_task', recipientId: 'r-fatima', task: task('Book the eye clinic follow-up', 'overview', 'u-mariam', null) } },
    { at: 88, by: 'u-mariam', action: (i) => ({ type: 'task_status', taskId: i.eyeBook, status: 'completed', evidence: 'Booked for Thursday 10:30 at Al Barsha Eye Clinic.' }) },
    { at: 40, by: 'u-khalid', action: { type: 'add_task', recipientId: 'r-hamad', task: task('Book the wheelchair brake repair', 'overview', 'u-sara', now - 30 * H, { priority: 'high' }) } },
    { at: 250, by: 'u-huda', action: (i) => ({ type: 'add_task', recipientId: 'r-rashid', task: task('Share timetable changes a week ahead', 'academic', 'u-grace', nextWeekday(now, [0], 8), { recurrence: 'weekly', planId: i.planSchool }) }) },
    { at: 200, by: 'u-grace', label: 'reading', action: (i) => ({ type: 'add_task', recipientId: 'r-rashid', task: task('Collect the reading assessment results', 'academic', 'u-grace', clock(now, 2, 13), { planId: i.planSchool }) }) },
    { at: 199, by: 'u-grace', action: (i) => ({ type: 'add_task', recipientId: 'r-rashid', task: task('Agree term 2 learning goals with Huda', 'academic', 'u-grace', clock(now, 5, 14), { planId: i.planSchool, dependsOn: [i.reading] }) }) },
    { at: 260, by: 'u-faisal', action: (i) => ({ type: 'add_task', recipientId: 'r-rashid', task: task('Sit-to-stand practice at home (15 minutes)', 'rehab', 'u-huda', future(now, 18), { recurrence: 'daily', planId: i.planLegs }) }) },
    { at: 20, by: 'u-faisal', action: { type: 'add_task', recipientId: 'r-rashid', task: task('Short swim twice a week', 'activity', 'u-huda', clock(now, 3, 17), { needsApproval: true, notes: 'Swimming helps with leg strength. Huda to confirm it fits his week.' }) } },
    { at: 270, by: 'u-faisal', action: (i) => ({ type: 'add_task', recipientId: 'r-khadija', task: task('Evening exercise set', 'rehab', 'u-khadija', future(now, 20), { recurrence: 'daily', planId: i.planKnee }) }) },
    // A daily task that keeps being done late (SANAD proposes a better time; a person decides).
    { at: (now - clock(now, -6, 9)) / H, by: 'u-faisal', label: 'stretch', action: (i) => ({ type: 'add_task', recipientId: 'r-khadija', task: task('Morning knee stretches', 'rehab', 'u-khadija', clock(now, -5, 8), { recurrence: 'daily', planId: i.planKnee }) }) },
    ...[
      [-5, 11, 30],
      [-4, 11, 15],
      [-3, 11, 45],
    ].map(([d, hh, mm]) => ({ at: (now - clock(now, d, hh, mm)) / H, by: 'u-khadija', action: (i: Record<string, string>, st: State): Action => ({ type: 'task_status', taskId: st.tasks.find((t) => t.seriesId === i.stretch && t.status === 'scheduled')!.id, status: 'completed' }) })),
    { at: 80, by: 'u-mariam', action: { type: 'add_appointment', recipientId: 'r-fatima', appt: appt('Foot care check', 'other', 'overview', clock(now, -2, 10), 30, 'Community nurse', 'Home visit', ['u-mariam']), prep: [] } },
    // Standing permissions: the person (or guardian) lets SANAD create a follow-up task when an appointment ends without a recorded outcome.
    { at: 200, by: 'u-khadija', action: { type: 'grant_standing', recipientId: 'r-khadija', kind: 'outcome_task', ownerId: null, days: 90 } },
    { at: 150, by: 'u-mariam', action: { type: 'grant_standing', recipientId: 'r-fatima', kind: 'outcome_task', ownerId: null, days: 90 } },
    // Cover and handover
    { at: 10, by: 'u-aisha', action: { type: 'request_cover', recipientId: 'r-fatima', from: friday, to: friday + 6 * H, reason: 'Annual leave — morning visit and lunch need cover.', domain: 'overview' } },
    { at: 2, by: 'u-joseph', action: { type: 'create_handover', recipientId: 'r-hamad', toUserId: 'u-khalid', note: 'Brake still not fixed — use the transfer board. He ate well today.', hours: 24 } },
    // Appointments
    { at: 87, by: 'u-mariam', action: { type: 'add_appointment', recipientId: 'r-fatima', appt: appt('Eye clinic follow-up', 'medical', 'medical', thursday, 60, 'Al Barsha Eye Clinic', 'Al Barsha, Dubai', ['u-mariam']), prep: ['Bring her glasses and the eye-drop bottle', 'Write down questions about blurred vision', 'Bring the insurance card and Emirates ID'] } },
    { at: 5, by: 'u-kareem', action: { type: 'add_appointment', recipientId: 'r-fatima', appt: appt('Diabetes review call', 'medical', 'medical', clock(now, 1, 19), 30, 'Dr. Kareem Hassan', 'Phone call', ['u-kareem', 'u-mariam']), prep: [] } },
    { at: 60, by: 'u-khalid', action: { type: 'add_appointment', recipientId: 'r-hamad', appt: appt('Dialysis session', 'medical', 'medical', dialysis1, 240, 'Mirdif Dialysis Centre', 'Mirdif, Dubai', ['u-joseph']), prep: [] } },
    { at: 59, by: 'u-khalid', action: { type: 'add_appointment', recipientId: 'r-hamad', appt: appt('Dialysis session', 'medical', 'medical', dialysis2, 240, 'Mirdif Dialysis Centre', 'Mirdif, Dubai', ['u-joseph']), prep: [] } },
    { at: 120, by: 'u-khalid', label: 'hearing', action: { type: 'add_appointment', recipientId: 'r-hamad', appt: appt('Hearing test', 'medical', 'medical', clock(now, -2, 11), 45, 'Mirdif Audiology', 'Mirdif, Dubai', ['u-khalid']), prep: [] } },
    { at: 30, by: 'u-khalid', action: (i) => ({ type: 'appointment_status', appointmentId: i.hearing, status: 'missed' }) },
    { at: 200, by: 'u-salma', action: { type: 'add_appointment', recipientId: 'r-rashid', appt: appt('Therapy session', 'therapy', 'wellbeing', monday, 50, 'Dr. Salma Idris', 'Mind Well Clinic', ['u-salma', 'u-huda']), prep: [] } },
    { at: 48, by: 'u-grace', action: { type: 'add_appointment', recipientId: 'r-rashid', appt: appt('Term review meeting', 'school', 'academic', clock(now, 3, 14), 45, 'Grace Thomas', 'Al Mizhar Primary School', ['u-grace', 'u-huda']), prep: ['Review the education plan and recent reports', 'Write down questions for the teacher'] } },
    { at: 47, by: 'u-faisal', action: { type: 'add_appointment', recipientId: 'r-rashid', appt: appt('Physio session', 'physio', 'rehab', clock(now, 2, 17), 45, 'Faisal Nasser', 'Move Well Rehab', ['u-faisal']), prep: [] } },
    { at: 46, by: 'u-faisal', action: { type: 'add_appointment', recipientId: 'r-khadija', appt: appt('Physio review', 'physio', 'rehab', clock(now, 1, 10), 45, 'Faisal Nasser', 'Move Well Rehab', ['u-faisal', 'u-khadija']), prep: ['Log this week’s exercises and any pain'] } },
    { at: 140, by: 'u-layla', label: 'xray', action: { type: 'add_appointment', recipientId: 'r-khadija', appt: appt('Knee X-ray', 'medical', 'medical', clock(now, -3, 9), 30, 'Qusais Clinic', 'Al Qusais, Dubai', ['u-layla']), prep: [] } },
    { at: 66, by: 'u-layla', action: (i) => ({ type: 'appointment_status', appointmentId: i.xray, status: 'completed', outcome: 'Healing as expected.' }) },
    // Sample documents (synthetic)
    { at: 120, by: 'u-kareem', action: { type: 'add_document', recipientId: 'r-fatima', domain: 'medical', title: 'HbA1c lab report (synthetic)', description: 'Sample report for the demo.', fileName: 'hba1c-report.pdf', mime: 'application/pdf', size: 0, dataUrl: samplePdf(['SANAD sample lab report (synthetic)', 'Patient: Fatima Al Noor', 'Test: HbA1c', 'Result: 7.4 %', 'This is demo data, not a real result.']) } },
    { at: 500, by: 'u-grace', action: { type: 'add_document', recipientId: 'r-rashid', domain: 'academic', title: 'IEP summary 2026–27 (synthetic)', description: 'Accommodations agreed with the family.', fileName: 'iep-summary.pdf', mime: 'application/pdf', size: 0, dataUrl: samplePdf(['Individual education plan summary (synthetic)', 'Student: Rashid Al Hammadi, Grade 5', 'Extra time in tests', 'Speech-to-text for long writing', 'Seat near the door; lift pass']) } },
    { at: 290, by: 'u-faisal', action: { type: 'add_document', recipientId: 'r-khadija', domain: 'rehab', title: 'Home exercise sheet (synthetic)', description: 'Exercises for weeks 4 to 8.', fileName: 'exercise-sheet.pdf', mime: 'application/pdf', size: 0, dataUrl: samplePdf(['Home exercise sheet (synthetic)', 'Straight-leg raises: 3 x 10, twice a day', 'Heel slides: 3 x 10, twice a day', 'Stop if there is sharp pain']) } },
    // More progress data
    rec(150, 'u-khadija', 'r-khadija', 'wellbeing', 'checkin', 'How I feel', '', 3),
    rec(80, 'u-khadija', 'r-khadija', 'wellbeing', 'checkin', 'How I feel', '', 3),
    rec(200, 'u-huda', 'r-rashid', 'wellbeing', 'checkin', 'Settled week', '', 3),
    rec(100, 'u-huda', 'r-rashid', 'wellbeing', 'checkin', 'Tired after school', '', 3),
    rec(200, 'u-huda', 'r-rashid', 'activity', 'activity_log', 'Swimming', '', 30),
    rec(120, 'u-huda', 'r-rashid', 'activity', 'activity_log', 'Wheelchair basketball', '', 40),
    rec(170, 'u-aisha', 'r-fatima', 'medical', 'measurement', 'Blood glucose (fasting)', '', 7.4, 'mmol/L'),
    rec(120, 'u-aisha', 'r-fatima', 'medical', 'measurement', 'Blood glucose (fasting)', '', 7.6, 'mmol/L'),
  ];
}

export function createSeed(now = Date.now()): State {
  let state: State = {
    version: 1,
    seq: 100,
    users: JSON.parse(JSON.stringify(users)),
    recipients: [
      { id: 'r-fatima', name: 'Fatima Al Noor', age: 72, area: 'Al Barsha, Dubai', note: 'Lives with her daughter Mariam. Type 2 diabetes, uses a walker.', support: 'assisted', living: 'family', needs: ['chronic', 'mobility'], orgId: 'org-hub', preferredName: 'Umm Mariam', communication: 'Arabic only. Prefers phone calls in the morning; speak slowly and clearly.', languages: ['Arabic'], hidden: ['academic'], accessVersion: 1, updatedAt: now - 300 * H },
      { id: 'r-hamad', name: 'Hamad Al Mansoori', age: 80, area: 'Mirdif, Dubai', note: 'Wheelchair user, dialysis three times a week. Son Khalid visits daily.', support: 'high', living: 'family', needs: ['mobility', 'renal'], orgId: 'org-hub', preferredName: 'Abu Khalid', communication: 'Arabic. Hard of hearing on the left — sit on his right side.', languages: ['Arabic'], hidden: ['academic'], accessVersion: 1, updatedAt: now - 300 * H },
      { id: 'r-khadija', name: 'Khadija Saeed', age: 68, area: 'Al Qusais, Dubai', note: 'Recovering from knee surgery. Lives alone.', support: 'assisted', living: 'alone', needs: ['recovery', 'mobility'], orgId: 'org-hub', preferredName: 'Khadija', communication: 'Arabic or English. Text messages are best; no calls after 9 pm.', languages: ['Arabic', 'English'], hidden: ['academic'], accessVersion: 1, updatedAt: now - 300 * H },
      { id: 'r-rashid', name: 'Rashid Al Hammadi', age: 11, area: 'Mizhar, Dubai', note: 'Person of Determination. Mild cerebral palsy; uses a walking frame for longer distances. Loves robotics.', support: 'assisted', living: 'family', needs: ['mobility'], orgId: 'org-hub', preferredName: 'Rashid', communication: 'Short, clear sentences. Give him time to answer — he may type replies on his tablet.', languages: ['Arabic', 'English'], hidden: [], accessVersion: 1, updatedAt: now - 300 * H },
      { id: 'r-maitha', name: 'Maitha Obaid', age: 77, area: 'Al Khan, Sharjah', note: 'Lives with her son. Uses a hearing aid.', support: 'independent', living: 'family', needs: ['sensory'], orgId: 'org-noor', preferredName: 'Maitha', communication: 'Arabic. Face her when speaking.', languages: ['Arabic'], hidden: ['academic'], accessVersion: 1, updatedAt: now - 300 * H },
    ],
    challenges: [],
    rules: JSON.parse(JSON.stringify(rules)),
    playbooks: playbookDefs.map((p) => ({ ...p, steps: [...p.steps], tags: [...p.tags], updatedAt: now - 400 * H })),
    notifications: [],
    settings: { sla: { urgent: 60, high: 240, medium: 1440, low: 4320 }, autoEscalate: true, balanceLoad: true, preferContinuity: true },
    schema: 4,
    orgs: [
      { id: 'org-hub', name: 'SANAD Care Hub' },
      { id: 'org-noor', name: 'Noor Community Care' },
    ],
    memberships: [],
    invites: [],
    consents: [],
    approvals: [],
    audit: [],
    records: [],
    medications: [],
    doseLogs: [],
    plans: [],
    tasks: [],
    appointments: [],
    documents: [],
    alerts: [],
    standing: [],
    proposals: [],
  };
  state.users.find((u) => u.id === 'u-sara')!.orgId = 'org-hub';
  let seq = 0;
  const since = now - 800 * H;
  for (const t of teams) {
    const u = state.users.find((x) => x.id === t.u)!;
    const domains = t.domains ?? (t.authority ? (['overview', 'medical', 'wellbeing', 'academic', 'social', 'activity', 'rehab', 'team'] as Domain[]) : ROLE_DOMAINS[u.role]);
    seq += 1;
    const m: Membership = { id: `g-${seq}`, recipientId: t.r, userId: t.u, relationship: t.rel, authority: t.authority ?? 'none', authorityVerified: !!t.authority, authorityEvidence: t.evidence, domains, status: 'active', grantedBy: t.by, createdAt: since + seq * 1000 };
    state.memberships.push(m);
    state.consents.push({ id: `k-${seq}`, recipientId: t.r, subjectId: t.u, change: 'grant', domains, basis: t.basis, givenBy: t.by, evidence: t.consentEvidence, at: m.createdAt });
  }
  syncLinks(state, now);
  const ids: Record<string, string> = {};
  for (const step of [...script, ...careScript(now), ...planScript(now)].sort((a, b) => b.at - a.at)) {
    let action = typeof step.action === 'function' ? step.action(ids, state) : step.action;
    if (action.type === 'toggle_check' && action.itemId === '__first') {
      const c = state.challenges.find((x) => x.id === (action as { id: string }).id);
      action = { ...action, itemId: c?.checklist[0]?.id ?? '' };
    }
    let res;
    try {
      res = apply(state, step.by, action, now - step.at * H);
    } catch (e) {
      throw new Error(`Seed step ${step.label ?? action.type} by ${step.by} failed: ${(e as Error).message}`);
    }
    state = res.state;
    if (step.label && res.createdId) ids[step.label] = res.createdId;
  }
  // Seeded playbook usage counts already include history; avoid double counting from replay.
  for (const p of state.playbooks) {
    const def = playbookDefs.find((d) => d.id === p.id);
    if (def) {
      p.uses = def.uses;
      p.successes = def.successes;
    }
  }
  // Start everyone with a clean inbox except the most recent, relevant items.
  const cutoff = now - 8 * H;
  state.notifications = state.notifications.filter((n) => n.at > cutoff);
  // Monitoring ran while the history was replayed; keep only what is still open or recent.
  state.alerts = state.alerts.filter((a) => !a.resolvedAt || a.resolvedAt > now - 48 * H);
  sweep(state, now);
  return state;
}
