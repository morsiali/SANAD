// The SANAD workflow as a swimlane process map: who does what, in which order,
// and what happens when something goes wrong. Used in the app (with live counts)
// and as a standalone page.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PRIORITIES, ROLES, ROLE_LABEL, type Priority, type Role, type Settings, type View } from '../../shared/types';
import { isActive } from '../../shared/routing';
import { isAr, t } from '../lib/i18n';
import { Icon, PriorityPill, Sparkle } from './ui';

type LaneId = 'reporter' | 'engine' | 'owner' | 'coord';
type NodeId = 'report' | 'classify' | 'rule' | 'triage' | 'free' | 'queue' | 'pick' | 'accept' | 'work' | 'escalate' | 'resolve' | 'confirm' | 'closed';

const LANES: { id: LaneId; label: string; sub: string }[] = [
  { id: 'reporter', label: 'Person reporting', sub: 'Family or any\nteam member' },
  { id: 'engine', label: 'SANAD', sub: 'Automatic,\nunder a second' },
  { id: 'owner', label: 'Responsible team', sub: 'Carer, doctor, pharmacy,\ntransport or social' },
  { id: 'coord', label: 'Care coordinator', sub: 'Oversight and\nexceptions' },
];

interface FlowNode {
  id: NodeId;
  lane: LaneId;
  col: number;
  label: string; // "\n" separates the two lines
  kind: 'step' | 'decision' | 'end';
  roles: Role[];
  who: string;
  what: string;
  notifies: string;
  limit: string;
  link?: string;
}

const OWNER_ROLES: Role[] = ['caregiver', 'doctor', 'transport', 'pharmacy', 'social'];
const EVERYONE: Role[] = [...ROLES];

const NODES: FlowNode[] = [
  { id: 'report', lane: 'reporter', col: 0, label: 'Report the\nproblem', kind: 'step', roles: EVERYONE, who: 'Anyone in the care circle', what: 'Describe the problem in plain words, in English or Arabic, and choose who it is about. Before sending, SANAD shows who will get it and why.', notifies: 'Nobody yet — the problem goes straight to SANAD.', limit: 'The response clock starts when you send it.', link: '/app/report' },
  { id: 'classify', lane: 'engine', col: 1, label: 'Classify &\nset priority', kind: 'step', roles: EVERYONE, who: 'SANAD, automatically', what: 'Matches the words against the routing rules to find the category and the responsible team. Safety words such as a fall or chest pain raise the priority, and can never be rated low.', notifies: 'The coordinator and the family are told at once about anything urgent.', limit: 'Instant.', link: '/app/routing' },
  { id: 'rule', lane: 'engine', col: 2, label: 'Rule\nmatched?', kind: 'decision', roles: EVERYONE, who: 'SANAD, automatically', what: 'If a routing rule matches, the problem goes to that team. If nothing matches, it goes to the care coordinator to route by hand.', notifies: '—', limit: 'Instant.' },
  { id: 'triage', lane: 'coord', col: 2, label: 'Route\nby hand', kind: 'step', roles: ['coordinator'], who: 'Care coordinator', what: 'Reads the problem and sends it to the right team with a short reason. Adding a rule for it means next time it routes itself.', notifies: 'The chosen person, and the reporter.', limit: 'Same response time as the problem’s priority.', link: '/app/challenges?stage=reported&scope=all' },
  { id: 'free', lane: 'engine', col: 3, label: 'Anyone\navailable?', kind: 'decision', roles: EVERYONE, who: 'SANAD, automatically', what: 'Checks who in the team is available right now. People marked away are skipped.', notifies: '—', limit: 'Instant.' },
  { id: 'queue', lane: 'owner', col: 3, label: 'Team queue:\nfirst to claim', kind: 'step', roles: OWNER_ROLES, who: 'The responsible team', what: 'Nobody is available, so the problem waits in the team queue. The first person to claim it owns it, and anyone coming back from away picks it up automatically.', notifies: 'The care coordinator, so nothing waits unseen.', limit: 'The response clock keeps running.', link: '/app/challenges?scope=team' },
  { id: 'pick', lane: 'engine', col: 4, label: 'Pick the\nbest person', kind: 'step', roles: EVERYONE, who: 'SANAD, automatically', what: 'Chooses the available person with matching skills, the lightest workload and an existing relationship with the family. Every choice shows its reasons and a confidence score.', notifies: 'The chosen person gets the problem in their queue and inbox.', limit: 'Instant.' },
  { id: 'accept', lane: 'owner', col: 5, label: 'Accept', kind: 'step', roles: OWNER_ROLES, who: 'The assigned person', what: 'Opens the problem with its full history and accepts it, or hands it to a better-placed team with a reason.', notifies: 'The reporter and the family see who accepted it.', limit: 'Within the response time for its priority.', link: '/app/challenges?scope=mine&stage=routed' },
  { id: 'work', lane: 'owner', col: 6, label: 'Work the\nsteps', kind: 'step', roles: OWNER_ROLES, who: 'The assigned person', what: 'Applies the suggested playbook so its steps become a checklist, ticks steps off, and keeps everyone updated in the conversation.', notifies: 'Everyone following gets each comment and step change.', limit: 'Before the response time runs out.', link: '/app/challenges?scope=mine&stage=in_progress' },
  { id: 'escalate', lane: 'coord', col: 6, label: 'Review\nescalation', kind: 'step', roles: ['coordinator'], who: 'Care coordinator', what: 'When the response time passes, or someone escalates, the coordinator unblocks it: reassigns it, changes the priority, or clears the escalation.', notifies: 'The owner hears about every change.', limit: 'Raised automatically the moment a response time is missed.', link: '/app/challenges?flag=escalated&scope=all' },
  { id: 'resolve', lane: 'owner', col: 7, label: 'Resolve\nwith a note', kind: 'step', roles: OWNER_ROLES, who: 'The assigned person', what: 'Marks it resolved and writes what was done. The note is what the family reads when they confirm.', notifies: 'The reporter, the family and anyone following.', limit: 'Solved in time if this happens before the deadline.' },
  { id: 'confirm', lane: 'reporter', col: 8, label: 'Confirm\n& rate', kind: 'step', roles: ['family', 'coordinator'], who: 'The reporter or the family', what: 'Checks the fix and rates it from 1 to 5. If it is not really fixed, they reopen it and it goes straight back to the owner.', notifies: 'The owner sees the rating, or the reason for reopening.', limit: 'No deadline — but nothing closes without it.', link: '/app/challenges?stage=resolved' },
  { id: 'closed', lane: 'reporter', col: 9, label: 'Closed', kind: 'end', roles: EVERYONE, who: 'Everyone', what: 'The problem is solved and confirmed. Good ratings raise the playbook’s success rate, so the fixes that work are suggested first next time.', notifies: 'The owner.', limit: '—', link: '/app/challenges?stage=verified' },
];

interface FlowEdge {
  from: NodeId;
  to: NodeId;
  label?: string;
  type: 'main' | 'alt' | 'exception';
  /** Optional routing hint for edges that must avoid other lines. */
  route?: 'down' | 'up-from-coord' | 'back-via-channel' | 'parallel-down' | 'parallel-up';
}

const EDGES: FlowEdge[] = [
  { from: 'report', to: 'classify', label: 'sends', type: 'main' },
  { from: 'classify', to: 'rule', type: 'main' },
  { from: 'rule', to: 'free', label: 'yes', type: 'main' },
  { from: 'rule', to: 'triage', label: 'no', type: 'alt', route: 'down' },
  { from: 'triage', to: 'pick', label: 'picks team', type: 'alt', route: 'up-from-coord' },
  { from: 'free', to: 'pick', label: 'yes', type: 'main' },
  { from: 'free', to: 'queue', label: 'no', type: 'alt', route: 'down' },
  { from: 'queue', to: 'accept', label: 'claimed', type: 'alt' },
  { from: 'pick', to: 'accept', label: 'assigns', type: 'main' },
  { from: 'accept', to: 'work', type: 'main' },
  { from: 'work', to: 'resolve', type: 'main' },
  { from: 'resolve', to: 'confirm', label: 'asks to confirm', type: 'main' },
  { from: 'confirm', to: 'closed', type: 'main' },
  { from: 'work', to: 'pick', label: 'hand off', type: 'exception', route: 'back-via-channel' },
  { from: 'confirm', to: 'work', label: 'not fixed: reopen', type: 'exception', route: 'back-via-channel' },
  { from: 'work', to: 'escalate', label: 'time runs out', type: 'exception', route: 'parallel-down' },
  { from: 'escalate', to: 'work', label: 'unblocks', type: 'exception', route: 'parallel-up' },
];

// ---- geometry -------------------------------------------------------------
const LABEL_W = 150;
const COL_W = 112;
const NODE_W = 96;
const NODE_H = 52;
const HEAD = 34;
const LANE_H = 116;
const W = LABEL_W + COL_W * 10 + 10;
const H = HEAD + LANE_H * LANES.length + 8;

const laneIndex = (l: LaneId) => LANES.findIndex((x) => x.id === l);
const cx = (col: number) => LABEL_W + COL_W * col + COL_W / 2;
const cy = (lane: LaneId) => HEAD + LANE_H * laneIndex(lane) + LANE_H / 2;
const laneTop = (lane: LaneId) => HEAD + LANE_H * laneIndex(lane);

function edgePath(e: FlowEdge): { d: string; lx: number; ly: number; anchor?: 'start' | 'end' } {
  const a = NODES.find((n) => n.id === e.from)!;
  const b = NODES.find((n) => n.id === e.to)!;
  const ax = cx(a.col);
  const ay = cy(a.lane);
  const bx = cx(b.col);
  const by = cy(b.lane);
  const hw = NODE_W / 2;
  const hh = NODE_H / 2;
  if (e.route === 'down') {
    // straight down from a decision into the lane below
    const dir = by > ay ? 1 : -1;
    const from = a.kind === 'decision' ? 32 : hh;
    return { d: `M${ax},${ay + dir * from} L${bx},${by - dir * hh}`, lx: ax + 8, ly: (ay + by) / 2 + 4, anchor: 'start' };
  }
  if (e.route === 'up-from-coord') {
    const x = bx - 20;
    return { d: `M${ax + hw},${ay} L${x},${ay} L${x},${by + hh}`, lx: (ax + hw + x) / 2, ly: ay - 7 };
  }
  if (e.route === 'parallel-down') return { d: `M${ax - 12},${ay + hh} L${bx - 12},${by - hh}`, lx: ax - 18, ly: (ay + by) / 2 + 4, anchor: 'end' };
  if (e.route === 'parallel-up') return { d: `M${ax + 12},${ay - hh} L${bx + 12},${by + hh}`, lx: ax + 18, ly: (ay + by) / 2 + 4, anchor: 'start' };
  if (e.route === 'back-via-channel') {
    // backwards edge: leave from the node edge facing the target lane, run along the gap between lanes
    const goingUp = by < ay;
    const channel = goingUp ? laneTop(a.lane) : laneTop(b.lane);
    const startY = goingUp ? ay - hh : ay + hh;
    const endY = goingUp ? by + hh : by - hh;
    const sx = ax - 20;
    const ex = bx + 20;
    return { d: `M${sx},${startY} L${sx},${channel} L${ex},${channel} L${ex},${endY}`, lx: (sx + ex) / 2, ly: channel - 6 };
  }
  if (a.lane === b.lane) {
    const s = ax + (a.kind === 'decision' ? hw - 4 : hw);
    const long = bx - ax > COL_W * 1.5;
    return { d: `M${s},${ay} L${bx - hw},${by}`, lx: long ? s + 22 : (s + bx - hw) / 2, ly: ay - 7 };
  }
  // elbow: across, then into the target lane, then across
  const midX = (ax + bx) / 2;
  const s = ax + (a.kind === 'decision' ? hw - 4 : hw);
  return { d: `M${s},${ay} L${midX},${ay} L${midX},${by} L${bx - hw},${by}`, lx: midX + 5, ly: (ay + by) / 2 + 4, anchor: 'start' };
}

export type StageCounts = Partial<Record<NodeId, number>>;

export function countsFromView(view: View): StageCounts {
  const active = view.challenges.filter(isActive);
  return {
    triage: active.filter((c) => c.stage === 'reported').length,
    queue: active.filter((c) => !c.assigneeId).length,
    accept: active.filter((c) => c.stage === 'routed' && c.assigneeId).length,
    work: active.filter((c) => c.stage === 'accepted' || c.stage === 'in_progress').length,
    escalate: active.filter((c) => c.escalated).length,
    confirm: view.challenges.filter((c) => c.stage === 'resolved').length,
    closed: view.challenges.filter((c) => c.stage === 'verified').length,
  };
}

const SPLIT = (s: string) => t(s).split('\n');

export function WorkflowMap({ counts, initialRole = 'all', settings, linkable = false }: { counts?: StageCounts; initialRole?: Role | 'all'; settings: Settings; linkable?: boolean }) {
  const [role, setRole] = useState<Role | 'all'>(initialRole);
  const [selected, setSelected] = useState<NodeId>('report');
  const rtl = isAr();
  // Mirror horizontally for right-to-left reading.
  const X = (x: number) => (rtl ? W - x : x);
  const mirror = (d: string) => (rtl ? d.replace(/([ML])(-?[\d.]+),/g, (_, cmd: string, x: string) => `${cmd}${W - Number(x)},`) : d);
  const on = (n: FlowNode) => role === 'all' || n.roles.includes(role);
  const node = NODES.find((n) => n.id === selected)!;
  const step = NODES.indexOf(node);

  return (
    <div className="wf">
      <div className="wf-roles" role="group" aria-label={t('Show the part played by')}>
        <span className="muted small">{t('Show the part played by')}</span>
        <button type="button" className={`chip ${role === 'all' ? 'chip-on' : ''}`} onClick={() => setRole('all')} aria-pressed={role === 'all'}>
          {t('Everyone')}
        </button>
        {ROLES.map((r) => (
          <button key={r} type="button" className={`chip ${role === r ? 'chip-on' : ''}`} onClick={() => setRole(r)} aria-pressed={role === r}>
            {t(ROLE_LABEL[r])}
          </button>
        ))}
      </div>

      <figure className="wf-figure">
        <div className="wf-scroll">
          <svg viewBox={`0 0 ${W} ${H}`} className="wf-svg" role="group" aria-label={t('SANAD workflow: a problem is reported, routed automatically to the best available person, worked, resolved and confirmed by the family; unmatched problems go to the coordinator, missed response times escalate, and unfixed problems reopen.')}>
            <defs>
              <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
              </marker>
              <marker id="wf-arrow-ex" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#b4690e" />
              </marker>
            </defs>

            {/* stage header */}
            {(
              [
                ['Reported', 0],
                ['Routed', 2.5],
                ['Accepted', 5],
                ['In progress', 6],
                ['Resolved', 7],
                ['Confirmed', 8],
                ['Closed', 9],
              ] as [string, number][]
            ).map(([label, col]) => (
              <text key={label} x={X(cx(col))} y={20} className="wf-head" textAnchor="middle">
                {t(label)}
              </text>
            ))}

            {/* lanes */}
            {LANES.map((l, i) => (
              <g key={l.id}>
                <rect x={0} y={HEAD + LANE_H * i} width={W} height={LANE_H} className={i % 2 ? 'wf-lane wf-lane-alt' : 'wf-lane'} />
                <text x={X(14)} y={HEAD + LANE_H * i + LANE_H / 2 - 10} className="wf-lane-title" textAnchor={rtl ? 'end' : 'start'}>
                  {t(l.label)}
                </text>
                {t(l.sub)
                  .split('\n')
                  .map((ln, k) => (
                    <text key={k} x={X(14)} y={HEAD + LANE_H * i + LANE_H / 2 + 12 + k * 14} className="wf-lane-sub" textAnchor={rtl ? 'end' : 'start'}>
                      {ln}
                    </text>
                  ))}
              </g>
            ))}

            {/* edges */}
            {EDGES.map((e, i) => {
              const p = edgePath(e);
              const dim = !(on(NODES.find((n) => n.id === e.from)!) && on(NODES.find((n) => n.id === e.to)!));
              return (
                <g key={i} className={`wf-edge wf-edge-${e.type} ${dim ? 'wf-dim' : ''}`}>
                  <path d={mirror(p.d)} fill="none" markerEnd={`url(#${e.type === 'exception' ? 'wf-arrow-ex' : 'wf-arrow'})`} />
                  {e.label && (
                    <text x={X(p.lx)} y={p.ly} textAnchor={p.anchor ? ((p.anchor === 'start') !== rtl ? 'start' : 'end') : 'middle'} className="wf-edge-label">
                      {t(e.label)}
                    </text>
                  )}
                </g>
              );
            })}

            {/* nodes */}
            {NODES.map((n) => {
              const x = X(cx(n.col));
              const y = cy(n.lane);
              const lines = SPLIT(n.label);
              const count = counts?.[n.id];
              return (
                <g
                  key={n.id}
                  className={`wf-node wf-${n.kind} ${on(n) ? '' : 'wf-dim'} ${selected === n.id ? 'wf-sel' : ''} ${n.lane === 'engine' ? 'wf-auto' : ''}`}
                  onClick={() => setSelected(n.id)}
                  onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), setSelected(n.id))}
                  tabIndex={0}
                  role="button"
                  aria-pressed={selected === n.id}
                  aria-label={t(n.label).replace('\n', ' ')}
                >
                  {n.kind === 'decision' ? (
                    <polygon points={`${x},${y - 32} ${x + 44},${y} ${x},${y + 32} ${x - 44},${y}`} />
                  ) : n.kind === 'end' ? (
                    <rect x={x - NODE_W / 2} y={y - NODE_H / 2} width={NODE_W} height={NODE_H} rx={NODE_H / 2} />
                  ) : (
                    <rect x={x - NODE_W / 2} y={y - NODE_H / 2} width={NODE_W} height={NODE_H} rx={10} />
                  )}
                  {lines.map((ln, i) => (
                    <text key={i} x={x} y={y + (i - (lines.length - 1) / 2) * 15 + 4} textAnchor="middle" className="wf-node-text">
                      {ln}
                    </text>
                  ))}
                  {count !== undefined && count > 0 && (
                    <g className="wf-count">
                      <circle cx={x + (rtl ? -1 : 1) * (NODE_W / 2 - 2)} cy={y - NODE_H / 2 + 2} r={11} />
                      <text x={x + (rtl ? -1 : 1) * (NODE_W / 2 - 2)} y={y - NODE_H / 2 + 6} textAnchor="middle">
                        {count}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        <figcaption className="wf-legend">
          <span>
            <i className="lg-main" /> {t('Normal path')}
          </span>
          <span>
            <i className="lg-alt" /> {t('Alternative path')}
          </span>
          <span>
            <i className="lg-ex" /> {t('Exception: hand off, escalation, reopen')}
          </span>
          <span>
            <i className="lg-auto" /> {t('Done by SANAD automatically')}
          </span>
          {counts && (
            <span>
              <i className="lg-count" /> {t('Live: challenges at this step now')}
            </span>
          )}
          <span className="muted">{t('Select any step for details.')}</span>
        </figcaption>
      </figure>

      <section className="wf-detail" aria-live="polite">
        <div className="wf-detail-head">
          <span className="wf-step-n">{step + 1}</span>
          <div>
            <h3>{t(node.label).replace('\n', ' ')}</h3>
            <p className="muted small">
              {node.lane === 'engine' && <Sparkle size={13} />} {t(node.who)}
            </p>
          </div>
          <div className="wf-nav">
            <button type="button" className="icon-btn" disabled={step === 0} onClick={() => setSelected(NODES[step - 1].id)} aria-label={t('Previous step')}>
              <Icon name="back" />
            </button>
            <button type="button" className="icon-btn" disabled={step === NODES.length - 1} onClick={() => setSelected(NODES[step + 1].id)} aria-label={t('Next step')}>
              <Icon name="arrow" />
            </button>
          </div>
        </div>
        <p>{t(node.what)}</p>
        <dl className="facts">
          <dt>{t('Who is told')}</dt>
          <dd>{t(node.notifies)}</dd>
          <dt>{t('Time limit')}</dt>
          <dd>{t(node.limit)}</dd>
          {counts?.[node.id] !== undefined && (
            <>
              <dt>{t('Right now')}</dt>
              <dd>{t(counts[node.id] === 1 ? '{n} challenge at this step' : '{n} challenges at this step', { n: counts[node.id] ?? 0 })}</dd>
            </>
          )}
        </dl>
        {linkable && node.link && (
          <Link className="btn btn-dark btn-sm" to={node.link}>
            {t('Open these challenges')}
          </Link>
        )}
      </section>

      <div className="wf-cols">
        <section className="panel">
          <h2 className="h2">{t('How SANAD picks the person')}</h2>
          <ol className="wf-pick">
            {[
              ['Match a rule', 'Words in the problem decide the category and the team.'],
              ['Set the priority', 'Safety words raise it; a rule can set a minimum.'],
              ['Keep only who is available', 'People marked away are skipped; if nobody is left, the team queue takes it.'],
              ['Prefer matching skills', 'Skills on a profile, like insulin or wheelchair, count first.'],
              ['Balance the workload', 'Urgent work counts 4, high 3, medium 2, low 1.'],
              ['Keep care continuous', 'Someone who already supports the family is preferred.'],
            ].map(([h, d]) => (
              <li key={h}>
                <strong>{t(h)}</strong>
                <span>{t(d)}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="panel">
          <h2 className="h2">{t('Response times')}</h2>
          <table className="data-table wf-sla">
            <thead>
              <tr>
                <th>{t('Priority')}</th>
                <th>{t('Respond within')}</th>
                <th>{t('If missed')}</th>
              </tr>
            </thead>
            <tbody>
              {([...PRIORITIES].reverse() as Priority[]).map((p) => (
                <tr key={p}>
                  <td>
                    <PriorityPill p={p} />
                  </td>
                  <td>{settings.sla[p] >= 60 ? t('{n} h', { n: Math.round((settings.sla[p] / 60) * 10) / 10 }) : t('{n} min', { n: settings.sla[p] })}</td>
                  <td>{t(settings.autoEscalate ? 'Escalates to the coordinator' : 'Shown as overdue')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">{t('Reopening restarts the clock. The coordinator can change these times.')}</p>
        </section>
      </div>

      <section className="panel">
        <h2 className="h2">{t('Who does what')}</h2>
        <div className="table-wrap">
          <table className="data-table wf-roles-table">
            <thead>
              <tr>
                <th>{t('Role')}</th>
                <th>{t('Receives')}</th>
                <th>{t('Does')}</th>
                <th>{t('Sees')}</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['family', 'Updates on the people they care for', 'Reports problems, confirms fixes, rates them, reopens', 'Everything about their own family'],
                  ['caregiver', 'Daily care, falls, medication at home', 'Accepts, works checklists, resolves, hands off', 'Their work, their team’s queue, the people they support'],
                  ['doctor', 'Clinical concerns and appointments', 'Accepts, works checklists, resolves, hands off', 'Their work, their team’s queue, their patients'],
                  ['pharmacy', 'Refills, supplies, prescriptions', 'Accepts, delivers, resolves, sends renewals to the doctor', 'Their work and their team’s queue'],
                  ['transport', 'Rides, pickups, no-shows', 'Accepts, dispatches, resolves', 'Their work and their team’s queue'],
                  ['social', 'Benefits, documents, equipment, wellbeing', 'Accepts, applies, resolves', 'Their work and their team’s queue'],
                  ['coordinator', 'Unmatched problems, escalations, empty queues', 'Routes by hand, reassigns, clears escalations, edits rules and response times', 'Everything in the network'],
                ] as [Role, string, string, string][]
              ).map(([r, a, b, c]) => (
                <tr key={r} className={role !== 'all' && role !== r ? 'wf-row-dim' : ''}>
                  <th scope="row">{t(ROLE_LABEL[r])}</th>
                  <td>{t(a)}</td>
                  <td>{t(b)}</td>
                  <td>{t(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
