function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i);
  }
  return arr;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function isPlatformBiometricAvailable(): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    !window.PublicKeyCredential ||
    !PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable
  ) {
    return false;
  }
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function registerBiometricPasskey(
  peerId: string,
  displayName: string
): Promise<string | null> {
  const available = await isPlatformBiometricAvailable();
  if (!available) return null;

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = new TextEncoder().encode(peerId).slice(0, 64);

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        name: 'SafeMess',
      },
      user: {
        id: userId,
        name: displayName,
        displayName,
      },
      pubKeyCredParams: [
        {alg: -7, type: 'public-key'},
        {alg: -257, type: 'public-key'},
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
      },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;

  if (!credential) return null;
  return arrayBufferToBase64Url(credential.rawId);
}

export async function authenticateBiometricPasskey(credentialIdB64Url: string): Promise<boolean> {
  const available = await isPlatformBiometricAvailable();
  if (!available) return false;

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const rawId = base64UrlToUint8Array(credentialIdB64Url);

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [
        {
          id: new Uint8Array(rawId),
          type: 'public-key',
        },
      ],
      userVerification: 'required',
      timeout: 60_000,
    },
  });

  return Boolean(assertion);
}
