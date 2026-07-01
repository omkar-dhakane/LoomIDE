# Project brief for AI agents (Codex, Claude Code, etc.)

## What this is

A desktop code editor, built to be AI-native from the ground up and forward-compatible
with a custom programming language we will build later. This file is the persistent
context for any AI coding agent working in this repo. Read it before making changes.

## Non-negotiable architecture decisions

Do not deviate from these without being explicitly asked to reconsider them.

- **Shell**: Tauri (Rust backend + native OS webview). Not Electron. Rationale: lower
  memory/CPU footprint, and a Rust backend gives us a natural home for a future
  language runtime/interpreter.
- **Editor engine**: Monaco Editor in the frontend. Do not build a custom text-editing
  engine (cursors, selection, undo stack, syntax highlighting) from scratch — Monaco
  already solves this.
- **Language support**: all language intelligence (completion, diagnostics, hover,
  go-to-definition, formatting) must go through the Language Server Protocol (LSP).
  Never hardcode language-specific logic into the editor core. This is what lets us
  add our own future language later by writing one LSP server for it, with zero
  changes to the editor itself.
- **AI integration**: all AI calls must go through a single provider-agnostic AI
  router module in the Rust core (a trait/interface with pluggable implementations —
  OpenAI, Anthropic, local models via Ollama). The UI never calls an AI provider
  directly; it only calls the router over IPC.
- **IPC boundary**: the frontend (UI layer) only talks to the Rust core through a
  defined IPC command/event interface. The frontend must never touch the filesystem,
  spawn processes, or make network requests directly — all of that lives in the core.

## Repo structure (target)

```
/src-ui/          React + TypeScript frontend, Monaco integration, panels
/src-core/        Rust backend (Tauri commands, LSP client, AI router, file I/O)
/src-core/lsp/     LSP client manager: spawn/talk to language servers over stdio
/src-core/ai/      AI router: provider trait + implementations
/src-core/fs/      File system commands exposed to the frontend over IPC
/extensions/       Future plugin API surface (leave stubbed for now)
```

## Coding conventions

- Rust: use `anyhow`/`thiserror` for error handling, prefer async (`tokio`) for
  IPC handlers, LSP I/O, and AI calls — none of these should block the UI thread.
- TypeScript/React: functional components, no class components. Keep Monaco
  integration isolated in its own module so it can be swapped/upgraded independently.
- All new features that touch language intelligence must be implementable for an
  arbitrary future language — if a design only works for languages with an existing
  LSP server, flag it instead of silently proceeding.

## What NOT to do

- Don't hardcode support for a specific language (e.g. Python-only completion logic)
  anywhere outside a language server.
- Don't call an AI provider's SDK directly from the frontend.
- Don't add a new AI provider without adding it to the router trait — no one-off
  provider-specific code paths in feature modules.
- Don't apply multi-file AI-generated changes directly to disk without going through
  the diff-review flow (once it exists).

## How to verify your work

- `cargo test` for the Rust core
- `cargo clippy -- -D warnings` before considering Rust changes done
- `npm run build && npm run typecheck` for the frontend
- Manually note in your summary which of the above you ran and the result

## Current phase

We are building incrementally, one phase at a time, in separate sessions. Only work
on the phase explicitly requested. Do not jump ahead to AI features, LSP integration,
or agent mode unless asked — get the current phase fully working and tested first.
