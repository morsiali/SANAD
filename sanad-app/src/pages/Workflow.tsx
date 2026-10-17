import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { createSeed } from '../../shared/seed';
import { useSession } from '../lib/store';
import { t } from '../lib/i18n';
import { LangToggle } from '../lib/lang';
import { countsFromView, WorkflowMap } from '../components/WorkflowMap';
import { Logo } from '../components/ui';

/** Inside the app: the workflow with live counts and links into the matching challenges. */
export function WorkflowPage() {
  const { view, me } = useSession();
  const counts = useMemo(() => countsFromView(view), [view]);
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="display-s">{t('How SANAD works')}</h1>
          <p className="muted">{t('Every problem follows the same path, from the moment it is reported until the family confirms it is solved. The numbers show where work sits right now.')}</p>
        </div>
      </header>
      <WorkflowMap counts={counts} initialRole={me.role} settings={view.settings} linkable />
    </div>
  );
}

/** Public version: no sign-in needed. `standalone` hides links into the app. */
export function PublicWorkflow({ standalone = false }: { standalone?: boolean }) {
  const settings = useMemo(() => createSeed().settings, []);
  return (
    <div className="site">
      <header className="site-nav">
        {standalone ? (
          <Logo />
        ) : (
          <Link to="/" aria-label="SANAD home">
            <Logo />
          </Link>
        )}
        <div className="row gap-s">
          <LangToggle />
          {!standalone && (
            <Link to="/signin" className="btn btn-dark btn-sm">
              {t('Get started')}
            </Link>
          )}
        </div>
      </header>
      <section className="wf-hero">
        <p className="grad-label">{t('Care coordination for families in the UAE')}</p>
        <h1 className="display-l">{t('How SANAD works')}</h1>
        <p className="lede">{t('Every problem follows the same path, from the moment it is reported until the family confirms it is solved.')}</p>
      </section>
      <WorkflowMap settings={settings} />
    </div>
  );
}
