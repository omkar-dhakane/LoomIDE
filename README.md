# LoomIDE

An AI-native desktop code editor — built to be light, fast, and ready to host a
custom programming language in the future.

- **Shell:** [Tauri](https://tauri.app) (Rust core + native webview) — not Electron
- **Editor:** Monaco (the editor engine from VS Code)
- **Language intelligence:** 100% LSP — no language-specific logic in the editor
- **AI:** provider-agnostic router in the Rust core — OpenAI, Anthropic, or local
  models via Ollama, all streaming

## Features

- 📂 File explorer with create / rename / delete, live file-watcher refresh
- 🗂️ Tabs, save (Ctrl+S), dirty markers, per-extension syntax highlighting
- 🧠 LSP: completion, hover, go-to-definition, references, rename symbol,
  document formatting, diagnostics squiggles
- 🤖 Streaming AI chat with the active file as context
- ✨ "AI edit" with mandatory **diff review** — nothing is written to disk until
  you click *Apply*
- 🔑 API keys are stored by the Rust core in the OS app-config directory and
  never readable from the UI

## Getting started

**Prerequisites (Windows):** Node.js 20+, Rust (stable), Visual Studio Build
Tools with the MSVC toolchain + Windows SDK. WebView2 (preinstalled on
Windows 10/11).

```bash
npm install
npm run dev
```

Open a folder, and LoomIDE will automatically start any of these language
servers it finds on your PATH:

| Language | Server | Install |
|---|---|---|
| TypeScript/JS | `typescript-language-server` | `npm i -g typescript-language-server typescript` |
| Rust | `rust-analyzer` | `rustup component add rust-analyzer` |
| Python | `pylsp` | `pip install python-lsp-server` |
| Markdown | `marksman` | see marksman releases |

For AI chat: paste an OpenAI/Anthropic API key in the chat panel, or run
[Ollama](https://ollama.com) locally (no key needed).

## Architecture

```
src-ui/       React + TypeScript frontend (Monaco, panels, LSP/AI glue)
src-core/     Rust core — Tauri commands
src-core/src/fs/    Sandboxed filesystem commands + watcher
src-core/src/lsp/   Generic LSP client over stdio
src-core/src/ai/    Provider-agnostic AI router (OpenAI/Anthropic/Ollama)
extensions/         Placeholder for the future plugin API
```

All UI ↔ backend communication goes through Tauri IPC commands; the webview
never touches the filesystem, network, or process spawning directly.

## Development

```bash
cargo test --manifest-path src-core/Cargo.toml
cargo clippy --manifest-path src-core/Cargo.toml -- -D warnings
npm run typecheck && npm run build
```

## Roadmap

- [ ] Agent mode (multi-step AI tasks)
- [ ] Multi-file AI edits
- [ ] Extension/plugin API
- [ ] Git integration UI
- [ ] Custom language runtime in the Rust core

## License

[MIT](LICENSE) © 2026 Omkar Dhakane
