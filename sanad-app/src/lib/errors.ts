// Unexpected errors in the browser are reported to the server (server mode only), briefly and without personal data:
// just the message and the page path. In the browser demo they stay in the console.
declare const __SANAD_MODE__: string;

let sent = 0;

export function reportError(message: string) {
  if (__SANAD_MODE__ === 'demo' || location.protocol === 'file:' || sent >= 10) return;
  sent += 1;
  const where = (location.hash || location.pathname).replace(/[?].*$/, '').replace(/\/(r|u|c|t|v|f)-?[a-z0-9]+/gi, '/:id');
  try {
    void fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: String(message).slice(0, 300), where }), keepalive: true }).catch(() => undefined);
  } catch {
    /* never let reporting cause another error */
  }
}

export function installErrorReporting() {
  window.addEventListener('error', (e) => reportError(e.message || 'error'));
  window.addEventListener('unhandledrejection', (e) => reportError(String((e.reason as Error)?.message ?? e.reason ?? 'rejection')));
}
