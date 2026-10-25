# Convo archive/bot runtime

Runs a dedicated **integration account** — an archive that keeps what it receives, or a bot that
answers — with the same end-to-end encryption core as the Android app, in headless Chromium.

Convo never has a hidden reader (SECURITY.md §15.1). Before running one:

1. Create a sign-in account for it (admin console → Users → New), e.g. `records-archive`.
2. Mark it in the admin console: Users → the account → Security → **Integration account**, choose
   *Archive* or *Bot*, and write what happens to messages it receives. Everyone in its chats sees
   that text in a banner.
3. Add it to the groups that should be archived (members are asked to confirm), or message it.

## Run

```sh
docker build -f deploy/convo-bot/Dockerfile -t convo-bot .
docker run -d --name convo-archive -v convo-archive:/data \
  -e CONVO_URL=https://convo.example.org -e BOT_MODE=archive -e ARCHIVE_RETENTION_DAYS=2555 convo-bot
docker logs -f convo-archive    # first start: "SIGN IN: open https://…/device?user_code=…"
```

Open the printed link and sign in **as the integration account**. The runtime enrolls a device of
platform `integration` (visible in the admin console's Sessions page) and keeps its keys in the
`/data` volume.

| Variable | Meaning |
|---|---|
| `CONVO_URL` | Convo origin |
| `BOT_MODE` | `archive` (default) or `bot` |
| `ARCHIVE_FILE` | default `/data/archive.jsonl` — **plaintext**, created with mode 0600 |
| `ARCHIVE_RETENTION_DAYS` | prune older archived messages at start and daily; must match the disclosed retention |
| `BOT_HANDLER` | bot mode: ES module whose default export is `async (message, convo) => {}` (see `examples/help-bot.mjs`) |
| `INSECURE_TLS=1` | development only (self-signed certificates) |

**Addressed-only bots.** Instead of adding a bot to a group (where, as a member, it reads
everything), owners can *connect* it (group info → Connected bots). It then receives only messages
that mention it, as separate 1:1 copies; `message.botRequest` / `convo.group` carry the group, and
`convo.reply(text)` answers the member, whose app posts the answer in the group as from the bot.

**Archive mode** writes one JSON line per message it can read (author, chat, time, text, attachment
names; attachment contents are not downloaded). **Bot mode** calls the handler for direct messages
and group messages that mention the account; `convo.reply(text)` answers in the same chat.

## Security notes

* The archive file and the `/data` volume hold plaintext and device keys: store them encrypted at
  rest, restrict access, and back them up under the same policy as the archive itself.
* The account reads exactly what a member reads. Remove it from a group to stop future messages;
  copies already archived stay until retention removes them.
* Bot handlers must treat message text as untrusted input (no tool or command selection from it).
* Unlinking its device in the admin console stops it; it exits and needs a fresh sign-in.
