# pi-configurator

Set up Raspberry Pi devices over Bluetooth from an iPhone: Wi-Fi plus each device's own settings,
using one generic app that draws its form from a settings description the device provides.

**Status: design agreed 2026-11-01; first implementation in progress.**

- `docs/design.md` is the agreed design. `docs/background.md` has the research and the first
  target device (BallsPi / studfs-robots). `docs/owner-todo.md` lists what is waiting on the owner.
- `packages/protocol` (TypeScript) is the single source of truth for the contract. Change it there,
  run `pnpm generate`, then update the Python side until it passes `packages/protocol/test-vectors/`.
- Pi side: Python (uv workspace in `python/`), on BlueZ and NetworkManager.
- Phone side: Expo in `apps/mobile`, iPhone first, Android-ready.
- SD-card setup from a Mac or PC: `apps/build-pifig-sd` (TypeScript, compiled with Bun), which
  copies a prebuilt offline bundle onto the boot drive and installs it on first boot via cloud-init.
- The owner's global rules apply where they fit; the owner allowed departures the project needs
  (Python inside the monorepo, no web backend stack).
