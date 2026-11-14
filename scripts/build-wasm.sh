#!/usr/bin/env bash
# Compila el motor estadístico Rust a WebAssembly y genera los bindings JS con wasm-bindgen.
# Requisitos: target wasm32-unknown-unknown y wasm-bindgen-cli con la MISMA versión que
# el crate wasm-bindgen de engine/Cargo.lock:
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-bindgen-cli --version "$(grep -A1 'name = "wasm-bindgen"$' engine/Cargo.lock | sed -n 's/version = "\(.*\)"/\1/p')"
set -euo pipefail
cd "$(dirname "$0")/.."

cargo build --manifest-path engine/Cargo.toml -p trend_wasm --release --target wasm32-unknown-unknown
wasm-bindgen engine/target/wasm32-unknown-unknown/release/trend_wasm.wasm \
  --target web --out-dir src/wasm/pkg
echo "WASM listo en src/wasm/pkg ($(du -h src/wasm/pkg/trend_wasm_bg.wasm | cut -f1))"
