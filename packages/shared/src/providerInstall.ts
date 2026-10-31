// Fork: installers that put a missing provider CLI on the environment's machine.

export interface ProviderInstallRecipe {
  /** Runs in `sh -c` on macOS and Linux, and in PowerShell on Windows. */
  readonly command: string;
  /** Folders under the home directory where the installer puts the CLI. */
  readonly binDirs: ReadonlyArray<string>;
}

interface PlatformRecipes {
  readonly posix?: ProviderInstallRecipe;
  readonly windows?: ProviderInstallRecipe;
}

// npm's global bin folder is normally on PATH already.
const npmGlobal = (packageName: string): ProviderInstallRecipe => ({
  command: `npm install -g ${packageName}`,
  binDirs: [],
});

const RECIPES: Readonly<Record<string, PlatformRecipes>> = {
  claudeAgent: {
    posix: { command: "curl -fsSL https://claude.ai/install.sh | bash", binDirs: [".local/bin"] },
    windows: { command: "irm https://claude.ai/install.ps1 | iex", binDirs: [".local/bin"] },
  },
  codex: {
    posix: {
      command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
      binDirs: [".local/bin"],
    },
    windows: npmGlobal("@openai/codex"),
  },
  cursor: {
    posix: { command: "curl -fsS https://cursor.com/install | bash", binDirs: [".local/bin"] },
  },
  opencode: {
    posix: { command: "curl -fsSL https://opencode.ai/install | bash", binDirs: [".opencode/bin"] },
    windows: npmGlobal("opencode-ai"),
  },
  grok: { posix: npmGlobal("@xai-official/grok"), windows: npmGlobal("@xai-official/grok") },
  pi: {
    posix: npmGlobal("@earendil-works/pi-coding-agent"),
    windows: npmGlobal("@earendil-works/pi-coding-agent"),
  },
  fx: {
    posix: {
      command: "curl -fsSL https://fx.sh/setup.sh | bash",
      binDirs: [".local/bin", ".fx/bin"],
    },
  },
};

export function resolveProviderInstallRecipe(
  driver: string,
  isWindows: boolean,
): ProviderInstallRecipe | null {
  const recipes = RECIPES[driver];
  return (isWindows ? recipes?.windows : recipes?.posix) ?? null;
}
