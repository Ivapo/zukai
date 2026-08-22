fn main() {
    // `[build-dependencies]` are host-compiled, so `Cargo.toml`'s target table
    // does not keep `tauri-build` out of a wasm32 build: it runs here and
    // panics with "missing `cargo:dev` instruction, please update tauri to
    // latest", which misdirects toward a version bump. Gating the *call* is the
    // fix, and after it the lib builds clean for wasm32.
    if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() != Ok("wasm32") {
        tauri_build::build()
    }
}
