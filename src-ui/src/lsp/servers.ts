import { startLanguageServer } from "../ipc/lsp";
import type { LanguageServerSpec } from "../types/lsp";

/**
 * Language servers LoomIDE knows how to launch. A server is only started if
 * its executable is found on PATH; otherwise it is skipped silently.
 */
export const KNOWN_SERVERS: LanguageServerSpec[] = [
  {
    id: "typescript",
    languages: ["typescript", "javascript"],
    command: "typescript-language-server",
    args: ["--stdio"],
  },
  {
    id: "rust",
    languages: ["rust"],
    command: "rust-analyzer",
    args: [],
  },
  {
    id: "python",
    languages: ["python"],
    command: "pylsp",
    args: [],
  },
  {
    id: "markdown",
    languages: ["markdown"],
    command: "marksman",
    args: ["server"],
  },
];

const runningServers = new Set<string>();

export function uriForPath(path: string): string {
  const normalized = path
    .replace(/\\/g, "/")
    .replace(/ /g, "%20")
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F");
  return `file:///${normalized.replace(/^\/+/, "")}`;
}

export function serverForLanguage(language: string): LanguageServerSpec | null {
  const spec = KNOWN_SERVERS.find(
    (server) => server.languages.includes(language) && runningServers.has(server.id),
  );
  return spec ?? null;
}

export function isServerRunning(serverId: string): boolean {
  return runningServers.has(serverId);
}

/**
 * Try to start every known server for the opened workspace. Servers that are
 * not installed simply fail to spawn and are skipped.
 */
export async function startLanguageServers(rootPath: string): Promise<string[]> {
  const rootUri = uriForPath(rootPath);
  const started: string[] = [];

  for (const spec of KNOWN_SERVERS) {
    if (runningServers.has(spec.id)) {
      started.push(spec.id);
      continue;
    }
    try {
      await startLanguageServer(spec.id, spec.command, spec.args, rootUri);
      runningServers.add(spec.id);
      started.push(spec.id);
    } catch {
      // Server not installed or failed to start: LSP stays optional.
    }
  }

  return started;
}

export function markServerStopped(serverId: string): void {
  runningServers.delete(serverId);
}
