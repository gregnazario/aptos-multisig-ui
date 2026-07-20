// Stub for the `server-only` package under vitest. `server-only` ships a module
// that throws if imported into a client bundle; in the Node test environment
// there is no such boundary, so we alias it to this empty module (see
// vitest.config.ts) to allow server modules to be unit-tested directly.
export {};
