/** The browser lacks insertable streams / script transforms, so media can't be E2EE. */
export class CallEncryptionUnsupportedError extends Error {
  constructor() { super('end-to-end encrypted calls are not supported in this browser'); this.name = 'CallEncryptionUnsupportedError'; }
}
