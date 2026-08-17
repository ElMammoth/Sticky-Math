# Installation

Two ways to get the panel into InDesign: load it in development mode through the UXP Developer Tool,
or package it as a `.ccx` and install it permanently.

## Development mode (UXP Developer Tool)

1. Open InDesign 2026.
2. Open the UXP Developer Tool.
3. **Add Plugin**, then select `plugin/manifest.json`.
4. On the plugin's row, click **Load**. The *Sticky Math* panel appears in InDesign.
5. After each file change, use **Actions → Reload**.

This is the fastest loop and the recommended way to work on the plugin. The plugin does not survive
an InDesign restart.

## Permanent installation (`.ccx`)

1. In the UDT, use **Package**. This produces a `.ccx` file, which is a zip of the `plugin/` folder.
2. Double-click the `.ccx`. Creative Cloud Desktop installs it after warning you that the plugin
   comes from outside the marketplace. The plugin then survives InDesign restarts.

Do not copy files into the UXP folders by hand. Installation has to go through Creative Cloud or
UPIA so that their database is updated.

## Troubleshooting: "Compatible app required"

Creative Cloud rejects the package with this message when it cannot match the manifest to an
installed application. Things to check, in order:

**The manifest must follow the v5 schema strictly.** `host` has to be an *object*:

```json
"host": { "app": "ID", "minVersion": "21.0.0" }
```

not an array, and `minVersion` must be in `x.y.z` form. The UDT loads a lax manifest happily, but the
Creative Cloud installer matches strictly. Repackage after any correction.

**Update Creative Cloud Desktop.** Support for InDesign UXP plugins is recent.

**Check the language mismatch.** A known cause reported on the Adobe forums: Creative Cloud's default
installation language differs from InDesign's. Align them.

**Use the command-line installer to see the real error.** UPIA reports the actual reason for a
refusal, where the Creative Cloud dialog does not:

```sh
UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"

"$UPIA" --list all
"$UPIA" --install "path/to/Sticky Math_0.1.0.ccx"
```

`--list all` shows which applications the installer knows about, and InDesign must appear there.
`--install` prints the exact reason a package is refused.
