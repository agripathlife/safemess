import type {QrPairingPayload, SafeMessIdentity} from '../types/safemess';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function wipeBuffer(buf: Uint8Array | null | undefined): void {
  if (buf) {
    buf.fill(0);
  }
}

export async function computeKeyFingerprint(publicKeyJwk: JsonWebKey): Promise<string> {
  const canonical = JSON.stringify({
    crv: publicKeyJwk.crv,
    kty: publicKeyJwk.kty,
    x: publicKeyJwk.x,
    y: publicKeyJwk.y,
  });
  const encoded = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const hex = Array.from(new Uint8Array(digest))
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  return `SM-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

export async function generateIdentity(
  peerId: string,
  displayName: string
): Promise<SafeMessIdentity> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveKey', 'deriveBits']
  );

  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const fingerprint = await computeKeyFingerprint(publicKeyJwk);

  return {
    peerId,
    displayName,
    publicKeyJwk,
    privateKeyJwk,
    fingerprint,
    createdAt: Date.now(),
  };
}

export async function deriveSharedAesKey(
  myPrivateKeyJwk: JsonWebKey,
  peerPublicKeyJwk: JsonWebKey
): Promise<CryptoKey> {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    myPrivateKeyJwk,
    {name: 'ECDH', namedCurve: 'P-256'},
    false,
    ['deriveKey']
  );

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    peerPublicKeyJwk,
    {name: 'ECDH', namedCurve: 'P-256'},
    false,
    []
  );

  return crypto.subtle.deriveKey(
    {name: 'ECDH', public: publicKey},
    privateKey,
    {name: 'AES-GCM', length: 256},
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptAesGcm(
  aesKey: CryptoKey,
  plaintext: string
): Promise<{iv: string; ct: string}> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuffer = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, aesKey, encoded);
  wipeBuffer(encoded);
  return {
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(cipherBuffer)),
  };
}

export async function decryptAesGcm(
  aesKey: CryptoKey,
  payload: {iv: string; ct: string}
): Promise<string> {
  const iv = fromBase64(payload.iv);
  const ct = fromBase64(payload.ct);
  const plainBuffer = await crypto.subtle.decrypt(
    {name: 'AES-GCM', iv: new Uint8Array(iv)},
    aesKey,
    new Uint8Array(ct)
  );
  const plainBytes = new Uint8Array(plainBuffer);
  const text = new TextDecoder().decode(plainBytes);
  wipeBuffer(plainBytes);
  return text;
}

export async function hashPin(pin: string): Promise<{saltB64: string; hashB64: string}> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return {
    saltB64: toBase64(salt),
    hashB64: toBase64(new Uint8Array(bits)),
  };
}

export async function verifyPin(pin: string, saltB64: string, hashB64: string): Promise<boolean> {
  const salt = fromBase64(saltB64);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(salt),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  const candidate = toBase64(new Uint8Array(bits));
  return candidate === hashB64;
}

export function encodePairingQr(payload: QrPairingPayload): string {
  return JSON.stringify(payload);
}

export async function parseAndVerifyPairingQr(raw: string): Promise<QrPairingPayload> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    throw new Error('Mã QR không đúng định dạng SafeMess.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Dữ liệu mã QR không hợp lệ.');
  }

  const obj = parsed as Record<string, unknown>;
  if (
    obj.v !== 1 ||
    typeof obj.peerId !== 'string' ||
    !obj.peerId.trim() ||
    typeof obj.displayName !== 'string' ||
    !obj.displayName.trim() ||
    !obj.publicKeyJwk ||
    typeof obj.publicKeyJwk !== 'object' ||
    typeof obj.fingerprint !== 'string'
  ) {
    throw new Error('Mã QR thiếu khóa xác thực SafeMess.');
  }

  const jwk = obj.publicKeyJwk as JsonWebKey;
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    throw new Error('Khóa công khai trong mã QR không hợp lệ.');
  }

  const recomputed = await computeKeyFingerprint(jwk);
  if (recomputed !== obj.fingerprint) {
    throw new Error('Dấu vân tay khóa mã hóa không khớp — nghi ngờ giả mạo.');
  }

  return {
    v: 1,
    peerId: obj.peerId.trim(),
    displayName: obj.displayName.trim(),
    publicKeyJwk: jwk,
    fingerprint: recomputed,
  };
}
