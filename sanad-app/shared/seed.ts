// Demo world: three families in Dubai and the people who support them.
// The history is produced by replaying real actions through the engine, so every
// routing decision, notification and audit entry is genuine.
import type { Action, Playbook, Rule, State, User } from './types';
import { apply, sweep } from './engine';

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
  action: Action | ((ids: Record<string, string>) => Action);
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

export function createSeed(now = Date.now()): State {
  let state: State = {
    version: 1,
    seq: 100,
    users: JSON.parse(JSON.stringify(users)),
    recipients: [
      { id: 'r-fatima', name: 'Fatima Al Noor', age: 72, area: 'Al Barsha, Dubai', note: 'Lives with her daughter Mariam. Type 2 diabetes, uses a walker.', support: 'assisted', living: 'family', needs: ['chronic', 'mobility'] },
      { id: 'r-hamad', name: 'Hamad Al Mansoori', age: 80, area: 'Mirdif, Dubai', note: 'Wheelchair user, dialysis three times a week. Son Khalid visits daily.', support: 'high', living: 'family', needs: ['mobility', 'renal'] },
      { id: 'r-khadija', name: 'Khadija Saeed', age: 68, area: 'Al Qusais, Dubai', note: 'Recovering from knee surgery. Lives alone.', support: 'assisted', living: 'alone', needs: ['recovery', 'mobility'] },
    ],
    challenges: [],
    rules: JSON.parse(JSON.stringify(rules)),
    playbooks: playbookDefs.map((p) => ({ ...p, steps: [...p.steps], tags: [...p.tags], updatedAt: now - 400 * H })),
    notifications: [],
    settings: { sla: { urgent: 60, high: 240, medium: 1440, low: 4320 }, autoEscalate: true, balanceLoad: true, preferContinuity: true },
  };
  const ids: Record<string, string> = {};
  for (const step of [...script].sort((a, b) => b.at - a.at)) {
    let action = typeof step.action === 'function' ? step.action(ids) : step.action;
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
  sweep(state, now);
  return state;
}
