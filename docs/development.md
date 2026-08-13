# Development

This guide covers local setup, the repository layout, tests, debugging, and development builds. Read [CONTRIBUTING.md](../CONTRIBUTING.md) before proposing a change.

## Prerequisites

- Node.js 24 LTS. The pinned version is in [`.nvmrc`](../.nvmrc).
- npm, included with Node.js.
- Git.
- Platform build tools required by Electron native modules.

With `nvm` installed, select the repository version with:

```bash
nvm install
nvm use
```

## Set up and run

```bash
git clone https://github.com/solardev-xyz/freedom-browser.git
cd freedom-browser
npm ci
npm run ant:download
npm run ipfs:download
npm start
```

Swarm and IPFS start automatically by default. On macOS and Linux, install optional Radicle support with `npm run radicle:download`, then enable it under **Settings → Experimental** before using `rad://`. Radicle is unavailable on Windows.

## Repository layout

| Directory       | Responsibility                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/main/`     | Electron main process: node lifecycles, protocol handlers, IPC, persistence, permissions, downloads, and updates |
| `src/renderer/` | Browser UI: tabs, navigation, menus, settings, internal pages, and dApp integration                              |
| `src/shared/`   | Constants and utilities shared by the main and renderer processes                                                |
| `test-e2e/`     | Playwright harness and live Electron tests                                                                       |
| `config/`       | Ant configuration, default bookmarks, and platform entitlements                                                  |
| `scripts/`      | Build, binary-download, smoke-test, and maintenance helpers                                                      |
| `assets/`       | Application icons and packaged assets                                                                            |

Protocol and privileged logic belongs in the main process. The renderer talks to it through the IPC channels defined in `src/shared/ipc-channels.js`. Read the [architecture boundaries](agent-playbooks/architecture-boundaries.md) before adding files under `src/main/` or `src/renderer/`, creating an IPC channel, or moving logic between processes.

## Common npm scripts

| Script                      | Description                                         |
| --------------------------- | --------------------------------------------------- |
| `npm start`                 | Launch Electron in development mode                 |
| `npm run lint`              | Run ESLint                                          |
| `npm test`                  | Run the Jest unit suite                             |
| `npm run test:coverage`     | Run Jest with coverage                              |
| `npm run test:e2e`          | Run the deterministic Playwright harness suite      |
| `npm run test:e2e:live`     | Run live Ant, IPFS, and naming integration tests    |
| `npm run check-binaries`    | Validate packaged native binary targets             |
| `npm run ant:download`      | Download the pinned Ant binary                      |
| `npm run ipfs:download`     | Download the pinned freedom-ipfs native addon       |
| `npm run radicle:download`  | Download Radicle binaries for the current platform  |
| `npm run adblock:download`  | Download the packaged ad-blocking lists             |
| `npm run ipfs:native:smoke` | Smoke-test the native IPFS addon and retrieval path |
| `npm run ant:smoke-upload`  | Exercise a Swarm buy/upload/download round trip     |

The scripts in `package.json` are the authoritative list. Destructive reset scripts remove local development data; inspect their targets before using them.

## Testing

### Unit tests

Run all Jest tests:

```bash
npm test
```

Most source modules have a neighboring `.test.js` file. At minimum, run the corresponding test whenever you modify a tested module. Run `npm run lint` after every code change.

### End-to-end tests

Playwright has two projects:

| Suite     | Command                 | Behavior                                                                                 |
| --------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `harness` | `npm run test:e2e`      | Launches Electron with deterministic Ant/IPFS/naming stubs; fast and network-independent |
| `live`    | `npm run test:e2e:live` | Uses real nodes, protocols, and network resolution; requires downloaded binaries         |

Both suites use a temporary Electron `userData` directory and run sequentially. The full CI matrix covers the operating-system-specific and native-node checks that most contributors cannot reproduce locally.

## Logging and debugging

The main process uses `electron-log`:

| Environment               | Console             | File             |
| ------------------------- | ------------------- | ---------------- |
| Development (`npm start`) | `info` and above    | `info` and above |
| Packaged application      | `warn` and above    | `info` and above |
| `DEBUG=1`                 | `verbose` and above | `info` and above |

On macOS, log files are written under `~/Library/Logs/Freedom/`. Other platforms use the standard `electron-log` location.

Useful debugging surfaces:

- Open **Menu (☰) → Debug Console** for page console and navigation events.
- Inspect main-process output in the terminal.
- Use the webview context menu to open Chromium Developer Tools.
- Launch with `DEBUG=1 npm start` for verbose console logging.

## Development builds

Build an unpacked, unsigned application for the host platform with:

```bash
npm run build -- --mac --unsigned
```

Replace `--mac` with `--linux` or `--win` as appropriate. Linux cross-builds should use the Docker scripts because `better-sqlite3` must be compiled for the target architecture:

```bash
npm run dist:linux:x64:docker
npm run dist:linux:arm64:docker
```

Windows builds do not include Radicle because upstream does not publish Windows binaries. Signed releases, notarization, artifact verification, and deployment are maintainer workflows documented in the [release playbook](agent-playbooks/release-process.md).
