# Bundly Native Apps (Android + iOS)

Bundly is a PWA (Progressive Web App) and is also wrapped with **Capacitor**
to produce installable Android (APK / AAB for Play Store) and iOS (IPA for
App Store) binaries from the same React codebase.

## Quick start (one-time setup)

Install Capacitor + platforms:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios --legacy-peer-deps
npx cap init Bundly co.bundly.app --web-dir=dist
npx cap add android
npx cap add ios
```

The `capacitor.config.json` at the repo root is already configured:
- `appId`: `co.bundly.app`
- `appName`: `Bundly`
- `webDir`: `dist` (vite build output)
- Push notifications + splash screen plugin configs included.

## Build native binaries

1. Build the web app: `npm run build`
2. Sync the web assets into the native projects: `npx cap sync`
3. Open Android Studio: `npx cap open android` → Build → Build APK/AAB
4. Open Xcode (macOS only): `npx cap open ios` → Product → Archive

## Notes

- **PWA install** (Android Chrome / Edge / desktop): users get the "Install"
  prompt automatically once `beforeinstallprompt` fires. The in-app button
  also appears as a floating banner.
- **iOS "Add to Home Screen"**: Safari users tap Share → Add to Home Screen.
  Apple intentionally does not expose `beforeinstallprompt` so we can't
  show a prompt; the PWA still installs as a standalone web app.
- **Play Store TWA alternative**: instead of Capacitor for Android, you can
  use [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) to wrap
  the PWA as a Trusted Web Activity (smaller bundle, auto-updates with the
  web app). Capacitor is simpler if you want native APIs (push, biometrics).

## Push notifications

Two flavours:

1. **Web Push** (PWA path): subscribes via the service worker, server stores
   the subscription in `bundly-db.json` under `pushSubscriptions`. Send via
   the `web-push` npm package using VAPID keys (generate with
   `npx web-push generate-vapid-keys`).
   - Server env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
   - Frontend reads the public key from `GET /api/push/public-key`

2. **Native push** (Capacitor path): use `@capacitor/push-notifications`.
   Android → FCM (set up via Firebase). iOS → APNs (set up via Apple
   Developer + push certificates). Capacitor handles the bridge.

## Domain assets for TWA verification

Required for Bubblewrap / TWA to confirm the APK is authorised:

```
public/.well-known/assetlinks.json
```

Generate with [Asset Links Tool](https://developers.google.com/digital-asset-links/tools/generator)
after building the APK so you have the SHA-256 fingerprint.
