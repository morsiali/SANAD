import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ROLE_LABEL, type Role } from '../../shared/types';
import { computeLoads, decideRouting } from '../../shared/routing';
import { createSeed } from '../../shared/seed';
import { userName } from '../../shared/engine';
import { useApp } from '../lib/store';
import { isAr, t, tc, tm } from '../lib/i18n';
import { ROLE_ICON } from '../lib/format';
import { LangToggle } from '../lib/lang';
import { Avatar, Icon, Logo, PriorityPill, Sparkle } from '../components/ui';

const EXAMPLES = ['Mum’s insulin pens are running low', 'The driver didn’t come for dad’s dialysis pickup', 'Grandma slipped in the bathroom this morning', 'Her Thiqa card expires next week'];

const ROLE_PITCH: { role: Role; email: string; head: string; text: string; tags: [string, string][] }[] = [
  { role: 'family', email: 'mariam@sanad.ae', head: 'Peace of mind, without the phone calls', text: 'Say what’s wrong in your own words. SANAD finds the person who can fix it, shows you every step, and asks you to confirm when it’s really solved.', tags: [['plus', 'One-tap reporting'], ['eye', 'Live progress'], ['check', 'You confirm the fix'], ['users', 'Whole care team in view']] },
  { role: 'caregiver', email: 'aisha@sanad.ae', head: 'Your day, in the order that matters', text: 'Problems for the people you visit arrive with history attached, ranked by urgency. Apply a proven checklist and close the loop with the family.', tags: [['layers', 'Ranked queue'], ['book', 'Proven checklists'], ['handoff', 'Hand off in one step'], ['clock', 'Response-time clock']] },
  { role: 'doctor', email: 'kareem@sanad.ae', head: 'Only the clinical questions reach you', text: 'Refills go to the pharmacy and rides go to transport. What lands with you is clinical, prioritised, and comes with readings and context.', tags: [['stethoscope', 'Clinical triage'], ['flag', 'Safety signals raised'], ['chat', 'One thread per problem'], ['users', 'Continuity of care']] },
  { role: 'coordinator', email: 'sara@sanad.ae', head: 'See every problem in the network at once', text: 'Triage what the rules can’t place, watch team load, and step in the moment a response time slips — SANAD escalates automatically.', tags: [['route', 'Editable routing rules'], ['chart', 'Network insights'], ['flag', 'Auto-escalation'], ['users', 'Load balancing']] },
  { role: 'transport', email: 'yousef@sanad.ae', head: 'Rides that never fall through the cracks', text: 'Ride requests and no-shows reach dispatch directly, with pickup details and a recovery playbook ready to go.', tags: [['car', 'Ride requests'], ['bolt', 'No-show recovery'], ['clock', 'Clinic deadlines'], ['check', 'Family confirmation']] },
  { role: 'pharmacy', email: 'omar@sanad.ae', head: 'Refills before anyone runs out', text: 'Low supplies and prescription problems come straight to the pharmacy, with the patient, dose and delivery address in one place.', tags: [['pill', 'Refill requests'], ['handoff', 'Send renewals to the doctor'], ['book', 'Delivery playbooks'], ['eye', 'Status for families']] },
  { role: 'social', email: 'noura@sanad.ae', head: 'Benefits, equipment and wellbeing', text: 'Expired cards, broken wheelchairs and loneliness are care problems too. SANAD routes them to social services with the family already in the loop.', tags: [['shield', 'Benefits & documents'], ['settings', 'Equipment & home'], ['heart', 'Wellbeing plans'], ['users', 'Community links']] },
];

const STEPS = [
  { h: 'Report', t: 'Anyone in the circle describes the problem in plain words — family, carer, doctor or driver.' },
  { h: 'Route', t: 'SANAD matches it to the responsible team, sets urgency, and picks the best available person in under a second.' },
  { h: 'Resolve', t: 'The owner gets a ranked queue, a proven playbook and a response-time clock. Hand-offs keep the history.' },
  { h: 'Confirm', t: 'The family confirms the fix and rates it — so the playbooks that work rise to the top.' },
];

const FAQ = [
  { q: 'Who decides where a problem goes?', a: 'Routing rules the care coordinator controls. Each rule maps words and phrases to a team. SANAD then picks the available person in that team with the right skills, the lightest workload and an existing relationship with the family. Every decision shows its reasons.' },
  { q: 'What happens if nobody responds?', a: 'Every problem has a response time based on its priority — one hour for urgent ones by default. When it passes, SANAD escalates to the care coordinator automatically and tells the owner.' },
  { q: 'Is SANAD Intelligence sending our data to an AI service?', a: 'No. SANAD Intelligence runs inside the platform and only reads what you are allowed to see. Nothing leaves your workspace.' },
  { q: 'Can families see everything?', a: 'Families see the problems about the people they care for, who owns them and every update. They don’t see other families’ information, and staff only see what is routed to them or their team.' },
  { q: 'Is SANAD for emergencies?', a: 'No. In an emergency call 998. SANAD recognises safety words — like a fall or chest pain — and raises priority, but it does not replace emergency services.' },
];

export function Landing() {
  const { signIn, token, toast } = useApp();
  const nav = useNavigate();
  const world = useMemo(() => createSeed(), []);
  const loads = useMemo(() => computeLoads(world.users, world.challenges), [world]);
  const [demo, setDemo] = useState(EXAMPLES[0]);
  const [tab, setTab] = useState(0);
  const [faq, setFaq] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);

  const preview = useMemo(
    () => (demo.trim().length > 3 ? decideRouting({ title: demo, description: '', recipientId: 'r-fatima' }, { users: world.users, rules: world.rules, settings: world.settings, loads }) : null),
    [demo, world, loads],
  );
  const assignee = world.users.find((u) => u.id === preview?.assigneeId);
  const pitch = ROLE_PITCH[tab];

  const tryAs = async (email: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await signIn(email, 'sanad123');
      nav('/app');
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="site">
      <header className="site-nav">
        <Link to="/" aria-label="SANAD home">
          <Logo />
        </Link>
        <nav aria-label="Website">
          <a href="#teams">Who it’s for</a>
          <a href="#how">How it works</a>
          <Link to="/workflow">Workflow</Link>
          <a href="#intelligence">Intelligence</a>
          <a href="#faq">Questions</a>
        </nav>
        <div className="row gap-s">
          <LangToggle />
          {token ? (
            <Link to="/app" className="btn btn-dark btn-sm">
              Open dashboard
            </Link>
          ) : (
            <>
              <Link to="/signin" className="btn btn-outline btn-sm">
                Sign in
              </Link>
              <Link to="/signin" className="btn btn-dark btn-sm hide-s">
                Get started
              </Link>
            </>
          )}
        </div>
      </header>

      <section className="site-hero">
        <p className="grad-label">Care coordination for families in the UAE</p>
        <h1 className="display-xl">Every care problem reaches the person who can solve it</h1>
        <p className="lede center">SANAD connects families, carers, doctors, pharmacies, drivers and social services. Describe a problem once — it’s routed, tracked and solved.</p>
        <div className="row gap-s center">
          <Link to="/signin" className="btn btn-dark btn-lg">
            Get started
          </Link>
          <a href="#how" className="btn btn-light btn-lg">
            See how it works
          </a>
        </div>

        <div className="live-demo" aria-live="polite">
          <label className="live-input">
            <Sparkle size={20} />
            <input value={demo} onChange={(e) => setDemo(e.target.value)} aria-label="Describe a care problem to see where it goes" />
          </label>
          <div className="live-examples">
            {EXAMPLES.map((e) => (
              <button key={e} type="button" className={`chip ${demo === e ? 'chip-on' : ''}`} onClick={() => setDemo(e)}>
                {e}
              </button>
            ))}
          </div>
          {preview && (
            <div className="live-out">
              <div className="live-route">
                <span className="live-node">
                  <Icon name="chat" size={18} /> Reported
                </span>
                <span className="live-line" />
                <span className="live-node live-node-on">
                  <Icon name={ROLE_ICON[preview.role]} size={18} /> {ROLE_LABEL[preview.role]}
                </span>
                <span className="live-line" />
                <span className="live-node">
                  <Avatar user={assignee} size={26} /> {assignee ? tc(userName(world, assignee.id)) : t('Team queue')}
                </span>
              </div>
              <p className="live-why">
                <PriorityPill p={preview.priority} /> {tm(preview.why[0])}
              </p>
            </div>
          )}
        </div>
      </section>

      <section id="teams" className="site-sec">
        <h2 className="display-l center">One platform, seven ways in</h2>
        <p className="lede center">Each person gets a dashboard built around their part of the work.</p>
        <div className="pill-tabs" role="tablist" aria-label="Roles">
          {ROLE_PITCH.map((p, i) => (
            <button key={p.role} type="button" role="tab" aria-selected={tab === i} className={tab === i ? 'on' : ''} onClick={() => setTab(i)}>
              {ROLE_LABEL[p.role]}
            </button>
          ))}
        </div>
        <div className="feature-panel" role="tabpanel">
          <span className="feature-icon">
            <Icon name={ROLE_ICON[pitch.role]} size={26} />
          </span>
          <h3 className="display-m">{pitch.head}</h3>
          <p>{pitch.text}</p>
          <ul className="feature-tags">
            {pitch.tags.map(([icon, label]) => (
              <li key={label}>
                <Icon name={icon} size={18} /> {label}
              </li>
            ))}
          </ul>
          <div className="row gap-s">
            <button type="button" className="btn btn-dark" onClick={() => tryAs(pitch.email)} disabled={busy}>
              {t('Try the {role} dashboard', { role: isAr() ? t(ROLE_LABEL[pitch.role]) : ROLE_LABEL[pitch.role].toLowerCase() })}
            </button>
            <Link to="/signin" className="btn btn-light">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <section id="how" className="site-sec">
        <h2 className="display-l center">From worry to solved in four steps</h2>
        <ol className="how">
          {STEPS.map((s, i) => (
            <li key={s.h}>
              <span className="how-n">{i + 1}</span>
              <h3>{s.h}</h3>
              <p>{s.t}</p>
            </li>
          ))}
        </ol>
        <div className="row center wf-cta">
          <Link to="/workflow" className="btn btn-light">
            See the full workflow
          </Link>
        </div>
      </section>

      <section id="intelligence" className="site-sec">
        <div className="night">
          <div>
            <Sparkle size={44} />
            <h2 className="display-l">Don’t search. Just ask.</h2>
            <p>SANAD Intelligence answers in plain language — what to do next, what’s overdue, who handles what, and which fix has worked before. It ranks solutions by how often they worked, how long they take and how much effort they need.</p>
            <button type="button" className="btn btn-white" onClick={() => tryAs('sara@sanad.ae')} disabled={busy}>
              Ask as the care coordinator
            </button>
          </div>
          <ul className="night-cards">
            <li>
              <Sparkle size={16} /> “What should I focus on next?”
            </li>
            <li>
              <Sparkle size={16} /> “Who handles a broken wheelchair?”
            </li>
            <li>
              <Sparkle size={16} /> “How do I fix a missed dose?”
            </li>
            <li>
              <Sparkle size={16} /> “How is Fatima doing?”
            </li>
          </ul>
        </div>
      </section>

      <section id="faq" className="site-sec narrow">
        <h2 className="display-l center">Questions, answered</h2>
        <div className="faq">
          {FAQ.map((f, i) => (
            <div key={f.q} className={`faq-item ${faq === i ? 'open' : ''}`}>
              <button type="button" aria-expanded={faq === i} onClick={() => setFaq(faq === i ? null : i)}>
                {f.q}
                <Icon name="plus" size={18} />
              </button>
              {faq === i && <p>{f.a}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="site-sec">
        <div className="cta-panel">
          <h2 className="display-l">Take the weight off the family</h2>
          <p className="lede center">Pick a demo account and see SANAD from any seat in the care circle.</p>
          <Link to="/signin" className="btn btn-dark btn-lg">
            Get started
          </Link>
        </div>
      </section>

      <footer className="site-foot">
        <div>
          <Logo />
          <p className="small muted">Life and care, connected. Built for families in the UAE.</p>
        </div>
        <nav aria-label="Footer">
          <strong>Product</strong>
          <a href="#teams">Who it’s for</a>
          <a href="#how">How it works</a>
          <Link to="/workflow">Workflow</Link>
          <a href="#intelligence">Intelligence</a>
        </nav>
        <nav aria-label="Get started">
          <strong>Get started</strong>
          <Link to="/signin">Sign in</Link>
          <a href="#faq">Questions</a>
          <button type="button" className="linkish" onClick={() => tryAs('mariam@sanad.ae')}>
            Try as a family member
          </button>
        </nav>
        <p className="small muted foot-note">In an emergency, call 998.</p>
      </footer>
    </div>
  );
}
