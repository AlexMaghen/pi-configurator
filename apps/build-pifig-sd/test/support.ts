/** A fake boot drive in a temp folder, shaped like a fresh 64-bit Raspberry Pi OS card. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** pi-gen's user-data on a fresh image: only comments (shortened). */
export const FRESH_USER_DATA = `#cloud-config

# This is the user-data configuration file for cloud-init. By default this sets
# up an initial user called "ubuntu" with password "ubuntu".
#hostname: raspberrypi
`;

/** What Raspberry Pi Imager writes when the user customises the image (shortened). */
export const IMAGER_USER_DATA = `#cloud-config
hostname: kitchen
manage_etc_hosts: true
users:
- name: pi
  groups: users,adm,sudo
  shell: /bin/bash
  lock_passwd: false
enable_ssh: true
timezone: America/Los_Angeles
runcmd:
- localectl set-x11-keymap "us" pc105
- setupcon -k --force || true
`;

export function fakeDrive(label = "bootfs", files: Record<string, string> = {}): string {
  const parent = mkdtempSync(join(tmpdir(), "pifig-"));
  const drive = join(parent, label);
  mkdirSync(drive);
  const base: Record<string, string> = {
    "config.txt": "arm_64bit=1\n",
    "cmdline.txt": "console=serial0,115200 root=PARTUUID=1234-02 rootwait\n",
    "bcm2711-rpi-4-b.dtb": "",
    "bcm2712-rpi-5-b.dtb": "",
    "kernel8.img": "",
    "kernel_2712.img": "",
    "issue.txt": "Raspberry Pi reference 2025-11-24\nGenerated using pi-gen, https://github.com/RPi-Distro/pi-gen, abc123, stage2\n",
    "user-data": FRESH_USER_DATA,
    "meta-data": "dsmode: local\ninstance_id: rpios-image\n",
    "network-config": "network:\n  version: 2\n",
    ...files,
  };
  for (const [name, text] of Object.entries(base)) writeFileSync(join(drive, name), text);
  return drive;
}
