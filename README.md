# Astra Sleuth

Rust tools for detecting trends and changed in enviromental time series.

This repository is part of the NASA Challenge 2026 porject and currently contains a depencendy-free Mann-Kendall analysis library.

## Development

Requirememts: Node.js, npm, and Rust (installed via [rustup](https://rustup.rs/)).

After running `npm install`, the full build process is performed using:

```sh
npm run build
```

The build script automatically installs the `wasm32-unknown-unknown` target and the version of `wasm-bindgen-cli` specified in `engine/Cargo.lock` if they are not already present. You can also build just the frontend by running:

```sh
npm run build:web
```

## Work in progress


