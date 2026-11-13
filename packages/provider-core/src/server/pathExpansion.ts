// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

// Spawned processes lack shell expansion and would treat literal ~/ paths as relative.
export function expandHomePath(value: string, home: string): string {
  if (!value) return value;
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return NodePath.join(home, value.slice(2));
  }
  return value;
}

// Fork: PI_CODING_AGENT_DIR also holds a login, so added accounts can set it with `~`.
const HOME_PATH_VARIABLES = new Set([
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "GROK_HOME",
  "PI_CODING_AGENT_DIR",
]);

export function expandHomeVariable(name: string, value: string, home: string): string {
  return HOME_PATH_VARIABLES.has(name) ? expandHomePath(value, home) : value;
}
