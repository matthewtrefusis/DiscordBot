declare module '*.wasm' {
  const value: WebAssembly.Module;
  export default value;
}

declare module '*.js';