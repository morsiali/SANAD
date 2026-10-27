import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp, DEMO_PASSWORD } from './app';
import { configFromEnv } from './config';

const port = Number(process.env.PORT ?? 4000);
const staticDir = resolve('dist');
const cfg = configFromEnv();

let started: ReturnType<typeof createApp>;
try {
  started = createApp({ dataFile: resolve(process.env.SANAD_DATA ?? 'data/sanad.json'), staticDir });
} catch (e) {
  console.error(`\n  SANAD could not start: ${(e as Error).message}\n`);
  process.exit(1);
}

const server = started.app.listen(port, () => {
  const ui = existsSync(staticDir) ? `http://localhost:${port}` : 'http://localhost:5173 (run "npm run dev")';
  console.log(`\n  SANAD API ready on http://localhost:${port}`);
  console.log(`  Open the app: ${ui}`);
  if (cfg.demo) console.log(`  Demo mode: sample people and accounts, password "${DEMO_PASSWORD}". Not for real data (set SANAD_DEMO=0).\n`);
  else console.log(`  Production mode: sessions last ${cfg.sessionHours} h; HSTS ${cfg.hsts ? 'on' : 'off'}; behind a proxy: ${cfg.trustProxy ? 'yes' : 'no'}.\n`);
});

// Finish requests in flight, then stop (data is saved after every change, so nothing is pending).
const stop = () => {
  started.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
