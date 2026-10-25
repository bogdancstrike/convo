import { expect, test, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeAll, createUser, enroll, message, newPage, send, startChat, type TestUser } from './support';

/**
 * ARCHIVE-01: the archive/bot runtime (deploy/convo-bot) signs in with the OAuth device grant,
 * enrolls as an integration device and then archives or answers. Requires the e2e service mounts
 * /bot (runtime) and /bot-core (core.js).
 */
test.skip(() => !existsSync('/bot/bot.mjs') || !existsSync('/bot-core/core.js'), 'runtime not mounted');

interface Runtime { process: ChildProcess; dataDir: string; output: () => string; operator: Page }

/** Starts the runtime, completes its device sign-in in a browser as `account` and waits until it is ready. */
async function startRuntime(browser: Browser, baseURL: string, account: TestUser, env: Record<string, string>): Promise<Runtime> {
  const dataDir = mkdtempSync(join(tmpdir(), 'convo-integration-'));
  let output = '';
  const child = spawn('node', ['/bot/bot.mjs'], {
    env: { ...process.env, CONVO_URL: baseURL, DATA_DIR: dataDir, CORE_JS: '/bot-core/core.js',
      PLAYWRIGHT_MODULE: '/e2e/node_modules/playwright/index.mjs', INSECURE_TLS: '1', ...env },
  });
  child.stdout!.on('data', (d) => { output += String(d); });
  child.stderr!.on('data', (d) => { output += String(d); });
  const operator = await newPage(browser);
  await expect.poll(() => /SIGN IN: open (\S+)/.exec(output)?.[1], { timeout: 60_000 }).toBeTruthy();
  await operator.goto(/SIGN IN: open (\S+)/.exec(output)![1]!);
  await operator.locator('#username').fill(account.username);
  await operator.locator('#password').fill(account.password);
  await operator.locator('#kc-login').click();
  // Keycloak asks the operator to grant the runtime access (device flow consent).
  await operator.getByRole('button', { name: 'Yes' }).click({ timeout: 30_000 });
  await expect(operator.getByText('Device Login Successful')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => output, { timeout: 90_000 }).toContain('signed in as account');
  return { process: child, dataDir, output: () => output, operator };
}

async function stop(runtime: Runtime | undefined) {
  if (!runtime) return;
  runtime.process.kill('SIGTERM');
  if (test.info().status !== test.info().expectedStatus) console.log(runtime.output().slice(-3000));
  await closeAll(runtime.operator);
}

test('archive mode: device sign-in, then group messages are archived in plaintext on its disk', async ({ browser, request, baseURL }) => {
  test.setTimeout(240_000);
  const [ownerU, archiveU] = await Promise.all([createUser(request, 'rtowner'), createUser(request, 'rtarchive')]);
  const owner = await newPage(browser);
  let runtime: Runtime | undefined;
  try {
    await enroll(owner, ownerU);
    runtime = await startRuntime(browser, baseURL!, archiveU, { BOT_MODE: 'archive' });

    owner.on('dialog', (d) => void d.accept());
    const groupName = `Runtime archive ${Date.now() % 10000}`;
    await owner.getByTestId('new-chat').click();
    await owner.getByTestId('new-group').click();
    await owner.getByTestId('people-search').fill(archiveU.username);
    await owner.getByTestId(`pick-${archiveU.username}`).click({ timeout: 30_000 });
    await owner.getByTestId('group-next').click();
    await owner.getByTestId('group-name').fill(groupName);
    await owner.getByTestId('review-group').click();
    await owner.getByTestId('create-group').click();
    await send(owner, 'quarterly numbers are final');

    const archive = join(runtime.dataDir, 'archive.jsonl');
    await expect.poll(() => (existsSync(archive) ? readFileSync(archive, 'utf8') : ''), { timeout: 90_000 }).toContain('quarterly numbers are final');
    const line = readFileSync(archive, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((l) => l.body === 'quarterly numbers are final');
    expect(line).toMatchObject({ conversation: groupName, kind: 'group', author: ownerU.name });
  } finally {
    await stop(runtime);
    await closeAll(owner);
  }
});

test('bot mode: the example handler answers a direct message', async ({ browser, request, baseURL }) => {
  test.setTimeout(240_000);
  const [personU, botU] = await Promise.all([createUser(request, 'rtperson'), createUser(request, 'rthelper')]);
  const person = await newPage(browser);
  let runtime: Runtime | undefined;
  try {
    await enroll(person, personU);
    runtime = await startRuntime(browser, baseURL!, botU, { BOT_MODE: 'bot', BOT_HANDLER: '/bot/examples/help-bot.mjs' });
    await startChat(person, botU, botU.name);
    await send(person, 'help please');
    await expect(message(person, 'I am a Convo bot. Try "time".')).toBeVisible({ timeout: 90_000 });
  } finally {
    await stop(runtime);
    await closeAll(person);
  }
});
