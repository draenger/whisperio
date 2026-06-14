#!/usr/bin/env bash
# Whisperio — run without installing anything (macOS / Linux)
#
# Zero-install launcher: if Node.js is missing it downloads a portable copy
# into ./.node, installs dependencies, and starts the app. Nothing is written
# outside this folder, nothing is added to your system.
#
# Usage:  bash start.sh   (or: chmod +x start.sh && ./start.sh)

set -euo pipefail

# Portable Node version used when no suitable system Node is found.
NODE_VERSION="v22.11.0"
MIN_MAJOR=18

# Always operate from the script's own directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

printf '\n  \033[35mWhisperio - Global Dictation\033[0m\n\n'

if [ ! -f package.json ]; then
  printf '  \033[31mpackage.json not found next to start.sh - is the repo complete?\033[0m\n'
  exit 1
fi

node_ok() {
  command -v "$1" >/dev/null 2>&1 || return 1
  local v
  v="$("$1" -v 2>/dev/null | sed 's/^v//')" || return 1
  [ "${v%%.*}" -ge "$MIN_MAJOR" ] 2>/dev/null
}

# 1. Prefer a usable system Node, otherwise fall back to a portable one.
if node_ok node; then
  printf '  \033[90mUsing system Node.js %s\033[0m\n' "$(node -v)"
else
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *) printf '  \033[31mUnsupported OS: %s\033[0m\n' "$(uname -s)"; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) printf '  \033[31mUnsupported arch: %s\033[0m\n' "$(uname -m)"; exit 1 ;;
  esac

  node_name="node-${NODE_VERSION}-${os}-${arch}"
  node_dir="$ROOT/.node/$node_name"
  node_bin="$node_dir/bin"

  if [ ! -x "$node_bin/node" ]; then
    url="https://nodejs.org/dist/${NODE_VERSION}/${node_name}.tar.gz"
    printf '  \033[33mNo suitable Node.js found - downloading portable %s (%s-%s)...\033[0m\n' "$NODE_VERSION" "$os" "$arch"
    mkdir -p "$ROOT/.node"
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "$url" -o "$ROOT/.node/$node_name.tar.gz"
    else
      wget -qO "$ROOT/.node/$node_name.tar.gz" "$url"
    fi
    printf '  \033[33mExtracting...\033[0m\n'
    tar -xzf "$ROOT/.node/$node_name.tar.gz" -C "$ROOT/.node"
    rm -f "$ROOT/.node/$node_name.tar.gz"
  fi

  # Put the portable Node first on PATH for this session only.
  export PATH="$node_bin:$PATH"
  printf '  \033[90mUsing portable Node.js %s\033[0m\n' "$(node -v)"
fi

# 2. Install dependencies if missing.
if [ ! -d node_modules ]; then
  printf '  \033[33mInstalling dependencies (first run, this can take a few minutes)...\033[0m\n'
  npm install --loglevel error
  printf '  \033[32mDependencies installed.\033[0m\n'
fi

# 3. Launch.
printf '  \033[32mStarting Whisperio...\033[0m\n\n'
npm run dev
