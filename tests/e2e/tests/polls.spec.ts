import { expect, test, type Page } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, openChat, send } from './support';

/** AC-COL-01: polls with stable options, one current ballot per member, visible voters, authorized close. */
async function createPoll(page: Page, question: string, options: string[], multiple: boolean) {
  await page.getByTestId('attach-button').click();
  await page.getByTestId('attach-poll').click();
  await page.getByTestId('poll-question').fill(question);
  for (const [i, text] of options.entries()) await page.getByTestId(`poll-option-${i}`).fill(text);
  if (!multiple) await page.getByTestId('poll-multiple').uncheck();
  await page.getByTestId('poll-send').click();
  await expect(page.getByTestId('poll-composer')).toHaveCount(0);
}
const pollCard = (page: Page, question: string) => page.getByTestId('poll-card').filter({ hasText: question });
const option = (page: Page, question: string, text: string) => pollCard(page, question).getByTestId('poll-option').filter({ hasText: text });

test('group poll: vote, change vote, see voters, only the author or an admin closes it', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const [ownerU, bobU] = await Promise.all(['pollowner', 'pollbob'].map((p) => createUser(request, p)));
  const [owner, bob] = await Promise.all([1, 2].map(() => newPage(browser)));
  try {
    await enroll(owner, ownerU); await enroll(bob, bobU);
    const groupName = `Poll group ${Date.now() % 10000}`;
    await owner.getByTestId('new-chat').click(); await owner.getByTestId('new-group').click();
    await owner.getByTestId('people-search').fill(bobU.username); await owner.getByTestId(`pick-${bobU.username}`).click();
    await owner.getByTestId('group-next').click(); await owner.getByTestId('group-name').fill(groupName);
    await owner.getByTestId('review-group').click(); await owner.getByTestId('create-group').click();
    await send(owner, 'poll coming');
    await openChat(bob, groupName);

    const q = 'Where should we eat?';
    await createPoll(owner, q, ['Pizza', 'Sushi', 'Salad'], false);
    await expect(pollCard(bob, q)).toBeVisible({ timeout: 20_000 });
    await expect(pollCard(bob, q)).toContainText('Select one');
    // A member cannot close someone else's poll.
    await expect(pollCard(bob, q).getByTestId('poll-close')).toHaveCount(0);

    await option(bob, q, 'Sushi').click();
    await expect(option(owner, q, 'Sushi').getByTestId('poll-count')).toHaveText('1', { timeout: 20_000 });
    // Changing the vote replaces the ballot (single choice): Sushi 0, Salad 1.
    await option(bob, q, 'Salad').click();
    await expect(option(owner, q, 'Salad').getByTestId('poll-count')).toHaveText('1', { timeout: 20_000 });
    await expect(option(owner, q, 'Sushi').getByTestId('poll-count')).toHaveText('0');
    await option(owner, q, 'Salad').click();
    await expect(option(bob, q, 'Salad').getByTestId('poll-count')).toHaveText('2', { timeout: 20_000 });
    await expect(pollCard(owner, q)).toHaveAttribute('data-voters', '2');
    // Voters are visible to members (no anonymity claim).
    await pollCard(owner, q).getByTestId('poll-view-votes').click();
    await expect(pollCard(owner, q)).toContainText(bobU.name.split(' ')[0]!);

    await pollCard(owner, q).getByTestId('poll-close').click();
    await expect(pollCard(bob, q)).toHaveAttribute('data-closed', 'true', { timeout: 20_000 });
    await expect(option(bob, q, 'Pizza')).toBeDisabled();
    await expect(pollCard(bob, q)).toContainText('Poll closed');

    // Multiple choice: one ballot holds several options.
    const m = 'Which days work?';
    await createPoll(owner, m, ['Mon', 'Tue', 'Wed'], true);
    await expect(pollCard(bob, m)).toContainText('Select one or more', { timeout: 20_000 });
    await option(bob, m, 'Mon').click(); await option(bob, m, 'Wed').click();
    await expect(option(owner, m, 'Wed').getByTestId('poll-count')).toHaveText('1', { timeout: 20_000 });
    await expect(option(owner, m, 'Mon').getByTestId('poll-count')).toHaveText('1');
    await expect(pollCard(owner, m)).toHaveAttribute('data-voters', '1');
    await owner.screenshot({ path: test.info().outputPath('polls.png') });
  } finally { await closeAll(owner, bob); }
});

test('quiz: answer hidden until answered, one final try, explanation and score', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const [ownerU, bobU] = await Promise.all(['quizowner', 'quizbob'].map((p) => createUser(request, p)));
  const [owner, bob] = await Promise.all([1, 2].map(() => newPage(browser)));
  try {
    await enroll(owner, ownerU); await enroll(bob, bobU);
    const groupName = `Quiz group ${Date.now() % 10000}`;
    await owner.getByTestId('new-chat').click(); await owner.getByTestId('new-group').click();
    await owner.getByTestId('people-search').fill(bobU.username); await owner.getByTestId(`pick-${bobU.username}`).click();
    await owner.getByTestId('group-next').click(); await owner.getByTestId('group-name').fill(groupName);
    await owner.getByTestId('review-group').click(); await owner.getByTestId('create-group').click();
    await send(owner, 'quiz time');
    await openChat(bob, groupName);

    const q = 'Capital of Romania?';
    await owner.getByTestId('attach-button').click(); await owner.getByTestId('attach-poll').click();
    await owner.getByTestId('poll-question').fill(q);
    for (const [i, text] of ['Cluj', 'Bucharest', 'Iasi'].entries()) await owner.getByTestId(`poll-option-${i}`).fill(text);
    await owner.getByTestId('poll-quiz').check();
    await expect(owner.getByTestId('poll-send')).toBeDisabled(); // a correct answer is required
    await owner.getByTestId('quiz-correct-1').check();
    await owner.getByTestId('quiz-explanation').fill('Bucharest has been the capital since 1862.');
    await owner.getByTestId('poll-send').click();

    await expect(pollCard(bob, q)).toContainText('Quiz', { timeout: 20_000 });
    await expect(pollCard(bob, q).getByTestId('poll-count')).toHaveCount(0); // hidden before answering
    await expect(pollCard(bob, q).getByTestId('quiz-result')).toHaveCount(0);
    await option(bob, q, 'Cluj').click();
    await expect(pollCard(bob, q).getByTestId('quiz-result')).toContainText('Not quite');
    await expect(pollCard(bob, q).getByTestId('quiz-result')).toContainText('since 1862');
    await expect(option(bob, q, 'Bucharest')).toHaveAttribute('data-verdict', 'correct');
    await expect(option(bob, q, 'Iasi')).toBeDisabled(); // one try
    await expect(pollCard(owner, q).getByTestId('quiz-result')).toContainText('0 of 1', { timeout: 20_000 });
  } finally { await closeAll(owner, bob); }
});
