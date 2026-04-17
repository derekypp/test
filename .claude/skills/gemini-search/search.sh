#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: search.sh <query>" >&2
  exit 2
fi

if ! command -v gemini >/dev/null 2>&1; then
  echo "Error: 'gemini' CLI not found in PATH. Install it from https://github.com/google-gemini/gemini-cli and authenticate." >&2
  exit 127
fi

query="$*"
prompt="Use web search to answer concisely. Cite source URLs inline. Question: ${query}"

gemini -p "$prompt"
