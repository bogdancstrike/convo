-- The archive/bot runtime (deploy/convo-bot) enrolls devices with platform 'integration'.
ALTER TABLE devices DROP CONSTRAINT devices_platform_check;
ALTER TABLE devices ADD CONSTRAINT devices_platform_check CHECK (platform IN ('android', 'ios', 'desktop', 'web', 'integration'));
