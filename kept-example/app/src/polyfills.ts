import "react-native-get-random-values"; // crypto.getRandomValues for web3.js + proof hashes
import { Buffer } from "buffer";

if (typeof global.Buffer === "undefined") {
  global.Buffer = Buffer;
}

// Fix for Hermes JS engine: Object.setPrototypeOf(Uint8Array, Buffer.prototype)
// drops methods. We must explicitly copy them to Uint8Array.prototype so that
// @solana/buffer-layout can use .readUIntLE() etc on decoded buffers.
for (const key of Object.getOwnPropertyNames(Buffer.prototype)) {
  if (key !== "constructor" && !(key in Uint8Array.prototype)) {
    (Uint8Array.prototype as any)[key] = (Buffer.prototype as any)[key];
  }
}
