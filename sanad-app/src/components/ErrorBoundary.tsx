import { Component, type ReactNode } from 'react';
import { reportError } from '../lib/errors';
import { t } from '../lib/i18n';

/** If a page fails to draw, show a calm message instead of a blank screen, and report it (no personal data). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    reportError(error.message);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page" role="alert">
        <h1 className="display-s">{t('Something went wrong on this page')}</h1>
        <p className="muted">{t('Nothing you saved was lost. Reload the page to continue.')}</p>
        <button type="button" className="btn btn-dark" onClick={() => location.reload()}>
          {t('Reload')}
        </button>
      </div>
    );
  }
}
