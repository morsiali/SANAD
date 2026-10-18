// End-to-end walkthrough: drives the real app in Chromium as several people at once.
// Usage: npm run build && npm run e2e   (set CHROMIUM_PATH to use a specific browser binary)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = 4123;
const BASE = `http://localhost:${PORT}/#`;
const dataDir = mkdtempSync(join(tmpdir(), 'sanad-e2e-'));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT), SANAD_DATA: join(dataDir, 'db.json') }, stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server did not start')), 15000);
  server.stdout.on('data', (d) => d.toString().includes('ready') && (clearTimeout(t), resolve()));
  server.stderr.on('data', (d) => process.stderr.write(d));
});

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const problems = [];
let passed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    problems.push(`${name}: ${e.message.split('\n')[0]}`);
    console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`);
  }
};

async function person(email, viewport = { width: 1360, height: 900 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`[${email}] page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('fonts.g') && !m.text().includes('status of 401') && problems.push(`[${email}] console: ${m.text()}`));
  page.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && problems.push(`[${email}] ${r.status()} ${r.url()}`));
  if (email) {
    await page.goto(`${BASE}/signin`);
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', 'sanad123');
    await page.click('form button[type=submit]');
    await page.getByRole('heading', { level: 1 }).filter({ hasText: /Good (morning|afternoon|evening)/ }).waitFor();
  }
  return page;
}
const text = (page, t, opts = {}) => page.getByText(t, opts).first().waitFor({ timeout: 8000 });
const go = async (page, path) => {
  await page.goto(`${BASE}${path}`);
  await page.waitForTimeout(250);
};
const btn = (page, name) => page.getByRole('button', { name, exact: true }).first();
const modalBtn = (page, name) => page.locator('.modal').getByRole('button', { name, exact: true });

console.log('\nWebsite');
const visitor = await person(null);
await step('landing hero and live routing demo', async () => {
  await go(visitor, '/home');
  await text(visitor, 'Every care problem reaches the person who can solve it');
  await visitor.getByLabel('Describe a care problem to see where it goes').fill('The driver never came for the pickup');
  await visitor.locator('.live-node-on', { hasText: 'Transport' }).waitFor();
});
await step('role tabs, FAQ accordion and anchor links', async () => {
  await visitor.getByRole('tab', { name: 'Pharmacy' }).click();
  await text(visitor, 'Refills before anyone runs out');
  await visitor.getByRole('button', { name: 'What happens if nobody responds?' }).click();
  await text(visitor, 'escalates to the care coordinator automatically');
  for (const id of ['teams', 'how', 'intelligence', 'faq']) if (!(await visitor.locator(`#${id}`).count())) throw new Error(`missing #${id}`);
});
await step('“Try the pharmacy dashboard” signs in', async () => {
  await visitor.getByRole('button', { name: 'Try the pharmacy dashboard' }).click();
  await text(visitor, 'Good', { exact: false });
  await visitor.waitForURL(/#\/app$/);
});
await step('wrong password shows a clear error', async () => {
  const p = await person(null);
  await go(p, '/signin');
  await p.fill('input[type=email]', 'mariam@sanad.ae');
  await p.fill('input[type=password]', 'wrong');
  await p.click('form button[type=submit]');
  await text(p, 'do not match');
  await p.context().close();
});

console.log('\nEvery page for every role');
const roles = ['mariam@sanad.ae', 'aisha@sanad.ae', 'kareem@sanad.ae', 'sara@sanad.ae', 'yousef@sanad.ae', 'omar@sanad.ae', 'noura@sanad.ae'];
for (const email of roles) {
  await step(`${email.split('@')[0]}: all navigation links open real pages`, async () => {
    const p = await person(email);
    const links = await p.locator('.side-nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  links.push('#/app/team?tab=people', '#/app/team?tab=people&group=need');
    if (links.length < 10) throw new Error(`only ${links.length} nav links`);
    for (const href of links) {
      await p.goto(`http://localhost:${PORT}/${href}`);
      await p.getByRole('heading', { level: 1 }).first().waitFor();
      if (await p.getByText('This page doesn’t exist').count()) throw new Error(`dead link ${href}`);
    }
    await p.context().close();
  });
}

console.log('\nCross-role workflow (live, two windows)');
const mariam = await person('mariam@sanad.ae');
const omar = await person('omar@sanad.ae');
let challengeUrl = '';
await step('family reports a problem and sees where it will go before sending', async () => {
  await go(mariam, '/app/report');
  await mariam.getByLabel('What’s the problem?').fill('Inhaler running low, need a refill');
  await mariam.getByLabel('Details').fill('Only a few puffs left, pharmacy delivery please');
  await mariam.locator('.route-preview').getByText('Omar Farouk').waitFor();
  await btn(mariam, 'Send to the right person').click();
  await mariam.waitForURL(/challenges\/c/);
  challengeUrl = mariam.url();
  await text(mariam, 'Inhaler running low, need a refill');
});
await step('pharmacist sees it arrive live, without reloading', async () => {
  await omar.getByText('Inhaler running low, need a refill').first().waitFor({ timeout: 10000 });
});
await step('pharmacist accepts, applies the suggested playbook and ticks every step', async () => {
  await omar.goto(challengeUrl.replace(/:\d+\//, `:${PORT}/`));
  await btn(omar, 'Accept').click();
  await text(omar, 'Accepted');
  await omar.locator('.rec').first().getByRole('button', { name: 'Apply' }).click();
  await text(omar, 'From “');
  const boxes = omar.locator('.checklist input[type=checkbox]');
  const n = await boxes.count();
  if (n < 3) throw new Error(`expected checklist, got ${n}`);
  for (let i = 0; i < n; i++) {
    await boxes.nth(i).check();
    await omar.waitForTimeout(120);
  }
  await text(omar, 'All steps are done.');
});
await step('family comments and the pharmacist sees it live', async () => {
  await mariam.getByLabel('Comment').fill('Thank you! Please call before delivery.');
  await btn(mariam, 'Post').click();
  await omar.getByText('Please call before delivery.').waitFor({ timeout: 10000 });
});
await step('pharmacist resolves with a note', async () => {
  await btn(omar, 'Resolve now').click();
  await omar.getByLabel('What did you do?').fill('Delivered a new inhaler at 3pm, called ahead.');
  await modalBtn(omar, 'Mark resolved').click();
  await text(omar, 'waiting for confirmation');
});
await step('family confirms the fix live with a rating; challenge closes', async () => {
  await btn(mariam, 'Confirm fix').waitFor({ timeout: 10000 });
  await btn(mariam, 'Confirm fix').click();
  await mariam.getByRole('button', { name: '4 out of 5' }).click();
  await modalBtn(mariam, 'Confirm and close').click();
  await mariam.locator('.stepper li.current', { hasText: 'Closed' }).waitFor();
});
await step('family can reopen and the owner is notified', async () => {
  await btn(mariam, 'Reopen').click();
  await mariam.getByLabel('What is still wrong?').fill('Wrong strength was delivered');
  await modalBtn(mariam, 'Reopen').click();
  await text(mariam, 'Reopened 1×');
  await go(omar, '/app/inbox');
  await text(omar, 'was reopened');
  await btn(omar, 'Mark all as read').click();
  await omar.getByRole('tab', { name: 'Unread (0)' }).waitFor();
});
await step('pharmacist hands it off to the doctor with a reason', async () => {
  await omar.goto(challengeUrl.replace(/:\d+\//, `:${PORT}/`));
  await btn(omar, 'Hand off').click();
  await omar.getByRole('radio', { name: 'Doctor' }).click();
  await omar.getByLabel('Why does it belong there?').fill('Needs a new prescription for a different strength');
  await modalBtn(omar, 'Hand off').click();
  await text(omar, 'Handed off to');
});

console.log('\nCoordinator tools');
const sara = await person('sara@sanad.ae');
await step('triage: route an unmatched problem to a team', async () => {
  await go(sara, '/app/challenges?stage=reported&scope=all');
  await sara.getByText('Something is wrong with the majlis').click();
  await btn(sara, 'Route to a team').click();
  await sara.getByRole('radio', { name: 'Social services' }).click();
  await sara.getByLabel('Why does it belong there?').fill('AC broken — home adaptation fund');
  await modalBtn(sara, 'Hand off').click();
  await sara.locator('.stepper li.current', { hasText: 'Routed' }).waitFor();
});
await step('escalate, then clear escalation', async () => {
  await btn(sara, 'Escalate').click();
  await sara.getByLabel('What is blocking it?').fill('Heat is dangerous for Hamad');
  await modalBtn(sara, 'Escalate').click();
  await text(sara, 'Escalated · Heat is dangerous');
  await btn(sara, 'Clear escalation').click();
  await text(sara, 'Escalation cleared');
});
await step('reassign to a specific person and change priority', async () => {
  await btn(sara, 'Reassign').click();
  await sara.locator('.pick', { hasText: 'Joseph Mathew' }).click();
  await sara.getByLabel('Note for the new owner').fill('Joseph is visiting Hamad today');
  await modalBtn(sara, 'Assign').click();
  await text(sara, 'Assigned to Joseph Mathew');
  await sara.getByLabel('Change priority').selectOption('high');
  await text(sara, 'Priority set to high');
});
await step('board view: drag a routed card to accepted', async () => {
  await go(sara, '/app/challenges?scope=all');
  await btn(sara, 'Board').click();
  const card = sara.locator('section[aria-label="Routed"] .card').first();
  const title = (await card.locator('strong').textContent()) ?? '';
  await sara.evaluate(() => window.scrollTo(0, 0));
  const from = await card.boundingBox();
  const to = await sara.locator('section[aria-label="Accepted"] header').boundingBox();
  await sara.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await sara.mouse.down();
  await sara.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 12 });
  await sara.mouse.up();
  await sara.locator('section[aria-label="Accepted"] .card', { hasText: title }).waitFor();
  await btn(sara, 'List').click();
});
await step('list filters, search and sort', async () => {
  await go(sara, '/app/challenges?scope=all');
  await sara.getByLabel('Search challenges').fill('brake');
  await text(sara, '1 challenge');
  await btn(sara, 'Clear filters').click();
  await sara.getByLabel('Priority').selectOption('urgent');
  await sara.getByLabel('Sort').selectOption('newest');
  await sara.getByLabel('Include solved').check();
  await sara.getByLabel('Priority').selectOption('');
});
await step('routing rules: test, create, edit, toggle and delete a rule', async () => {
  await go(sara, '/app/routing');
  await sara.getByLabel('Describe a problem to test routing').fill('the oxygen machine stopped');
  await sara.locator('.sandbox-out').getByText('Social services').waitFor();
  await btn(sara, 'New rule').click();
  await sara.getByLabel('Rule name').fill('Home oxygen');
  await sara.getByLabel('Send to').selectOption('doctor');
  await sara.getByLabel('Keywords and phrases').fill('oxygen machine, oxygen');
  await modalBtn(sara, 'Save rule').click();
  await text(sara, 'Rule created');
  await sara.getByLabel('Describe a problem to test routing').fill('the oxygen machine stopped');
  await sara.locator('.sandbox-out').getByText('Doctor').waitFor();
  await sara.getByRole('button', { name: 'Edit Home oxygen' }).click();
  await sara.getByLabel('Rule name').fill('Home oxygen supply');
  await modalBtn(sara, 'Save rule').click();
  await text(sara, 'Rule updated');
  await sara.locator('.rule', { hasText: 'Home oxygen supply' }).locator('.switch').click();
  await sara.locator('.rule-off', { hasText: 'Home oxygen supply' }).waitFor();
  await sara.getByRole('button', { name: 'Delete Home oxygen supply' }).click();
  await text(sara, 'Rule deleted');
});
await step('response-time settings save', async () => {
  await sara.getByLabel('urgent response minutes').fill('45');
  await btn(sara, 'Save settings').click();
  await text(sara, 'Settings saved');
});
await step('team: add a member, set availability, add a person we care for', async () => {
  await go(sara, '/app/team');
  await btn(sara, 'Add team member').click();
  await sara.getByLabel('Full name').fill('Hessa Ali');
  await sara.getByLabel('Email').fill('hessa@sanad.ae');
  await sara.getByLabel('Skills').fill('wound, insulin');
  await modalBtn(sara, 'Add member').click();
  await text(sara, 'Hessa Ali added');
  const card = sara.locator('.person-card', { hasText: 'Yousef Karim' });
  await card.locator('.switch').click();
  await text(sara, 'Yousef Karim is away');
  await card.locator('.switch').click();
  await sara.getByRole('tab', { name: 'People we care for' }).click();
  await btn(sara, 'Add person').click();
  await sara.getByLabel('Full name').fill('Salem Rashid');
  await sara.getByLabel('Area').fill('Jumeirah, Dubai');
  await modalBtn(sara, 'Add person').click();
  await text(sara, 'Salem Rashid added');
});
await step('new team member can sign in', async () => {
  const hessa = await person('hessa@sanad.ae');
  await hessa.context().close();
});
await step('playbooks: search, create, open, apply, edit, delete', async () => {
  await go(sara, '/app/playbooks');
  await sara.getByLabel('Search playbooks').fill('driver did not come');
  await sara.locator('.pb-card').first().getByText('Missed or late ride recovery').waitFor();
  await sara.getByLabel('Search playbooks').fill('');
  await btn(sara, 'New playbook').click();
  await sara.getByLabel('Title').fill('Cool the room in a heatwave');
  await sara.getByLabel('Step 1', { exact: true }).fill('Check the AC unit and filters');
  await sara.getByLabel('Step 2', { exact: true }).fill('Bring a portable cooler');
  await modalBtn(sara, 'Publish playbook').click();
  await text(sara, 'Playbook published');
  await sara.locator('.pb-card', { hasText: 'Cool the room in a heatwave' }).click();
  await btn(sara, 'Edit').click();
  await sara.getByLabel('Minutes').fill('40');
  await modalBtn(sara, 'Save changes').click();
  await text(sara, 'Playbook updated');
  await sara.locator('.pb-card', { hasText: 'Cool the room in a heatwave' }).click();
  await btn(sara, 'Delete').click();
  await text(sara, 'Playbook deleted');
});
await step('Ask SANAD answers questions with live cards', async () => {
  await go(sara, '/app/intelligence');
  await sara.locator('.starter', { hasText: 'Which challenges are overdue?' }).click();
  await sara.locator('.turn-body p').first().waitFor();
  await sara.getByLabel('Ask SANAD').last().fill('Who handles a broken wheelchair?');
  await btn(sara, 'Ask').click();
  await sara.locator('.route-card').getByText('Social services').waitFor();
  await sara.getByRole('link', { name: 'Report this' }).click();
  await sara.waitForURL(/report\?title=/);
  if ((await sara.getByLabel('What’s the problem?').inputValue()).length < 4) throw new Error('report not prefilled');
});
await step('top bar question jumps to Ask SANAD', async () => {
  await go(sara, '/app');
  await sara.locator('.topbar').getByLabel('Ask SANAD').fill('How is Hamad doing?');
  await sara.locator('.topbar').getByLabel('Ask SANAD').press('Enter');
  await text(sara, 'Hamad has');
});
await step('insights: time ranges and table view', async () => {
  await go(sara, '/app/analytics');
  await btn(sara, '30 days').click();
  await btn(sara, 'Show table').click();
  await sara.locator('.data-table').waitFor();
  await btn(sara, 'Show chart').click();
});
await step('settings: profile, export, password and reset', async () => {
  await go(sara, '/app/settings');
  await sara.getByLabel('Job title').fill('Lead care coordinator');
  await btn(sara, 'Save profile').click();
  await text(sara, 'Profile saved');
  const [dl] = await Promise.all([sara.waitForEvent('download'), btn(sara, 'Export my data').click()]);
  if (!dl.suggestedFilename().endsWith('.json')) throw new Error('export not json');
  await sara.getByLabel('Current password').fill('sanad123');
  await sara.getByLabel('New password', { exact: true }).fill('coordinator1');
  await sara.getByLabel('Repeat new password').fill('coordinator1');
  await btn(sara, 'Change password').click();
  await text(sara, 'Password changed');
  await btn(sara, 'Reset demo data').click();
  await modalBtn(sara, 'Reset everything').click();
  await text(sara, 'Demo workspace reset');
});

console.log('\nCaregiver & mobile');
await step('caregiver claims, starts and toggles availability; work rebalances', async () => {
  const aisha = await person('aisha@sanad.ae');
  await go(aisha, '/app/challenges?scope=mine');
  await aisha.getByText('Mum missed her morning tablets').click();
  await btn(aisha, 'Accept').click();
  await btn(aisha, 'Start work').click();
  await aisha.locator('.stepper li.current', { hasText: 'In progress' }).waitFor();
  await aisha.getByLabel('New step').fill('Call Mariam to confirm the evening dose');
  await btn(aisha, 'Add').click();
  await text(aisha, 'Call Mariam to confirm the evening dose');
  await btn(aisha, 'Follow').click();
  await btn(aisha, 'Following').waitFor();
  await go(aisha, '/app/settings');
  await aisha.locator('.switch').first().click();
  await text(aisha, 'You are away');
  await aisha.locator('.switch').first().click();
  await aisha.context().close();
});
await step('mobile: menu drawer opens and navigates', async () => {
  const m = await person('mariam@sanad.ae', { width: 390, height: 844 });
  await m.getByRole('button', { name: 'Open menu' }).click();
  await m.locator('.side-open').getByRole('link', { name: 'Playbooks' }).click();
  await m.getByRole('heading', { name: 'Playbooks' }).waitFor();
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error('horizontal scroll on mobile');
  await m.getByRole('button', { name: 'Account menu' }).click();
  await m.getByRole('menuitem', { name: 'Sign out' }).click();
  await m.waitForURL(/signin/);
  await m.context().close();
});

console.log('\nStart page');
await step('a new visit opens on sign-in, and the session ends with the tab', async () => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`http://localhost:${PORT}/`);
  await p.getByRole('heading', { name: 'Sign in' }).waitFor();
  await p.locator('.acct', { hasText: 'Mariam Al Noor' }).click();
  await p.waitForURL(/#\/app$/);
  await p.close();
  const again = await ctx.newPage();
  await again.goto(`http://localhost:${PORT}/#/app`);
  await again.getByRole('heading', { name: 'Sign in' }).waitFor();
  await again.goto(`http://localhost:${PORT}/#/home`);
  await again.getByText('Every care problem reaches the person who can solve it').waitFor();
  await ctx.close();
});

console.log('\nCreate account');
await step('a family member signs up with the person they care for and reports a problem', async () => {
  const p = await person(null);
  await go(p, '/');
  await p.getByRole('link', { name: 'Create an account' }).click();
  await p.getByRole('heading', { name: 'How will you use SANAD?' }).waitFor();
  await p.getByRole('radio', { name: /Family/ }).click();
  await p.getByRole('button', { name: 'Continue as Family' }).click();
  await p.locator('#reg-name').fill('Reem Saleh');
  await p.locator('#reg-email').fill('reem@example.ae');
  await p.locator('#reg-password').fill('reem12345');
  await p.locator('#reg-confirm').fill('reem12345');
  await p.locator('#reg-rname').fill('Salem Saleh');
  await p.locator('#reg-rage').fill('81');
  await p.locator('#reg-rarea').fill('Jumeirah, Dubai');
  await p.locator('#reg-rnote').fill('Dialysis on Mondays and Thursdays. Lives alone.');
  await p.getByText('Suggested from the care note').waitFor();
  if ((await p.locator('#reg-care-support-high').getAttribute('aria-checked')) !== 'true') throw new Error('high support should be suggested');
  if ((await p.locator('#reg-care-living-alone').getAttribute('aria-checked')) !== 'true') throw new Error('lives alone should be suggested');
  if (!(await p.locator('#reg-care-need-renal').isChecked())) throw new Error('dialysis need should be ticked');
  await p.getByRole('button', { name: 'Create account' }).click();
  await p.getByRole('heading', { level: 1 }).filter({ hasText: 'Reem' }).waitFor();
  await p.getByText('Salem Saleh').first().waitFor();
  await p.locator('.person .care-level', { hasText: 'High support' }).waitFor();
  await go(p, '/app/report');
  await p.getByLabel('What’s the problem?').fill('Need a ride to the clinic on Monday');
  await p.locator('.route-preview').getByText('Yousef Karim').waitFor();
  await btn(p, 'Send to the right person').click();
  await p.waitForURL(/challenges\/c/);
  await p.context().close();
});
await step('a caregiver signs up; coordinator links them to a family', async () => {
  const p = await person(null);
  await go(p, '/register');
  await p.getByRole('radio', { name: /Caregiver/ }).click();
  await p.getByRole('button', { name: 'Continue as Caregiver' }).click();
  await p.locator('#reg-name').fill('Hessa Ali');
  await p.locator('#reg-email').fill('hessa.ali@example.ae');
  await p.locator('#reg-password').fill('hessa12345');
  await p.locator('#reg-confirm').fill('hessa12346');
  await p.getByText('The passwords do not match').waitFor();
  if (await btn(p, 'Create account').isEnabled()) throw new Error('should block mismatched passwords');
  await p.locator('#reg-confirm').fill('hessa12345');
  await p.locator('#reg-skills').fill('wound, insulin');
  await btn(p, 'Create account').click();
  await p.getByRole('heading', { level: 1 }).filter({ hasText: 'Hessa' }).waitFor();
  await p.context().close();
  const sara = await person('sara@sanad.ae');
  await go(sara, '/app/inbox');
  await sara.getByText('Hessa Ali joined as Caregiver').waitFor();
  await go(sara, '/app/team');
  await sara.locator('.person-card', { hasText: 'Hessa Ali' }).getByRole('button', { name: 'Edit details' }).click();
  await sara.locator('.modal').getByLabel('Fatima Al Noor').check();
  await modalBtn(sara, 'Save changes').click();
  await text(sara, 'Hessa Ali updated');
  await sara.locator('.person-card', { hasText: 'Hessa Ali' }).getByText('Supports Fatima').waitFor();
  await sara.context().close();
});
await step('coordinator accounts cannot be self-registered', async () => {
  const p = await person(null);
  await go(p, '/register');
  if (await p.getByRole('radio', { name: /Care coordinator/ }).isEnabled()) throw new Error('coordinator should be invite-only');
  await p.context().close();
});

console.log('\nCare categories');
await step('coordinator sees people grouped and filtered by care category', async () => {
  const p = await person('sara@sanad.ae');
  await go(p, '/app/team');
  await p.getByRole('tab', { name: 'People we care for' }).click();
  await p.locator('.care-tile').first().waitFor();
  if ((await p.locator('.care-tile').count()) !== 3) throw new Error('expected 3 support tiles');
  await p.locator('.care-group-head', { hasText: 'High support' }).waitFor();
  await p.locator('.care-tile', { hasText: 'High support' }).click();
  await p.locator('.person-card', { hasText: 'Hamad Al Mansoori' }).waitFor();
  if (await p.locator('.person-card', { hasText: 'Fatima Al Noor' }).count()) throw new Error('filter should hide Fatima');
  await p.locator('.care-tile', { hasText: 'High support' }).click();
  await p.locator('.care-toolbar .seg').getByRole('button', { name: 'Care need' }).click();
  await p.locator('.care-group-head', { hasText: 'Kidney care & dialysis' }).waitFor();
  await p.locator('.care-toolbar .chip-select').getByRole('button', { name: 'Lives alone' }).click();
  await p.locator('.person-card', { hasText: 'Khadija Saeed' }).first().waitFor();
  if (await p.locator('.person-card', { hasText: 'Hamad Al Mansoori' }).count()) throw new Error('lives-alone filter should hide Hamad');
  await p.locator('.care-toolbar .chip-select').getByRole('button', { name: 'All needs' }).click();
  await go(p, '/app/analytics');
  await p.getByRole('heading', { name: 'Challenges by care group' }).waitFor();
  await p.context().close();
});
await step('family edits a care profile; challenges filter by care group', async () => {
  const p = await person('mariam@sanad.ae');
  await go(p, '/app/team?tab=people');
  await p.locator('.person-card', { hasText: 'Fatima Al Noor' }).getByRole('button', { name: 'Edit care profile' }).click();
  await p.locator('.modal #edit-care-support-high').click();
  await p.locator('.modal #edit-care-need-memory').check();
  await modalBtn(p, 'Save changes').click();
  await text(p, 'Care profile for Fatima Al Noor saved');
  const card = p.locator('.person-card', { hasText: 'Fatima Al Noor' });
  await card.locator('.care-level', { hasText: 'High support' }).waitFor();
  await card.getByText('Memory & cognition').waitFor();
  await go(p, '/app/challenges?care=support:independent');
  await p.getByRole('heading', { level: 1 }).first().waitFor();
  await p.waitForTimeout(400);
  if (await p.locator('.challenge-row, .crow, a[href*="/app/challenges/c"]').count()) throw new Error('no independent people, list should be empty');
  await go(p, '/app/challenges?care=support:high');
  await p.locator('a[href*="/app/challenges/c"]').first().waitFor();
  await p.context().close();
  const sara = await person('sara@sanad.ae');
  await go(sara, '/app/inbox');
  await sara.getByText('Mariam Al Noor updated the care profile for Fatima Al Noor').waitFor();
  await sara.context().close();
});
await step('carers cannot edit care profiles', async () => {
  const p = await person('aisha@sanad.ae');
  await go(p, '/app/team?tab=people');
  await p.locator('.person-card').first().waitFor();
  if (await p.getByRole('button', { name: 'Edit care profile' }).count()) throw new Error('carer should not see edit');
  await p.context().close();
});

console.log('\nWorkflow');
await step('in-app workflow map shows live counts and step details', async () => {
  const p = await person('sara@sanad.ae');
  await p.locator('.side-nav a[href="#/app/workflow"]').click();
  await p.getByRole('heading', { name: 'How SANAD works' }).waitFor();
  if ((await p.locator('.wf-node').count()) !== 13) throw new Error('expected 13 steps');
  if (!(await p.locator('.wf-count').count())) throw new Error('no live counts');
  await p.getByRole('button', { name: 'Review escalation' }).click();
  await p.locator('.wf-detail h3', { hasText: 'Review escalation' }).waitFor();
  await p.getByRole('button', { name: 'Next step' }).click();
  await p.locator('.wf-detail h3', { hasText: 'Resolve with a note' }).waitFor();
  await p.getByRole('button', { name: 'Review escalation' }).click();
  await p.getByRole('link', { name: 'Open these challenges' }).click();
  await p.waitForURL(/flag=escalated/);
  await p.context().close();
});
await step('role filter highlights each role’s part', async () => {
  const p = await person('mariam@sanad.ae');
  await go(p, '/app/workflow');
  await p.locator('.wf-roles').getByRole('button', { name: 'Family', exact: true }).waitFor();
  const dimmed = await p.locator('.wf-node.wf-dim').count();
  if (!dimmed) throw new Error('family view should dim team-only steps');
  await p.locator('.wf-roles').getByRole('button', { name: 'Everyone' }).click();
  if (await p.locator('.wf-node.wf-dim').count()) throw new Error('everyone view should show all steps');
  await p.context().close();
});
await step('public workflow page works without signing in', async () => {
  const p = await person(null);
  await go(p, '/home');
  await p.getByRole('link', { name: 'See the full workflow' }).click();
  await p.getByRole('heading', { name: 'How SANAD works' }).waitFor();
  await p.getByRole('button', { name: 'Pick the best person' }).click();
  await p.getByText('Chooses the available person with matching skills').waitFor();
  await p.context().close();
});

console.log('\nArabic');
const englishLeft = async (page) =>
  page.evaluate(() => {
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const el = n.parentElement;
      if (!el || el.closest('script,style,svg,[data-raw],code,input,textarea')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const typed = /^(Hessa|Ali|Reem|Salem|Saleh|Jumeirah|Dubai)$/; // names and places typed by people who signed up during this run
      if (n.nodeValue.trim() === 'Dialysis on Mondays and Thursdays. Lives alone.') continue; // a care note typed during this run
      const words = n.nodeValue.split(/[\s·,()“”«»:]+/).filter((x) => /[A-Za-z]{3,}/.test(x) && !typed.test(x) && !/^(SAN-\d+|SANAD|English|sanad123|[\w.]+@[\w.]+|mmol\/L|JSON|SAN)$/.test(x));
      if (words.length) out.push(n.nodeValue.trim());
    }
    return out;
  });
await step('language switch turns the site Arabic and right-to-left', async () => {
  const p = await person(null);
  await go(p, '/home');
  await p.getByRole('button', { name: 'التبديل إلى العربية' }).click();
  await p.getByText('كل مشكلة رعاية تصل إلى من يستطيع حلها').waitFor();
  if ((await p.evaluate(() => document.documentElement.dir)) !== 'rtl') throw new Error('not rtl');
  const left = await englishLeft(p);
  if (left.length) throw new Error(`English left: ${left.slice(0, 3).join(' | ')}`);
  await p.context().close();
});
await step('Arabic report is routed by Arabic keywords', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('sanad.lang', 'ar'));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problems.push(`[ar] page error: ${e.message}`));
  await go(p, '/signin');
  await p.fill('input[type=email]', 'mariam@sanad.ae');
  await p.fill('input[type=password]', 'sanad123');
  await p.click('form button[type=submit]');
  await p.getByRole('heading', { level: 1 }).filter({ hasText: 'يا' }).waitFor();
  await go(p, '/app/report');
  await p.getByLabel('ما المشكلة؟').fill('نفدت أقلام الإنسولين لأمي');
  await p.locator('.route-preview').getByText('عمر فاروق').waitFor();
  await p.getByRole('button', { name: 'أرسل إلى الشخص المناسب' }).click();
  await p.waitForURL(/challenges\/c/);
  await p.getByText('نفدت أقلام الإنسولين لأمي').first().waitFor();
  await ctx.close();
});
await step('every page reads fully in Arabic (coordinator)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('sanad.lang', 'ar'));
  const p = await ctx.newPage();
  await go(p, '/signin');
  await p.fill('input[type=email]', 'sara@sanad.ae');
  await p.fill('input[type=password]', 'sanad123');
  await p.click('form button[type=submit]');
  await p.getByRole('heading', { level: 1 }).first().waitFor();
  const links = await p.locator('.side-nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  links.push('#/app/team?tab=people', '#/app/team?tab=people&group=need');
  const leftovers = [];
  for (const href of links) {
    await p.goto(`http://localhost:${PORT}/${href}`);
    await p.getByRole('heading', { level: 1 }).first().waitFor();
    await p.waitForTimeout(200);
    for (const x of await englishLeft(p)) leftovers.push(`${href}: ${x}`);
  }
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error('horizontal scroll in RTL');
  if (leftovers.length) throw new Error(`English left: ${leftovers.slice(0, 4).join(' | ')}`);
  await p.locator('.side-nav a[href="#/app/settings"]').click();
  await p.getByRole('heading', { name: 'الإعدادات' }).waitFor();
  await p.locator('.seg button', { hasText: 'English' }).click();
  await p.getByRole('heading', { name: 'Settings' }).waitFor();
  await ctx.close();
});

await browser.close();
server.kill();
rmSync(dataDir, { recursive: true, force: true });
console.log(`\n${passed} checks passed, ${problems.length} problem(s)`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length ? 1 : 0);
