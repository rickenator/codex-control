# Consiglio Mobile Companion

Consiglio Mobile is one Capacitor client with native Android and iOS projects. Codex still runs on the desktop, where the CLI, repositories, credentials, and operating-system security controls live. The phone is a focused remote surface for ongoing work.

## Available mobile actions

- list existing Consiglio sessions and their state;
- read a session's event timeline;
- send the next prompt;
- reconnect or stop a session; and
- inspect, approve, or reject pending command requests.

The bridge does not expose settings, provider API keys, saved secrets, Git mutation endpoints, arbitrary files, terminal bytes, session creation, or arbitrary commands.

## Start the desktop bridge

Open Consiglio, select **Mobile**, and choose **Enable & create token**. Consiglio generates a 256-bit token, encrypts it with the operating-system credential store, and displays it once for transfer to the phone. Closing the dialog removes the visible copy. Use **Rotate token** to revoke every client using the previous token, or **Disable & revoke** to stop the bridge and delete the saved encrypted token.

The bridge listens on `127.0.0.1:43117` by default. The pairing dialog can select another port. It intentionally refuses non-loopback bind addresses.

For automation and development, the environment-variable path remains available. Generate a fresh high-entropy token:

```bash
openssl rand -hex 32
```

Launch Consiglio with the token in its environment:

```bash
CONSIGLIO_MOBILE_BRIDGE_TOKEN='<64-character-output>' npm run dev:all
```

Set `CONSIGLIO_MOBILE_BRIDGE_PORT` to another valid port when needed. An environment token takes precedence for that launch and makes the pairing controls read-only.

Place an authenticated TLS tunnel or HTTPS reverse proxy in front of that loopback endpoint. The public mobile URL must use a certificate trusted by the phone. Do not expose port 43117 directly to a LAN or the internet, and do not terminate TLS on an untrusted intermediary.

In the mobile client, enter the HTTPS URL and the same token. After the first successful health check, Android encrypts the pairing with a non-exportable Android Keystore key in the app's no-backup storage; iOS stores it in a device-only Keychain item. The client reconnects automatically after app or phone restarts. **Forget device** removes the local credential. Rotating or disabling pairing on the desktop invalidates it remotely.

## Build the web and native projects

Requirements:

- Node.js 22 or newer;
- Android Studio and Android SDK 36 for Android builds;
- Xcode on macOS for iOS builds; and
- the platform signing credentials required for store or device distribution.

Install, verify, and copy the web assets into both native projects:

```bash
cd mobile
npm ci
npm run sync
```

Open a native project:

```bash
npm run android
npm run ios
```

Build an Android debug APK without opening Android Studio:

```bash
cd mobile/android
./gradlew assembleDebug
```

The unsigned debug APK is written under `mobile/android/app/build/outputs/apk/debug/`. GitHub Actions builds and retains that APK for each validated commit. iOS CI compiles, verifies, and retains the unsigned simulator `.app` bundle.

## Security model

- The bridge is off until mobile pairing is explicitly enabled in Consiglio or `CONSIGLIO_MOBILE_BRIDGE_TOKEN` is present.
- App-managed tokens are generated from 256 bits of cryptographic randomness, encrypted with the operating-system credential store, persisted in a mode-0600 file, and never returned after the one-time pairing display.
- Tokens shorter than 32 characters are rejected and compared in constant time.
- The HTTP listener accepts loopback binds only; transport security belongs to the local TLS tunnel or reverse proxy.
- Requests require a bearer token, have bounded JSON bodies and prompts, and are rate-limited.
- Browser origins are limited to the standard Capacitor local origins.
- Responses disable caching and MIME sniffing.
- The mobile app accepts HTTPS endpoints; plain HTTP is allowed only for localhost development.
- The pairing token is never stored in `localStorage`, native preferences, mobile backups, logs, or analytics. Android stores only AES-GCM ciphertext outside the Keystore; iOS uses a `ThisDeviceOnly` Keychain accessibility class.
- A revoked token is removed from the phone when the bridge returns an authentication failure. Network failures do not erase a valid saved pairing, so the user can retry after connectivity returns.

Treat a paired phone as an approval-capable operator device. The secure stores protect credentials at rest; they do not protect an unlocked, compromised, or rooted/jailbroken device. Use its screen lock, rotate or disable pairing immediately when a device is lost, and keep the TLS endpoint private.

## Production distribution

The repository contains complete Android and iOS projects, but store-ready artifacts require owner-controlled credentials that must never be committed:

- an Android upload keystore plus passwords for an AAB; and
- an Apple Developer team, distribution certificate, and provisioning profile for an iOS archive.

Until those credentials are configured, CI proves Android compilation with an unsigned debug APK and iOS compilation with an unsigned simulator app, retaining both artifacts for inspection. This is deliberate: the pipeline does not claim a production signature it cannot verify.
