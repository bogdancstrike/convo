import { expect, test } from '@playwright/test';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeAll, createUser, enroll, newPage } from './support';

test('the deployment attachment limit blocks an oversized file before upload and lets the user recover', async ({ browser, request }) => {
  const info = await (await request.get('/v1/deployment-info')).json();
  const limit = info.limits.attachmentMaxBytes as number;
  expect(limit).toBeGreaterThan(0);
  const directory = await mkdtemp(join(tmpdir(), 'convo-limit-'));
  const path = join(directory, 'oversized.bin');
  const file = await open(path, 'w'); await file.truncate(limit + 1); await file.close();
  const page = await newPage(browser);
  try {
    await enroll(page, await createUser(request, 'filelimit'));
    await page.getByTestId('new-chat').click(); await page.getByTestId('note-to-self').click();
    let uploads = 0;
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/v1/attachments')) uploads++; });
    await page.getByTestId('file-input').setInputFiles(path);
    const preview = page.getByTestId('media-preview');
    await expect(preview.getByRole('alert')).toContainText(`larger than the ${limit / 1048576} MB limit`);
    // Oversized files cannot trigger upload or encryption. Removing them restores the composer.
    await expect(page.getByTestId('preview-send')).toBeDisabled();
    expect(uploads).toBe(0);
    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);
    await page.getByTestId('file-input').setInputFiles({ name: 'allowed.txt', mimeType: 'text/plain', buffer: Buffer.from('still able to send') });
    await page.getByTestId('preview-send').click();
    await expect(page.getByTestId('attachment-file')).toContainText('allowed.txt');
    expect(uploads).toBeGreaterThan(0);
  } finally { await closeAll(page); await rm(directory, { recursive: true, force: true }); }
});
