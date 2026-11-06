# build-pifig-sd

Sets up pi-configurator on a freshly written Raspberry Pi OS SD card, from a Mac or a Windows
PC. When the Pi boots from the card for the first time, it installs pi-configurator by itself,
**with no internet**, and starts advertising over Bluetooth for the pifig app.

## Using it

1. Write **64-bit Raspberry Pi OS** (from 24 November 2025 or later) to the card with Raspberry
   Pi Imager. Leave the card in the computer; its boot drive shows up (usually as "bootfs").
2. Run the program for your computer, from `dist/`:

   ```bash
   ./dist/build-pifig-sd-macos-arm64
   ```

   (`build-pifig-sd-macos-x64` on an Intel Mac, `build-pifig-sd-windows-x64.exe` on Windows.)
3. It finds the boot drive and shows it (name, Raspberry Pi OS release, 64-bit, free space).
   Nothing is changed until you answer `y`. With several Pi cards in, it asks which one; or name
   it: `--drive /Volumes/bootfs` (`--drive E:\` on Windows).
4. Enter the **Device Name** (what pifig shows; at most 29 bytes, the Bluetooth limit) and the
   **pifig Access Password** (any characters, 1 to 128 of them; typed twice, not shown).

   To use your own config (your device's settings list, permissions, export file) instead of
   the built-in template, add `--config-file PATH`:

   ```bash
   ./dist/build-pifig-sd-macos-arm64 --config-file ~/robots/garage.json
   ```

   The file is checked against the same rules the Pi uses before anything on the card changes,
   and every problem is listed. The name and password prompts then offer the file's values:
   press Enter to keep them, or type new ones.
5. Put the card in the Pi and switch it on. The first boot takes a few minutes.

If the Pi doesn't appear in pifig, put the card back in the computer and read
`pi-configurator/result.txt` on the boot drive. On the Pi, the full log is
`/var/log/cloud-init-output.log`.

## What it checks

It only uses a drive that has a Raspberry Pi boot partition's files (`config.txt`,
`cmdline.txt` and Broadcom device trees), and refuses one that:

- is 32-bit Raspberry Pi OS (the prebuilt Python environment is for 64-bit);
- has no cloud-init files (`user-data`, `meta-data`): Raspberry Pi OS before 24 November 2025;
- has less than 30 MB free.

It can't tell whether a card has already been started in a Pi. The install runs from cloud-init,
which acts on `user-data` only on the first boot, so use a freshly written card.

## What it writes

On the boot drive (the Pi sees it as `/boot/firmware`):

| File | What |
|---|---|
| `pi-configurator/venv.tar.gz` | pi-configurator and its Python libraries, prebuilt for 64-bit Raspberry Pi OS (Python 3.13) |
| `pi-configurator/config.json` | The config template (or your `--config-file`) with the name and password you entered |
| `pi-configurator/firstboot.sh`, `deploy/` | The first-boot script, the installer (`deploy/install.sh --venv-archive`) and the systemd unit |
| `user-data` | One line added under `runcmd:` (`bash /boot/firmware/pi-configurator/firstboot.sh`); everything else, including Raspberry Pi Imager's settings, is kept |

On first boot the Pi unpacks the environment into `/opt/pi-configurator`, installs the config,
the service and the `pi-configurator` command, adds the first user (uid 1000) to the
`pi-configurator` group, and starts the service. It then deletes `config.json` from the boot
drive (it holds the password in plain text) and the archive, and writes `result.txt`.

## Building it

Needs Docker (started automatically on the Mac).

```bash
pnpm --filter build-pifig-sd bundle
```

builds `bundle/`: the Python environment inside a `debian:trixie` arm64 container, at the path
it has on the Pi, plus the installer, unit, first-boot script and config template.

```bash
pnpm --filter build-pifig-sd build
```

compiles `src/` with Bun into self-contained programs in `dist/`, with the bundle inside, so
they need nothing installed and no internet.

Or let `scripts/pifig-sd.sh` at the repo root decide: it fingerprints the inputs of each step
(the files' contents, committed or not), rebuilds only the steps whose inputs changed, and then
runs the program for this Mac on the inserted card. It leaves the fingerprints as
`.inputs-sha256` in `bundle/` and `dist/`; a build made with the commands above has none, so the
script rebuilds it once.

```bash
~/AxDevProj/Robots/pi-configurator/scripts/pifig-sd.sh [--config-file PATH]
```

During development, run it straight from the source:

```bash
pnpm --filter build-pifig-sd start
```

### Tests

```bash
pnpm --filter build-pifig-sd test
```

unit tests (drive detection, user-data editing, config, copying). And the first boot itself,
offline, in an arm64 container with only what Raspberry Pi OS has (python3, bluez,
network-manager) and the network switched off:

```bash
./apps/build-pifig-sd/scripts/test-firstboot.sh
```

Not tested yet: a real first boot on a Pi, and the Windows program on Windows.
