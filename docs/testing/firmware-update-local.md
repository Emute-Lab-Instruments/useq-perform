# Local firmware-update hardware test

This procedure exercises the actual Chromium/Web Serial/File System Access
path. Native and DOM tests do not establish removable-volume behavior.

## Prepare a local release

Use the target printed on the module. For hardware v1.0:

```sh
cd /home/w1n5t0n/src/useq-perform/src-useq
nix-shell platformio.nix --run 'pio run -e hardware_v1_0'
cd ..
npm run prepare:firmware-beta -- \
  --version 1.2.0-beta.1 \
  --artifact hardware_v1_0=src-useq/.pio/build/hardware_v1_0/firmware.uf2
npm run dev
```

Open the HTTPS URL printed by Portless in current Chrome, Edge, Brave, or
another Chromium browser on Linux, macOS, or Windows. The APIs require a
secure context; do not replace that URL with a plain LAN HTTP address.

## Main-module update

1. Connect a module running older firmware and pair it with the editor.
2. Confirm that the beta offer names the installed and available versions.
3. Open the update and select the exact target if legacy firmware could not
   report it.
4. Click **Download and verify update**. Do not continue unless size and
   SHA-256 pass.
5. Click **Put connected module in update mode**. Confirm the serial connection
   closes and an `RPI-RP2`/UF2 boot volume appears.
6. Click **Choose boot drive and install**, select that volume, and approve
   write access. A normal folder must be rejected because it lacks
   `INFO_UF2.TXT`.
7. Confirm the volume disappears, the module restarts, and the editor
   reconnects. Reconnect manually only if the OS changes the serial identity.
8. Reconnect once more and confirm `hello.fw` is the published version and
   `hello.target` matches the artifact.

Also test **Download verified UF2 instead** and manually copy it to the boot
volume. This is the recovery path when directory-write access is unavailable.

## Preferences and expander discovery

1. On a beta offer choose **Stop showing betas**, reload, and confirm it stays
   off. Re-enable **Offer beta firmware updates** in Advanced Settings.
2. With an expander attached before main-module startup, inspect
   `hello.modules`. Confirm firmware target/version, hardware revision, batch,
   serial, MCU family, and update transport.
3. Attach or power the expander later, click **Rescan I²C modules**, and confirm
   the count changes without rebooting the main module.
4. An absent or CRC-invalid factory record must appear as
   `unidentified-prototype` and must not select a UF2 automatically.
5. An expander discovered through I²C must direct the user to connect that
   expander itself by USB/BOOTSEL. It must never reset the main module or claim
   that firmware was relayed over I²C.

## Publishing to the editor server

Deploy the generated immutable version directory under
`/firmware/beta/<version>/`, then deploy `/firmware/beta/manifest.json` last.
The UF2 files therefore live on the same server as the editor. Updating the
manifest activates offers; removing it stops new offers while leaving already
published immutable files available.
