// Copies the data file and uploaded files into backups/<timestamp>/. Run with: npm run backup
// Safe while the server runs: the data file is always replaced in one step, never written in place.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const dataFile = resolve(process.env.SANAD_DATA ?? 'data/sanad.json');
const target = resolve(process.env.SANAD_BACKUP_DIR ?? 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
if (!existsSync(dataFile)) {
  console.error(`No data file at ${dataFile}`);
  process.exit(1);
}
mkdirSync(target, { recursive: true });
cpSync(dataFile, join(target, 'sanad.json'));
const files = join(dirname(dataFile), 'files');
if (existsSync(files)) cpSync(files, join(target, 'files'), { recursive: true });
console.log(`Backup written to ${target}`);
