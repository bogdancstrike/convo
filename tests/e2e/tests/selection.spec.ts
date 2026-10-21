import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, message, newPage, send } from './support';

/** Batch selection (FEAT-02): select messages, star them together, delete them for me. */
test('select several messages to star and delete them in one action', async ({ browser, request }) => {
  const user = await createUser(request, 'selector');
  const page = await newPage(browser);
  try {
    await enroll(page, user);
    await page.getByTestId('new-chat').click(); await page.getByTestId('note-to-self').click();
    for (const text of ['alpha note', 'beta note', 'gamma note']) await send(page, text);
    await expect(message(page, 'gamma note')).toBeVisible();

    await page.getByTestId('thread-menu').click();
    await page.getByTestId('menu-select').click();
    await expect(page.getByTestId('selection-bar')).toBeVisible();
    await expect(page.getByTestId('composer')).toHaveCount(0);
    await message(page, 'alpha note').click();
    await message(page, 'beta note').click();
    await expect(page.getByTestId('select-count')).toHaveText('2 selected');
    await page.getByTestId('select-star').click();
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
    await expect(message(page, 'alpha note').getByTestId('starred')).toBeVisible();
    await expect(message(page, 'beta note').getByTestId('starred')).toBeVisible();
    await expect(message(page, 'gamma note').getByTestId('starred')).toHaveCount(0);

    await page.getByTestId('thread-menu').click();
    await page.getByTestId('menu-select').click();
    await message(page, 'alpha note').click();
    await message(page, 'gamma note').click();
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('select-delete').click();
    await expect(message(page, 'alpha note')).toHaveCount(0);
    await expect(message(page, 'gamma note')).toHaveCount(0);
    await expect(message(page, 'beta note')).toBeVisible();
    await expect(page.getByTestId('composer')).toBeVisible();
  } finally { await closeAll(page); }
});
