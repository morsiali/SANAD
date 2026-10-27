import { useMemo, useState } from 'react';
import type { CareRecord, Domain, DoseLog, Medication, MedicationInput } from '../../shared/types';
import { canWrite } from '../../shared/access';
import { DOSE_STATUS_LABEL, SOURCE_LABEL, dayKey, doseSlots, kindOf, kindsFor, liveRecords, refillForecast, slotTime, type RecordKind } from '../../shared/records';
import { useSession } from '../lib/store';
import { isAr, locale, t, tc } from '../lib/i18n';
import { dateTime, timeAgo } from '../lib/format';
import { Empty, Field, Icon, Modal } from './ui';

const kindLabel = (k: string) => t(kindOf(k)?.label ?? k);

export function SourceBadge({ source }: { source: CareRecord['source'] }) {
  return <span className={`src-badge src-${source}`}>{t(SOURCE_LABEL[source])}</span>;
}

export function VerifyBadge({ verified, by }: { verified: boolean; by?: string }) {
  const { view } = useSession();
  if (!verified) return <span className="ver-badge ver-no">{t('Not verified')}</span>;
  const who = view.users.find((u) => u.id === by);
  return (
    <span className="ver-badge ver-yes">
      <Icon name="check" size={12} /> {who ? t('Verified by {name}', { name: tc(who.name) }) : t('Verified')}
    </span>
  );
}

const fmtValue = (v: number | null | undefined, unit?: string) => (v === null || v === undefined ? '' : `${v.toLocaleString(locale())} ${unit ? t(unit) : ''}`.trim());

function RecordItem({ rec, onEdit }: { rec: CareRecord; onEdit: (r: CareRecord) => void }) {
  const { view, me, act } = useSession();
  const [showHistory, setShowHistory] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [reason, setReason] = useState('');
  const def = kindOf(rec.kind);
  const author = view.users.find((u) => u.id === rec.authorId);
  const mine = rec.authorId === me.id;
  const canVerify = rec.verification !== 'verified' && !!def?.verifiers.includes(me.role) && view.memberships.some((m) => m.userId === me.id && m.recipientId === rec.recipientId && m.status === 'active');
  const isAuthority = view.memberships.some((m) => m.userId === me.id && m.recipientId === rec.recipientId && m.status === 'active' && m.authority !== 'none' && m.authorityVerified);
  const canWriteHere = canWrite(view, me.id, rec.recipientId, rec.domain);
  return (
    <li className="rec" data-kind={rec.kind}>
      <div className="rec-main">
        <div className="rec-head">
          <strong>{tc(rec.title)}</strong>
          {rec.value !== null && rec.value !== undefined && <span className="rec-value" dir="ltr">{fmtValue(rec.value, rec.unit)}</span>}
        </div>
        {rec.body && <p className="rec-body">{tc(rec.body)}</p>}
        <div className="rec-meta">
          <span className="chip chip-static">{kindLabel(rec.kind)}</span>
          <SourceBadge source={rec.source} />
          <VerifyBadge verified={rec.verification === 'verified'} by={rec.verifiedBy} />
          <small className="muted">
            {t('{name} · {when}', { name: tc(author?.name ?? t('Someone')), when: dateTime(rec.observedAt) })}
          </small>
          {rec.history.length > 0 && (
            <button type="button" className="link small" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
              {t(rec.history.length === 1 ? 'Edited once' : 'Edited {n} times', { n: rec.history.length })}
            </button>
          )}
        </div>
        {showHistory && (
          <ul className="rec-history">
            {rec.history.map((h, i) => (
              <li key={i}>
                {t('{name} changed {fields} {ago}', { name: tc(view.users.find((u) => u.id === h.by)?.name ?? t('Someone')), fields: h.fields.map((f) => t(f)).join(', '), ago: timeAgo(h.at) })}
                {Object.entries(h.before).map(([k, v]) => (
                  <small key={k} className="muted block">
                    {t('Before')} · {t(k)}: {v === null ? '—' : tc(String(v))}
                  </small>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rec-actions">
        {mine && canWriteHere && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(rec)}>
            <Icon name="edit" size={14} /> {t('Edit')}
          </button>
        )}
        {canVerify && (
          <button type="button" className="btn btn-light btn-sm" onClick={() => act({ type: 'verify_record', recordId: rec.id })}>
            <Icon name="check" size={14} /> {t('Verify')}
          </button>
        )}
        {(mine || (isAuthority && rec.source !== 'professional')) && canWriteHere && !archiving && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setArchiving(true)}>
            {t('Archive')}
          </button>
        )}
        {archiving && (
          <form
            className="row gap-s"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await act({ type: 'archive_record', recordId: rec.id, reason });
              if (r.ok) setArchiving(false);
            }}
          >
            <input aria-label={t('Reason for archiving')} placeholder={t('Reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
            <button type="submit" className="btn btn-dark btn-sm" disabled={reason.trim().length < 3}>
              {t('Archive')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setArchiving(false)}>
              {t('Cancel')}
            </button>
          </form>
        )}
      </div>
    </li>
  );
}

/** Values over time for measured kinds — a plain table, readable by screen readers. Charts come with the progress dashboards. */
function MeasureTable({ records }: { records: CareRecord[] }) {
  if (records.length < 2) return null;
  const rows = [...records].sort((a, b) => a.observedAt - b.observedAt);
  return (
    <details className="measure-table">
      <summary>{t('Show values as a table ({n})', { n: rows.length })}</summary>
      <table>
        <caption className="sr-only">{t('Recorded values')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('When')}</th>
            <th scope="col">{t('What')}</th>
            <th scope="col">{t('Value')}</th>
            <th scope="col">{t('Source')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{dateTime(r.observedAt)}</td>
              <td>{tc(r.title)}</td>
              <td>{fmtValue(r.value, r.unit)}</td>
              <td>{t(SOURCE_LABEL[r.source])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function RecordSection({ recipientId, domain, title, intro }: { recipientId: string; domain: Domain; title: string; intro?: string }) {
  const { view, me } = useSession();
  const [editing, setEditing] = useState<CareRecord | 'new' | null>(null);
  const records = useMemo(() => liveRecords(view.records, recipientId, domain), [view.records, recipientId, domain]);
  const kinds = kindsFor(domain);
  const allowedKinds = kinds.filter((k) => !k.roles || k.roles.includes(me.role));
  const writable = canWrite(view, me.id, recipientId, domain) && allowedKinds.length > 0;
  const groups = kinds.map((k) => ({ k, items: records.filter((r) => r.kind === k.kind) })).filter((g) => g.items.length);
  return (
    <section className="panel rec-section" aria-labelledby={`sec-${domain}`}>
      <header className="panel-head">
        <h2 id={`sec-${domain}`}>{t(title)}</h2>
        {writable && (
          <button type="button" className="btn btn-dark btn-sm" onClick={() => setEditing('new')}>
            <Icon name="plus" size={14} /> {t('Add a record')}
          </button>
        )}
      </header>
      {intro && <p className="muted small">{t(intro)}</p>}
      {groups.length ? (
        groups.map(({ k, items }) => (
          <div key={k.kind} className="rec-group">
            <h3>{t(k.label)}</h3>
            <ul className="recs">
              {items.map((r) => (
                <RecordItem key={r.id} rec={r} onEdit={setEditing} />
              ))}
            </ul>
            {k.measure && <MeasureTable records={items} />}
          </div>
        ))
      ) : (
        <Empty icon="book" title="Nothing recorded yet" text={writable ? 'Add the first record for this section.' : 'Records added by the care team will appear here.'} />
      )}
      {editing && <RecordModal recipientId={recipientId} domain={domain} kinds={allowedKinds} record={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

const toLocalInput = (at: number) => {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function RecordModal({ recipientId, domain, kinds, record, onClose }: { recipientId: string; domain: Domain; kinds: RecordKind[]; record?: CareRecord; onClose: () => void }) {
  const { act } = useSession();
  const [kind, setKind] = useState(record?.kind ?? kinds[0]?.kind ?? '');
  const def = kindOf(kind);
  const [f, setF] = useState({
    title: record?.title ?? '',
    body: record?.body ?? '',
    value: record?.value?.toString() ?? '',
    unit: record?.unit ?? def?.measure?.unit ?? '',
    when: toLocalInput(record?.observedAt ?? Date.now()),
  });
  const [busy, setBusy] = useState(false);
  const valueOk = !def?.measure || (f.value.trim() !== '' && Number.isFinite(Number(f.value)));
  const save = async () => {
    setBusy(true);
    const observedAt = new Date(f.when).getTime();
    const value = def?.measure ? Number(f.value) : null;
    const res = record
      ? await act({ type: 'edit_record', recordId: record.id, baseVersion: record.version, title: f.title, body: f.body, value, unit: f.unit, observedAt })
      : await act({ type: 'add_record', recipientId, domain, kind, title: f.title, body: f.body, value, unit: f.unit, observedAt });
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Modal
      title={record ? t('Edit record') : t('Add a record')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn btn-dark" disabled={busy || f.title.trim().length < 2 || !valueOk} onClick={save}>
            {record ? t('Save changes') : t('Add record')}
          </button>
        </>
      }
    >
      {!record && (
        <Field label={t('Type of record')} hint={def ? t(def.hint) : undefined}>
          <select
            id="rec-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setF({ ...f, unit: kindOf(e.target.value)?.measure?.unit ?? '' });
            }}
          >
            {kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {t(k.label)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={t('Title')}>
        <input id="rec-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </Field>
      {def?.measure && (
        <div className="grid-2">
          <Field label={t(def.measure.label)} hint={def.measure.min !== undefined ? t('Between {min} and {max}', { min: def.measure.min, max: def.measure.max ?? '' }) : undefined}>
            <input id="rec-value" type="number" step="any" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
          </Field>
          {def.measure.units ? (
            <Field label={t('Unit')}>
              <select id="rec-unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
                {def.measure.units.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label={t('Unit')}>
              <input value={def.measure.unit} readOnly aria-readonly="true" />
            </Field>
          )}
        </div>
      )}
      <Field label={t('When')}>
        <input id="rec-when" type="datetime-local" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} />
      </Field>
      <Field label={t('Details')} hint={t('Describe what was seen or said. Do not add diagnoses unless you are the treating professional.')}>
        <textarea id="rec-body" rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- medicines

const STATUSES: DoseLog['status'][] = ['taken', 'missed', 'skipped', 'unknown'];

export function MedicationPanel({ recipientId }: { recipientId: string }) {
  const { view, me, act, now } = useSession();
  const [editing, setEditing] = useState<Medication | 'new' | null>(null);
  const [supply, setSupply] = useState<Medication | null>(null);
  const meds = view.medications.filter((m) => m.recipientId === recipientId).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const writable = canWrite(view, me.id, recipientId, 'medical');
  const today = dayKey(now);
  return (
    <section className="panel rec-section" aria-labelledby="sec-meds">
      <header className="panel-head">
        <h2 id="sec-meds">{t('Medicines')}</h2>
        {writable && (
          <button type="button" className="btn btn-dark btn-sm" onClick={() => setEditing('new')}>
            <Icon name="plus" size={14} /> {t('Add a medicine')}
          </button>
        )}
      </header>
      <p className="notice small" role="note">
        <Icon name="shield" size={16} /> {t('SANAD records what people log. It never assumes a dose was taken because a reminder was sent. If a dose is missed, follow the prescriber’s instructions or ask the pharmacist — never double the next dose.')}
      </p>
      {meds.length ? (
        <ul className="meds">
          {meds.map((m) => {
            const fc = refillForecast(m, now);
            const slots = doseSlots(m, view.doseLogs, today);
            const logs = view.doseLogs.filter((l) => l.medicationId === m.id).sort((a, b) => b.at - a.at).slice(0, 6);
            return (
              <li key={m.id} className={`med ${m.active ? '' : 'med-off'}`}>
                <div className="med-head">
                  <span>
                    <strong>{tc(m.name)}</strong> <span className="muted">{tc(m.strength)}</span>
                  </span>
                  <VerifyBadge verified={m.verification === 'verified'} by={m.verifiedBy} />
                </div>
                <p className="small">
                  {t('{dose}, {route}, at {times}', { dose: tc(m.dose), route: tc(m.route), times: m.times.join(isAr() ? '، ' : ', ') })}
                  {m.prescriber && <> · {t('Prescribed by {name}', { name: tc(m.prescriber) })}</>}
                </p>
                {m.instructions && <p className="small muted">{tc(m.instructions)}</p>}
                <div className="med-meta">
                  <SourceBadge source={m.source} />
                  {!m.active && <span className="chip chip-static">{t('Stopped')}</span>}
                  {fc.daysLeft !== null ? (
                    <span className={`chip chip-static ${fc.due ? 'chip-warn' : ''}`} title={t('Units on hand ÷ (units per dose × doses per day), counted from when the supply was last entered.')}>
                      {fc.due ? t('Refill soon: about {n} days left', { n: fc.daysLeft }) : t('About {n} days of supply left', { n: fc.daysLeft })}
                    </span>
                  ) : (
                    m.active && <span className="chip chip-static">{t('Supply not recorded')}</span>
                  )}
                </div>
                {m.active && slots.length > 0 && (
                  <div className="dose-today">
                    <h4>{t('Today')}</h4>
                    <ul>
                      {slots.map(({ slot, log }) => {
                        const time = slot.slice(11);
                        const future = slotTime(slot) > now + 2 * 3_600_000;
                        return (
                          <li key={slot} className="dose-slot">
                            <span className="dose-time">{time}</span>
                            <span className={`dose-status dose-${log?.status ?? 'none'}`}>{log ? t(DOSE_STATUS_LABEL[log.status]) : t('Not logged')}</span>
                            {writable && !future && (
                              <span className="dose-btns" role="group" aria-label={t('Log the {time} dose', { time })}>
                                {STATUSES.map((s) => (
                                  <button key={s} type="button" className={`btn btn-sm ${log?.status === s ? 'btn-dark' : 'btn-light'}`} aria-pressed={log?.status === s} onClick={() => act({ type: 'log_dose', medicationId: m.id, slot, status: s, note: '' })}>
                                    {t(DOSE_STATUS_LABEL[s])}
                                  </button>
                                ))}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {logs.length > 0 && (
                  <details className="dose-log">
                    <summary>{t('Recent dose log')}</summary>
                    <ul>
                      {logs.map((l) => (
                        <li key={l.id}>
                          {t('{slot}: {status} — logged by {name}', { slot: l.slot, status: t(DOSE_STATUS_LABEL[l.status]), name: tc(view.users.find((u) => u.id === l.by)?.name ?? '') })}
                          {l.note && <small className="muted"> · {tc(l.note)}</small>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {writable && (
                  <div className="row gap-s wrap">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(m)}>
                      <Icon name="edit" size={14} /> {t('Edit')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSupply(m)}>
                      {t('Update supply')}
                    </button>
                    {me.role === 'doctor' && m.verification !== 'verified' && (
                      <button type="button" className="btn btn-light btn-sm" onClick={() => act({ type: 'verify_medication', medicationId: m.id })}>
                        <Icon name="check" size={14} /> {t('Verify')}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty icon="pill" title="No medicines recorded" text={writable ? 'Add medicines from the prescription label or the doctor’s instructions.' : 'Medicines added by the care team will appear here.'} />
      )}
      {editing && <MedicationModal recipientId={recipientId} med={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {supply && <SupplyModal med={supply} onClose={() => setSupply(null)} />}
    </section>
  );
}

function MedicationModal({ recipientId, med, onClose }: { recipientId: string; med?: Medication; onClose: () => void }) {
  const { act, me } = useSession();
  const [f, setF] = useState({
    name: med?.name ?? '',
    strength: med?.strength ?? '',
    dose: med?.dose ?? '',
    route: med?.route ?? 'By mouth',
    times: med?.times.join(', ') ?? '08:00',
    startDate: med?.startDate ?? '',
    endDate: med?.endDate ?? '',
    prescriber: med?.prescriber ?? '',
    instructions: med?.instructions ?? '',
    reminders: med?.reminders ?? true,
    onHand: med?.onHand?.toString() ?? '',
    perDose: med?.perDose?.toString() ?? '',
    active: med?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    const input: MedicationInput = {
      ...f,
      times: f.times.split(/[,،\s]+/).filter(Boolean),
      onHand: f.onHand.trim() === '' ? null : Number(f.onHand),
      perDose: f.perDose.trim() === '' ? null : Number(f.perDose),
    };
    const res = med ? await act({ type: 'edit_medication', medicationId: med.id, baseVersion: med.version, med: input }) : await act({ type: 'add_medication', recipientId, med: input });
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Modal
      wide
      title={med ? t('Edit medicine') : t('Add a medicine')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn btn-dark" disabled={busy || f.name.trim().length < 2 || !f.dose.trim()} onClick={save}>
            {med ? t('Save changes') : t('Add medicine')}
          </button>
        </>
      }
    >
      {me.role !== 'doctor' && <p className="notice small">{t('Copy the details exactly from the prescription label. Medicines entered by family or carers show as “Not verified” until a doctor on the care team checks them.')}</p>}
      <div className="grid-2">
        <Field label={t('Medicine name')}>
          <input id="med-name" value={f.name} onChange={set('name')} />
        </Field>
        <Field label={t('Strength')} hint={t('e.g. 500 mg')}>
          <input id="med-strength" value={f.strength} onChange={set('strength')} />
        </Field>
        <Field label={t('Prescribed dose')} hint={t('e.g. 1 tablet')}>
          <input id="med-dose" value={f.dose} onChange={set('dose')} />
        </Field>
        <Field label={t('Route')} hint={t('e.g. By mouth')}>
          <input id="med-route" value={f.route} onChange={set('route')} />
        </Field>
        <Field label={t('Times each day')} hint={t('24-hour times, separated by commas, e.g. 08:00, 20:00')}>
          <input id="med-times" value={f.times} onChange={set('times')} />
        </Field>
        <Field label={t('Prescriber')}>
          <input id="med-prescriber" value={f.prescriber} onChange={set('prescriber')} />
        </Field>
        <Field label={t('Start date')}>
          <input type="date" value={f.startDate} onChange={set('startDate')} />
        </Field>
        <Field label={t('End date')} hint={t('Leave empty if ongoing')}>
          <input type="date" value={f.endDate} onChange={set('endDate')} />
        </Field>
        <Field label={t('Units on hand')} hint={t('Used only for refill reminders')}>
          <input id="med-onhand" type="number" min={0} value={f.onHand} onChange={set('onHand')} />
        </Field>
        <Field label={t('Units per dose')}>
          <input id="med-perdose" type="number" min={0} step="any" value={f.perDose} onChange={set('perDose')} />
        </Field>
      </div>
      <Field label={t('Instructions from the prescriber')}>
        <textarea rows={2} value={f.instructions} onChange={set('instructions')} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={f.reminders} onChange={(e) => setF({ ...f, reminders: e.target.checked })} /> {t('Show dose times on dashboards')}
      </label>
      {med && (
        <label className="check">
          <input type="checkbox" checked={!f.active} onChange={(e) => setF({ ...f, active: !e.target.checked })} /> {t('Stopped (keep in history)')}
        </label>
      )}
    </Modal>
  );
}

function SupplyModal({ med, onClose }: { med: Medication; onClose: () => void }) {
  const { act } = useSession();
  const [n, setN] = useState(med.onHand?.toString() ?? '');
  return (
    <Modal
      title={t('Update supply: {name}', { name: tc(med.name) })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="btn btn-dark"
            disabled={n.trim() === '' || Number(n) < 0}
            onClick={async () => {
              const r = await act({ type: 'update_supply', medicationId: med.id, onHand: Number(n) });
              if (r.ok) onClose();
            }}
          >
            {t('Save')}
          </button>
        </>
      }
    >
      <Field label={t('Units on hand now')} hint={t('Count what is left. Refill reminders are worked out from this number and the dose schedule.')}>
        <input id="supply-n" type="number" min={0} value={n} onChange={(e) => setN(e.target.value)} />
      </Field>
    </Modal>
  );
}
