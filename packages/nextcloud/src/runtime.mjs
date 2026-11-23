import {sha256} from '@nextspace/core/digest.mjs';
export {sha256};

/** Browser/native-safe bytes and identity hashing. No platform globals are patched. */
const encoder = new TextEncoder();
// Preserve a leading BOM exactly as the existing Node UTF-8 transport does.
const decoder = new TextDecoder('utf-8', {ignoreBOM: true});
export const utf8 = value => encoder.encode(value);
export const utf8Text = value => decoder.decode(value);
export const byteLength = value => typeof value === 'string' ? utf8(value).length : value.byteLength;
export const bytesEqual = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
export function concatBytes(chunks, size = chunks.reduce((total, chunk) => total + chunk.length, 0)) {
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
export function base64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x4000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x4000));
  return btoa(binary);
}

/** Exact equality for JSON protocol values, including key order independence. */
export function jsonEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right) || Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;
  const leftKeys = Object.keys(left), rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  if (Array.isArray(left) && left.length !== right.length) return false;
  return leftKeys.every(key => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]));
}

export const portableRuntime = Object.freeze({sha256, randomUUID: () => globalThis.crypto.randomUUID()});
