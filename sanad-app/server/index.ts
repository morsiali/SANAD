import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp, DEMO_PASSWORD } from './app';

const port = Number(process.env.PORT ?? 4000);
const staticDir = resolve('dist');
const { app } = createApp({ dataFile: resolve(process.env.SANAD_DATA ?? 'data/sanad.json'), staticDir });

app.listen(port, () => {
  const ui = existsSync(staticDir) ? `http://localhost:${port}` : 'http://localhost:5173 (run "npm run dev")';
  console.log(`\n  SANAD API ready on http://localhost:${port}`);
  console.log(`  Open the app: ${ui}`);
  console.log(`  Demo sign-in: any account, password "${DEMO_PASSWORD}"\n`);
});
