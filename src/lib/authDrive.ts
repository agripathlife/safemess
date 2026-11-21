import {initializeApp} from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import type {SafeMessVault} from '../types/safemess';

export const SCOPES = ['https://www.googleapis.com/auth/drive.appdata'];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

let isSigningIn = false;
// Access token stored exclusively in memory (never localStorage or sessionStorage)
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.();
    }
  });
};

export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
}> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Không nhận được mã truy cập Google Drive từ phiên đăng nhập.');
    }
    cachedAccessToken = credential.accessToken;
    return {user: result.user, accessToken: cachedAccessToken};
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = (): string | null => cachedAccessToken;

export const logout = async (): Promise<void> => {
  cachedAccessToken = null;
  await auth.signOut();
};

const VAULT_FILE_NAME = 'safemess_vault.json';

export async function loadVaultFromDrive(accessToken: string): Promise<{
  fileId: string | null;
  vault: SafeMessVault | null;
}> {
  const listUrl = new URL('https://www.googleapis.com/drive/v3/files');
  listUrl.searchParams.set('spaces', 'appDataFolder');
  listUrl.searchParams.set('q', `name = '${VAULT_FILE_NAME}' and trashed = false`);
  listUrl.searchParams.set('fields', 'files(id, name, modifiedTime)');
  listUrl.searchParams.set('pageSize', '5');

  const listRes = await fetch(listUrl.toString(), {
    headers: {Authorization: `Bearer ${accessToken}`},
  });

  if (!listRes.ok) {
    const errText = await listRes.text();
    throw new Error(`Lỗi truy cập Google Drive appDataFolder (${listRes.status}): ${errText}`);
  }

  const listJson = (await listRes.json()) as {
    files?: Array<{id: string; name: string}>;
  };

  const existing = listJson.files?.[0];
  if (!existing) {
    return {fileId: null, vault: null};
  }

  const downloadRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(existing.id)}?alt=media`,
    {
      headers: {Authorization: `Bearer ${accessToken}`},
    }
  );

  if (!downloadRes.ok) {
    throw new Error(`Không thể tải tệp khóa từ Google Drive (${downloadRes.status}).`);
  }

  const vault = (await downloadRes.json()) as SafeMessVault;
  return {fileId: existing.id, vault};
}

export async function saveVaultToDrive(
  accessToken: string,
  vault: SafeMessVault,
  existingFileId: string | null
): Promise<string> {
  const boundary = `safemess_${crypto.randomUUID().replace(/-/g, '')}`;
  const metadata = existingFileId
    ? {name: VAULT_FILE_NAME}
    : {name: VAULT_FILE_NAME, parents: ['appDataFolder']};

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(vault),
    `--${boundary}--`,
  ].join('\r\n');

  const endpoint = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId)}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

  const res = await fetch(endpoint, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Lỗi đồng bộ Google Drive appDataFolder (${res.status}): ${errText}`);
  }

  const saved = (await res.json()) as {id: string};
  return saved.id;
}
