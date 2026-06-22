# PasteVault macOS Packaging

macOS packaging is intentionally separated from the main Windows release flow. Build and sign final macOS artifacts on macOS.

From the repository root on macOS:

```bash
npm install
npm run build
npx electron-builder --config packaging/mac/electron-builder.json --mac zip
```

For a DMG build:

```bash
npx electron-builder --config packaging/mac/electron-builder.json --mac dmg
```

Unsigned macOS builds may be blocked by Gatekeeper. Use an Apple Developer certificate and notarization for public macOS distribution.
