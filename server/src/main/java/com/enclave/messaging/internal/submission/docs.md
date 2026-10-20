# `messaging.internal.submission`

Idempotent direct sends (specs §5.3, §26.1; task MSG-01).

`SubmissionService.submitDirect` runs one transaction:

1. Shape checks — 16-byte `submissionId`, unique devices, allowed types, size limits
   (`max-envelope-bytes`, `max-devices-per-send`), transient TTL bound.
2. Dedupe — same `(origin device, submissionId)` + same canonical digest → original result
   (`duplicate = true`); different digest → `IDEMPOTENCY_CONFLICT`.
3. Roster validation — compares the device messages with the destination's active roster
   (minus the sending device). Missing/extra → `DEVICE_MISMATCH` (409, `missing`/`extra`);
   registration ID changed → `STALE_DEVICES` (410, `stale`). Nothing is stored on rejection.
4. Insert one envelope per device (quota-checked), record the submission, publish
   `EnvelopesStored` (gateway signals devices after commit).

The canonical digest covers destination, flags and every device ciphertext sorted by device ID,
so retrying the same stored ciphertext is safe while any changed byte is detected.
