# Convo Android APK

Install `convo-android-debug.apk` on Android 9 or later. Default server:
`https://192.168.1.144:8443`. The phone must reach that server on your network.
Verify the file with `sha256sum -c convo-android-debug.apk.sha256`.

This is a development interoperability build, not a production-certified release or a claim
of complete web/mobile parity. See [Android implementation and known gaps](../android/README.md).
System-browser login may ask you to accept the server's self-signed certificate once on the
device. The app's debug network adapter trusts only the bundled exact development certificate
for that IP and port. Release builds do not include that trust exception.

Rebuild from repository source using `apps/android/scripts/build-apk.sh`. Installing an update
with `adb install -r` retains app data; uninstalling removes device-local keys. Keep a trusted
linked device or a saved account recovery code before removing the app.
