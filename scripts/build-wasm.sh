#!/usr/bin/env bash
# Compiles the Rust statistical engine to WebAssembly and generates JS bindings
# using wasm-bindgen. The necessary tools are set up automatically, so that
# `npm run build` is the only project-specific command required.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: '$1' not found. Install Rust using rustup: https://rustup.rs/" >&2
    exit 1
  fi
}

require_command cargo
require_command rustup

WASM_TARGET="wasm32-unknown-unknown"
if ! rustup target list --installed | grep -Fxq "$WASM_TARGET"; then
  echo "Installing the Rust $WASM_TARGET target"
  rustup target add "$WASM_TARGET"
fi

# Keeping the CLI alignd with the wasm-bindgen crate resolved by Cargo avoids
# incompatibility errors in the generated metadata.
WASM_BINDGEN_VERSION="$({
  awk '
    $0 == "name = \"wasm-bindgen\"" { found = 1; next }
    found && $1 == "version" { gsub(/"/, "", $3); print $3; exit }
    found && /^\[/ { exit }
  ' engine/Cargo.lock
} || true)"

if [[ -z "$WASM_BINDGEN_VERSION" ]]; then
  echo "Error: Could not get version of wasm-bindgen from engine/Cargo.lock" >&2
  exit 1
fi

CARGO_BIN_DIR="$(dirname "$(command -v cargo)")"
WASM_BINDGEN_BIN="$(command -v wasm-bindgen || true)"
if [[ -z "$WASM_BINDGEN_BIN" && -x "$CARGO_BIN_DIR/wasm-bindgen" ]]; then
  WASM_BINDGEN_BIN="$CARGO_BIN_DIR/wasm-bindgen"
fi
WASM_BINDGEN_CURRENT=""
if [[ -n "$WASM_BINDGEN_BIN" ]]; then
  WASM_BINDGEN_CURRENT="$("$WASM_BINDGEN_BIN" --version 2>/dev/null | awk '{print $2}')"
fi

if [[ "$WASM_BINDGEN_CURRENT" != "$WASM_BINDGEN_VERSION" ]]; then
  echo "Installing wasm-bindgen-cli $WASM_BINDGEN_VERSION..."
  cargo install wasm-bindgen-cli --version "$WASM_BINDGEN_VERSION" --locked
  WASM_BINDGEN_BIN="$(command -v wasm-bindgen || true)"
  if [[ -z "$WASM_BINDGEN_BIN" && -x "$CARGO_BIN_DIR/wasm-bindgen" ]]; then
    WASM_BINDGEN_BIN="$CARGO_BIN_DIR/wasm-bindgen"
  fi
fi

if [[ -z "$WASM_BINDGEN_BIN" ]]; then
  echo "Error: wasm-bindgen-cli was installed, but its executable is not in PATH." >&2
  echo "Add Cargo's binary directory to PATH and try again." >&2
  exit 1
fi

cargo build --locked --manifest-path engine/Cargo.toml -p trend_wasm \
  --release --target "$WASM_TARGET"
"$WASM_BINDGEN_BIN" engine/target/$WASM_TARGET/release/trend_wasm.wasm \
  --target web --out-dir src/wasm/pkg
echo "WASM ready in src/wasm/pkg ($(du -h src/wasm/pkg/trend_wasm_bg.wasm | cut -f1))"
