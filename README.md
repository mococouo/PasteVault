# PasteVault

PasteVault is a local encrypted desktop vault for collecting copied notes, TXT/Markdown files, URLs, accounts, and API keys.

The app is built around a simple workflow: collect messy desktop text files, extract useful content, classify it, and search it later. Vault data stays on the local machine and is encrypted with scrypt plus AES-256-GCM.

> Built with AI coding models. Designed from real workflow problems.

## Features

- Local encrypted vault storage
- Desktop TXT/Markdown scan and import
- Automatic classification for URLs, accounts, secrets, resumes, job notes, API docs, and general notes
- Secret detection and redaction for API keys, tokens, passwords, private keys, JWTs, and connection strings
- Search, tags, archive, clipboard history, tray access, and global shortcut support
- Windows portable and zip builds

## Download

Windows builds are published from [GitHub Releases](https://github.com/mococouo/PasteVault/releases).

macOS packaging is kept separate under `packaging/mac/` because macOS app signing and final packaging should be done on macOS.

## Development

Requirements:

- Node.js 22 or newer
- npm

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Type-check:

```bash
npm run typecheck
```

Build the Windows release artifacts:

```bash
npm run dist:win
```

Start the Electron app in development:

```bash
npm run dev:desktop
```

## Privacy

PasteVault stores vault data locally at the Electron `userData` path. The vault file is not part of the repository and should not be committed.

## License

MIT
