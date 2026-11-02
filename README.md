# pi-configurator

Set up Raspberry Pi devices over Bluetooth LE from a phone: Wi-Fi, hostname, time zone, and any
settings the device's own software needs, from one generic app.

- **Design:** [docs/design.md](docs/design.md) (agreed 2026-11-01). Background research: [docs/background.md](docs/background.md).
- **Waiting on the owner:** [docs/owner-todo.md](docs/owner-todo.md).

## Layout

| Path | What |
|---|---|
| `packages/protocol` | The shared contract, in TypeScript: config file schema, RPC messages, BLE framing, SRP-6a and session encryption. Generates JSON Schema and test vectors |
| `python/` | uv workspace: the `pi-configurator` service and the `pi-configurator-client` package other Pi apps use to read values |
| `apps/mobile` | Expo app "pi-configurator" (iPhone first, Android-ready) |
| `deploy/` | systemd unit and install script for the Pi |
| `examples/ballspi` | Config for the first target device |

## Commands

```bash
pnpm install
```

```bash
pnpm generate
```

```bash
pnpm test
```

```bash
pnpm typecheck
```

`pnpm generate` rewrites `packages/protocol/json-schema/` and the generated test vectors. The
protocol tests fail if those files are stale. Both the app and the Python service are tested
against `packages/protocol/test-vectors/`, which is how the two sides are kept in agreement.
