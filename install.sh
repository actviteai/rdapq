#!/usr/bin/env bash
# RDAP-Q installer wrapper. The implementation lives in bin/rdapq.js.
# Refuse a piped launch: `curl | bash` cannot see the skill tree and older
# revisions deleted ~/.rdapq/skills/rdap-q before the copy failed.
set -euo pipefail

if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" == "-" || ! -f "${BASH_SOURCE[0]}" ]]; then
  echo "error: refusing a piped install (curl | bash / bash -s)." >&2
  echo "That path cannot see the skill tree and used to delete an existing install before failing." >&2
  echo "Use one of:" >&2
  echo "  git clone https://github.com/actviteai/rdapq.git && cd rdapq && ./install.sh --all" >&2
  echo "  npx @actvite/rdapq install --all" >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "$SCRIPT_DIR/rdap-q-skill/SKILL.md" || ! -f "$SCRIPT_DIR/bin/rdapq.js" ]]; then
  echo "error: install.sh must be run from a full RDAP-Q checkout." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js >= 22 is required. Install Node, then re-run ./install.sh or use npx @actvite/rdapq." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "error: Node.js >= 22 is required (found $(node -v))." >&2
  exit 1
fi

args=("$@")
if [[ $# -eq 0 ]]; then
  args=(install)
elif [[ "$1" != "install" && "$1" != "init" && "$1" != "status" && "$1" != "--help" && "$1" != "-h" ]]; then
  args=(install "$@")
fi

exec node "$SCRIPT_DIR/bin/rdapq.js" "${args[@]}"
