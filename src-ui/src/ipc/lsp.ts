import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { LspDiagnosticsEvent } from "../types/lsp";

const LSP_DIAGNOSTICS_EVENT = "lsp-diagnostics";

export function startLanguageServer(
  serverId: string,
  command: string,
  args: string[],
  rootUri: string,
): Promise<void> {
  return invoke("lsp_start", { serverId, command, args, rootUri });
}

export function stopLanguageServer(serverId: string): Promise<void> {
  return invoke("lsp_stop", { serverId });
}

export function lspDidOpen(
  serverId: string,
  uri: string,
  languageId: string,
  version: number,
  text: string,
): Promise<void> {
  return invoke("lsp_did_open", { serverId, uri, languageId, version, text });
}

export function lspDidChange(
  serverId: string,
  uri: string,
  version: number,
  text: string,
): Promise<void> {
  return invoke("lsp_did_change", { serverId, uri, version, text });
}

export function lspDidClose(serverId: string, uri: string): Promise<void> {
  return invoke("lsp_did_close", { serverId, uri });
}

export function lspCompletion(
  serverId: string,
  uri: string,
  line: number,
  character: number,
): Promise<unknown> {
  return invoke("lsp_completion", { serverId, uri, line, character });
}

export function lspHover(
  serverId: string,
  uri: string,
  line: number,
  character: number,
): Promise<unknown> {
  return invoke("lsp_hover", { serverId, uri, line, character });
}

export function listenToLspDiagnostics(
  handler: (event: LspDiagnosticsEvent) => void,
): Promise<UnlistenFn> {
  return listen<LspDiagnosticsEvent>(LSP_DIAGNOSTICS_EVENT, (event) => handler(event.payload));
}
