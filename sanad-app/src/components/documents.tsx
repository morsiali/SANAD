import { useState } from 'react';
import type { CareDocument, Domain } from '../../shared/types';
import { DOMAIN_LABEL, hasAuthority } from '../../shared/access';
import { DOC_MAX_INLINE, DOC_MAX_SERVER, DOC_TYPES } from '../../shared/plans';
import { SOURCE_LABEL } from '../../shared/records';
import { useSession } from '../lib/store';
import { t, tc } from '../lib/i18n';
import { dateTime } from '../lib/format';
import { Empty, Field, Icon, Modal } from './ui';
import { domainOptions } from './tasks';

const kb = (n: number) => (n < 1000 ? `${n} B` : `${Math.round(n / 100) / 10} KB`);

export function DocumentsPanel({ recipientId }: { recipientId: string }) {
  const { view, me, act, now, backend, token, toast } = useSession();
  const [uploading, setUploading] = useState(false);
  const [archiving, setArchiving] = useState<CareDocument | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const docs = view.documents.filter((d) => d.recipientId === recipientId && !d.archived).sort((a, b) => b.uploadedAt - a.uploadedAt);
  const canAdd = me.role !== 'admin' && domainOptions(view, recipientId).length > 0;
  const open = async (d: CareDocument) => {
    setBusy(d.id);
    try {
      // Fetched one at a time with a fresh permission check; the opening is recorded in the activity history.
      const blob = await backend.openDocument(token, d.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = d.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    setBusy('');
  };
  return (
    <section className="panel" aria-labelledby="docs-h">
      <header className="panel-head">
        <h2 id="docs-h">{t('Documents and reports')}</h2>
        {canAdd && (
          <button type="button" className="btn btn-dark btn-sm" onClick={() => setUploading(true)}>
            <Icon name="upload" size={14} /> {t('Upload a document')}
          </button>
        )}
      </header>
      <p className="muted small">{t('Each document belongs to a section; only people who can see that section can open it. Files are downloaded, never run in the browser.')}</p>
      {docs.length ? (
        <ul className="docs">
          {docs.map((d) => {
            const uploader = view.users.find((u) => u.id === d.uploadedBy);
            return (
              <li key={d.id} className="doc">
                <span className="doc-ico" aria-hidden="true">
                  <Icon name="file" size={22} />
                </span>
                <div className="doc-main">
                  <strong>{tc(d.title)}</strong>
                  {d.description && <p className="small">{tc(d.description)}</p>}
                  <div className="rec-meta">
                    <span className="chip chip-static">{t(DOMAIN_LABEL[d.domain])}</span>
                    <span className="chip chip-static">
                      {t(DOC_TYPES[d.mime] ?? d.mime)} · <span dir="ltr">{kb(d.size)}</span>
                    </span>
                    <span className={`src-badge src-${d.source}`}>{t(SOURCE_LABEL[d.source])}</span>
                    <small className="muted">{t('{name} · {when}', { name: tc(uploader?.name ?? ''), when: dateTime(d.uploadedAt) })}</small>
                  </div>
                </div>
                <div className="rec-actions">
                  <button type="button" className="btn btn-light btn-sm" disabled={busy === d.id} onClick={() => open(d)}>
                    <Icon name="download" size={14} /> {t('Download')}
                  </button>
                  {(d.uploadedBy === me.id || hasAuthority(view, me.id, recipientId, now)) && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setArchiving(d)}>
                      {t('Archive')}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty icon="file" title="No documents yet" text={canAdd ? 'Upload reports, letters or plans so the team can find them in one place.' : 'Documents shared with you will appear here.'} />
      )}
      {uploading && <UploadModal recipientId={recipientId} onClose={() => setUploading(false)} />}
      {archiving && (
        <Modal
          title={t('Archive {title}?', { title: tc(archiving.title) })}
          onClose={() => setArchiving(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setArchiving(null)}>
                {t('Cancel')}
              </button>
              <button
                type="button"
                className="btn btn-dark"
                disabled={reason.trim().length < 3}
                onClick={async () => {
                  const r = await act({ type: 'archive_document', documentId: archiving.id, reason });
                  if (r.ok) {
                    setArchiving(null);
                    setReason('');
                  }
                }}
              >
                {t('Archive')}
              </button>
            </>
          }
        >
          <Field label={t('Reason')}>
            <input id="doc-archive-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Modal>
      )}
    </section>
  );
}

function UploadModal({ recipientId, onClose }: { recipientId: string; onClose: () => void }) {
  const { view, backend, token, replaceView, toast } = useSession();
  const domains = domainOptions(view, recipientId);
  const [f, setF] = useState({ title: '', description: '', domain: (domains.includes('medical') ? 'medical' : domains[0]) as Domain });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const max = backend.mode === 'server' ? DOC_MAX_SERVER : DOC_MAX_INLINE;
  const pick = (x?: File) => {
    setError('');
    if (!x) return setFile(null);
    if (!DOC_TYPES[x.type]) return setError(t('Upload a PDF, PNG, JPEG, WebP or text file.'));
    if (x.size > max) return setError(t('This file is too large here (maximum {kb} KB)', { kb: Math.round(max / 1000) }));
    setFile(x);
    if (!f.title) setF({ ...f, title: x.name.replace(/\.[^.]+$/, '') });
  };
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    const dataBase64 = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
      r.readAsDataURL(file);
    });
    try {
      const res = await backend.uploadDocument(token, { recipientId, domain: f.domain, title: f.title, description: f.description, fileName: file.name, mime: file.type, dataBase64 });
      replaceView(res.view);
      toast(res.message, 'ok', res.m);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Upload a document')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn btn-dark" disabled={busy || !file || f.title.trim().length < 3} onClick={upload}>
            {t('Upload')}
          </button>
        </>
      }
    >
      <Field label={t('File')} hint={t('PDF, PNG, JPEG, WebP or text, up to {kb} KB here. The content is checked against the file type.', { kb: Math.round(max / 1000) })}>
        <input id="doc-file" type="file" accept={Object.keys(DOC_TYPES).join(',')} onChange={(e) => pick(e.target.files?.[0])} />
      </Field>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Field label={t('Title')}>
        <input id="doc-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </Field>
      <Field label={t('Section')} hint={t('Only people who can see this section can open the document.')}>
        <select id="doc-domain" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value as Domain })}>
          {domains.map((d) => (
            <option key={d} value={d}>
              {t(DOMAIN_LABEL[d])}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('Description (optional)')}>
        <textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
    </Modal>
  );
}
