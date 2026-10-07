import wasmModule from './dist/main.wasm';

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const signature = request.headers.get('x-signature-ed25519');
    const timestamp = request.headers.get('x-signature-timestamp');
    const body = await request.text();

    // Instantiate Java Wasm module
    const instance = await WebAssembly.instantiate(wasmModule, {});
    
    // Call exported Java function
    return instance.exports.handleRequest(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
  }
};