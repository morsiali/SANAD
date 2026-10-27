import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { t } from '../lib/i18n';
import { AssistantPage } from '../components/assistant';
import { Sparkle } from '../components/ui';

// "Ask SANAD": the full-page version of the assistant (the same one that opens beside every page).
export function Intelligence() {
  const [sp] = useSearchParams();
  const q = sp.get('q');
  const person = sp.get('person');
  const initial = useMemo(() => (q ? { question: q, recipientId: person } : null), [q, person]);
  return (
    <div className="page intel-page">
      <section className="intel-hero">
        <Sparkle size={40} />
        <h1 className="display">{t('Don’t search. Just ask.')}</h1>
        <p className="lede">
          {t('Ask about a person, a problem or what to do next. SANAD answers only from what you are allowed to see, shows the records it used, and prepares drafts you review before anything is created.')}
        </p>
      </section>
      <AssistantPage key={q ?? ''} initial={initial} />
    </div>
  );
}
