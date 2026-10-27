// Operational helpers: security headers, a small rate limiter, structured request logs and in-memory metrics.
import type { NextFunction, Request, Response } from 'express';

/** Fixed-window counter per key, e.g. failed sign-ins per email. */
export class Limiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  count(key: string, now = Date.now()): number {
    const list = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    this.hits.set(key, list);
    return list.length;
  }
  blocked(key: string, now = Date.now()): number {
    const list = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (list.length < this.max) return 0;
    return Math.ceil((list[0] + this.windowMs - now) / 1000);
  }
  hit(key: string, now = Date.now()) {
    const list = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.hits.clear(); // bounded memory under attack
  }
  clear(key: string) {
    this.hits.delete(key);
  }
}

/** Headers for every response. The app needs inline styles (React style attributes) and Google Fonts; nothing else external. */
export function securityHeaders(hsts: boolean) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (!res.getHeader('Content-Security-Policy')) res.setHeader('Content-Security-Policy', csp);
    if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

export interface Metrics {
  startedAt: number;
  requests: number;
  errors5xx: number;
  errors4xx: number;
  byRoute: Record<string, { n: number; ms: number; max: number }>;
  sweep: { runs: number; lastAt: number | null; lastMs: number; maxMs: number; failures: number };
  clientErrors: number;
  loginFailures: number;
  lockouts: number;
}

export const newMetrics = (): Metrics => ({ startedAt: Date.now(), requests: 0, errors5xx: 0, errors4xx: 0, byRoute: {}, sweep: { runs: 0, lastAt: null, lastMs: 0, maxMs: 0, failures: 0 }, clientErrors: 0, loginFailures: 0, lockouts: 0 });

/** Route name without ids, so logs and metrics never contain record ids or tokens. */
export const routeName = (method: string, path: string) =>
  `${method} ${path
    .split('?')[0]
    .replace(/\/api\/documents\/[^/]+/, '/api/documents/:id')
    .replace(/\/api\/invite\/[^/]+/, '/api/invite/:code')}`;

/** One JSON line per API request: route, status and time. No bodies, no query strings, no tokens. */
export function requestLog(metrics: Metrics, log: (line: string) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api/')) return next();
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const route = routeName(req.method, req.path);
      metrics.requests += 1;
      if (res.statusCode >= 500) metrics.errors5xx += 1;
      else if (res.statusCode >= 400) metrics.errors4xx += 1;
      const r = (metrics.byRoute[route] ??= { n: 0, ms: 0, max: 0 });
      r.n += 1;
      r.ms += ms;
      r.max = Math.max(r.max, ms);
      if (route !== 'GET /api/events') log(JSON.stringify({ t: new Date().toISOString(), level: res.statusCode >= 500 ? 'error' : 'info', route, status: res.statusCode, ms: Math.round(ms) }));
    });
    next();
  };
}
