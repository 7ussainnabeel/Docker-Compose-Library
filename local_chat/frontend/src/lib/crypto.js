const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const SALT = textEncoder.encode('lan-messenger-v1-salt');

function hasWebCrypto() {
  return typeof crypto !== 'undefined' && Boolean(crypto.subtle);
}

function toBase64(bytes) {
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveKey(secret) {
  const baseKey = await crypto.subtle.importKey('raw', textEncoder.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: 120000,
      salt: SALT
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptJson(secret, data) {
  if (!hasWebCrypto()) {
    const payload = textEncoder.encode(JSON.stringify(data));
    return {
      alg: 'PLAINTEXT',
      iv: '',
      cipher: toBase64(payload)
    };
  }

  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = textEncoder.encode(JSON.stringify(data));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);

  return {
    alg: 'AES-GCM',
    iv: toBase64(iv),
    cipher: toBase64(new Uint8Array(encrypted))
  };
}

export async function decryptJson(secret, encrypted) {
  if (!hasWebCrypto() || encrypted?.alg === 'PLAINTEXT') {
    return JSON.parse(textDecoder.decode(fromBase64(encrypted.cipher)));
  }

  const key = await deriveKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(encrypted.iv) },
    key,
    fromBase64(encrypted.cipher)
  );

  return JSON.parse(textDecoder.decode(decrypted));
}

export async function encryptBytes(secret, bytes) {
  if (!hasWebCrypto()) {
    return {
      alg: 'PLAINTEXT',
      iv: '',
      cipher: toBase64(bytes)
    };
  }

  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return {
    alg: 'AES-GCM',
    iv: toBase64(iv),
    cipher: toBase64(new Uint8Array(encrypted))
  };
}

export async function decryptBytes(secret, encrypted) {
  if (!hasWebCrypto() || encrypted?.alg === 'PLAINTEXT') {
    return fromBase64(encrypted.cipher);
  }

  const key = await deriveKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(encrypted.iv) },
    key,
    fromBase64(encrypted.cipher)
  );
  return new Uint8Array(decrypted);
}
