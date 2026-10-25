// Example BOT_HANDLER: answers "help" and "time" in direct chats or when mentioned in a group.
// A handler receives the decrypted message and `convo` ({ accountId, reply(text), call(method, args) }).
// Message text is untrusted input: never let it choose tools, commands or recipients.
export default async function onMessage(message, convo) {
  const text = (message.body ?? '').toLowerCase();
  if (text.includes('help')) await convo.reply('I am a Convo bot. Try "time".');
  else if (text.includes('time')) await convo.reply(`It is ${new Date().toUTCString()}.`);
}
