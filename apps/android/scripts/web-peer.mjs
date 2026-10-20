import { chromium } from '/e2e/node_modules/playwright/index.mjs';
import { readFile, writeFile, access } from 'node:fs/promises';
const accounts = JSON.parse(await readFile('/run/accounts.json', 'utf8'));
const origin = 'https://192.168.1.144:8443';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: origin });
const peer = await context.newPage();
const state = async (stage, extra = {}) => { await writeFile('/run/io/state.json', JSON.stringify({ stage, ...extra })); console.log(stage); };
async function signIn(page, user, enrolled = true) {
  await page.goto('/', { waitUntil: 'domcontentloaded' }); await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Sign in with your organization' }).click();
  await page.locator('#username').fill(user.username); await page.locator('#password').fill(user.password); await page.locator('#kc-login').click();
  if (enrolled) await page.getByTestId('nav-settings').waitFor({ timeout: 60000 });
}
async function send(page, text) { await page.getByTestId('composer').fill(text); await page.getByTestId('composer').press('Enter'); }
async function expectText(page, text) { await page.getByTestId('message-body').getByText(text, { exact: true }).waitFor({ timeout: 90000 }); }
try {
  await signIn(peer, accounts.peer);
  await peer.getByTestId('new-chat').click(); await peer.getByTestId('directory-search').fill(accounts.android.username);
  await peer.getByTestId(`directory-${accounts.android.username}`).click(); await send(peer, 'Hello Android from the browser');
  await state('browser-message-sent');
  let previous = '';
  while (true) {
    let command; try { command = JSON.parse(await readFile('/run/io/command.json', 'utf8')); } catch { await new Promise((r) => setTimeout(r, 500)); continue; }
    if (command.id === previous) { await new Promise((r) => setTimeout(r, 300)); continue; } previous = command.id;
    if (command.action === 'verify') { await expectText(peer, 'Hello browser from Android'); await state('android-message-decrypted-on-web'); }
    if (command.action === 'media') {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64');
      await peer.getByTestId('file-input').setInputFiles([{ name: 'android-test.png', mimeType: 'image/png', buffer: png }, { name: 'android-secret.txt', mimeType: 'text/plain', buffer: Buffer.from('Encrypted file for Android') }]);
      await peer.getByTestId('preview-caption').fill('Encrypted photo and document from browser'); await peer.getByTestId('preview-send').click(); await state('encrypted-media-sent');
    }
    if (command.action === 'link') {
      const linkedContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: origin }); const linked = await linkedContext.newPage();
      await signIn(linked, accounts.android, false); await linked.getByTestId('link-code').waitFor(); const code = await linked.getByTestId('link-code').innerText(); await state('compare-link-code', { code });
      await linked.getByTestId('nav-settings').waitFor({ timeout: 180000 });
      await linked.locator('.chat-row > button.row').filter({ has: linked.locator('.row-title').getByText(accounts.peer.name, { exact: true }) }).click();
      await expectText(linked, 'Hello Android from the browser'); await expectText(linked, 'Hello browser from Android');
      await state('android-history-restored-in-linked-browser');
    }
    if (command.action === 'group') {
      await peer.getByTestId('nav-chats').click(); await peer.getByTestId('new-chat').click(); await peer.getByTestId('new-group').click();
      await peer.getByTestId('people-search').fill(accounts.android.username); await peer.getByTestId(`pick-${accounts.android.username}`).click();
      await peer.getByTestId('group-next').click(); await peer.getByTestId('group-name').fill('Android interoperability'); await peer.getByTestId('review-group').click(); await peer.getByTestId('create-group').click();
      await send(peer, 'Encrypted group hello from browser'); await state('group-message-sent');
    }
    if (command.action === 'verify-group') { await expectText(peer, 'Android group reply'); await state('android-group-reply-decrypted'); }
    if (command.action === 'stop') break;
  }
  await browser.close(); await state('finished');
} catch (error) { console.error(error.name, 'interop failed'); await state('failed', { name: error.name }); process.exitCode = 1; await browser.close(); }
