# Waiting on the owner (written 2026-11-01)

Everything below needs you: a decision, an account, or the real hardware. Everything else in the
first implementation is done and tested on the Mac (see "State of the build" at the end).

## 1. Decisions

1. **First commit.** Done: one initial commit on `main` (2026-11-01). No remote is set up and
   nothing is pushed.
2. **App ID.** `com.alexmaghen.piconfigurator` is a placeholder in `apps/mobile/app.config.ts`
   (iOS bundle ID and Android package). It can't change after a store release.
3. **Export compliance.** `ITSAppUsesNonExemptEncryption` is set to `false`. The app uses
   standard AES-GCM / SRP only to talk to your own devices, which usually qualifies for the
   exemption, but that's your call for App Store submission.
4. **BallsPi env file.** pi-configurator writes BallsPi's values to
   `/var/lib/pi-configurator/ballspi.env` instead of the `.env.production` committed in
   studfs-robots. For BallsPi to read them, studfs-robots' `deploy/systemd/balls.service` and
   `playstream.service` each need one line: `EnvironmentFile=-/var/lib/pi-configurator/ballspi.env`.
   I haven't touched studfs-robots. Approve and I'll make that change there.
5. **Which BallsPi settings appear in the app.** `config-template/config.json` exposes Wi-Fi,
   hostname, time zone, the HomeKit names, the four door/track timings, home-on-start, the
   stream URL and the log level. Add, remove or relabel as you like. Note `BallsSettings` has the
   comment "close_track_lead_seconds: 4 # was 8 in git; 4 on the live Pi", so the default is 4.
6. **Minimum new password.** The app asks for 8+ characters when changing the device password
   from the phone; the config file itself accepts 1+. Keep or change.

## 2. Accounts and builds

1. **iPhone build.** Open `apps/mobile` with `npx expo run:ios --device` (or Xcode) and pick
   your Apple team for signing the first time. I didn't sign in to anything or use EAS.
2. **Android.** Not built yet. Permissions are configured but untested; needs Android Studio /
   an emulator and a phone with BLE.
3. **App icon and splash** are Expo placeholders.

## 3. Testing on the real Pi (BallsPi)

Nothing has run on a Pi or over real Bluetooth. The steps are in `deploy/README.md`; in short:

1. Copy the repo to the Pi and run `sudo ./deploy/install.sh --reader pi`.
2. Set a real password in `/etc/pi-configurator/config.json`; run `sudo pi-configurator check`.
3. `journalctl -u pi-configurator -f` should say it's advertising as "BallsPi".
4. With nRF Connect on the iPhone: the service UUID `7f48fb74-…` and full name are visible, and
   reading the `info` characteristic returns JSON.
5. With the app (dev build on your phone): unlock, describe (including the long time-zone list
   at the iPhone's MTU), edit, save; check `/var/lib/pi-configurator/values.json`, the env file,
   and that `balls.service` / `playstream.service` restart.
6. Wi-Fi: scan; join WPA2, WPA3 and open networks; a wrong password (the profile is removed);
   rejoin a saved network without typing its password.
7. Hostname (`/etc/hosts` 127.0.1.1 line, `ballspi.local` resolves) and time zone.
8. Reboot: first with `PI_CONFIGURATOR_NO_REBOOT=1`, then for real; the app reconnects after.
9. Wrong-password lockout; a second phone is refused while the first is connected (the app
   should say the device is busy with another phone); the session locks after 10 minutes idle.
10. Unlock time on the real phone (about 2.9 s in a Simulator debug build doing both sides).

Code paths that need checking on the Pi are marked `VERIFY ON PI` in
`python/service/src/pi_configurator/ble/bluez.py` and `system/networkmanager.py` (BlueZ MTU
option, scan-response name length, notification pacing for long messages, NetworkManager
WPA3 / profile updates).

## State of the build

| Part | Status |
|---|---|
| `packages/protocol` | 88 tests pass; SRP checked against RFC 5054's vectors, AES-GCM/HKDF against Node's crypto |
| `python/` service + client | 145 tests pass against the shared vectors; pyright strict and ruff clean |
| `apps/mobile` | 41 tests pass; typecheck and lint clean; runs in the iOS Simulator against the built-in demo device |
| `deploy/` | systemd unit and install script written; install script syntax-checked only |
