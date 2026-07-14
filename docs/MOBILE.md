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

Generate a fresh high-entropy token. For example:

```bash
openssl rand -hex 32
```

Launch Consiglio with the token in its environment:

```bash
CONSIGLIO_MOBILE_BRIDGE_TOKEN='<64-character-output>' npm run dev:all
```

The bridge listens on `127.0.0.1:43117`. Set `CONSIGLIO_MOBILE_BRIDGE_PORT` to another valid port when needed. It intentionally refuses non-loopback bind addresses.

Place an authenticated TLS tunnel or HTTPS reverse proxy in front of that loopback endpoint. The public mobile URL must use a certificate trusted by the phone. Do not expose port 43117 directly to a LAN or the internet, and do not terminate TLS on an untrusted intermediary.

In the mobile client, enter the HTTPS URL and the same token. The URL is remembered; the token remains only in app memory and must be entered again after disconnecting or restarting the app.

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

The unsigned debug APK is written under `mobile/android/app/build/outputs/apk/debug/`. GitHub Actions builds and retains that APK for each validated commit. iOS CI compiles the simulator application without code signing.

## Security model

- The bridge is off unless `CONSIGLIO_MOBILE_BRIDGE_TOKEN` is present.
- Tokens shorter than 32 characters are rejected and compared in constant time.
- The HTTP listener accepts loopback binds only; transport security belongs to the local TLS tunnel or reverse proxy.
- Requests require a bearer token, have bounded JSON bodies and prompts, and are rate-limited.
- Browser origins are limited to the standard Capacitor local origins.
- Responses disable caching and MIME sniffing.
- The mobile app accepts HTTPS endpoints; plain HTTP is allowed only for localhost development.
- The pairing token is never stored in `localStorage` or native preferences.

Treat a paired phone as an approval-capable operator device. Use its screen lock, revoke a pairing by restarting the desktop with a new token, and keep the TLS endpoint private.

## Production distribution

The repository contains complete Android and iOS projects, but store-ready artifacts require owner-controlled credentials that must never be committed:

- an Android upload keystore plus passwords for an AAB; and
- an Apple Developer team, distribution certificate, and provisioning profile for an iOS archive.

Until those credentials are configured, CI proves Android compilation with an unsigned debug APK and iOS compilation with an unsigned simulator build. This is deliberate: the pipeline does not claim a production signature it cannot verify.
