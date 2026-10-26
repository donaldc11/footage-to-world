import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({ prompt: 'select_account' });

// Flag to indicate if we are in the middle of a sign-in flow.
let isSigningIn = false;
// Cache the access token strictly in memory (never in localStorage/sessionStorage).
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google Drive access token from sign-in.');
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

export interface DriveFolderInfo {
  id: string;
  name: string;
}

export interface DriveVideoFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  thumbnailLink?: string;
  thumbnailDataUrl?: string;
  folderName?: string;
  width?: number;
  height?: number;
  durationMillis?: string;
}

export interface CandidateEvaluation {
  fileId: string;
  suitabilityScore: number;
  isTopPick: boolean;
  reason: string;
}

async function driveFetchJson(url: string, token: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401 || res.status === 403) {
    cachedAccessToken = null;
    throw new Error('AUTH_REQUIRED');
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(
      errData?.error?.message || `Google Drive API error (${res.status}).`
    );
  }

  return res.json();
}

async function fetchThumbnailAsDataUrl(thumbnailLink: string, token: string): Promise<string | undefined> {
  try {
    const res = await fetch(thumbnailLink, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));
      reader.onerror = () => reject();
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

/**
 * Specifically searches the user's Google Drive for folders named "drone footage"
 * (or containing "drone" / "footage"), including 1 level of subfolders inside them,
 * and returns all video files inside those folders.
 */
export async function scanDroneFootageFolders(): Promise<{
  matchedFolders: DriveFolderInfo[];
  videos: DriveVideoFile[];
}> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('AUTH_REQUIRED');
  }

  // 1. Find folders matching "drone footage" or "drone"
  const folderQuery =
    "trashed = false and mimeType = 'application/vnd.google-apps.folder' and (name contains 'drone' or name contains 'Drone' or name contains 'DRONE' or name contains 'footage' or name contains 'Footage')";
  const folderParams = new URLSearchParams({
    q: folderQuery,
    fields: 'files(id,name)',
    pageSize: '25',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  const folderData = await driveFetchJson(
    `https://www.googleapis.com/drive/v3/files?${folderParams.toString()}`,
    token
  );

  let matchedFolders: DriveFolderInfo[] = Array.isArray(folderData.files) ? folderData.files : [];

  // Prioritize folders whose name explicitly includes "drone footage"
  const exactMatches = matchedFolders.filter((f) =>
    f.name.toLowerCase().includes('drone footage')
  );
  if (exactMatches.length > 0) {
    matchedFolders = [
      ...exactMatches,
      ...matchedFolders.filter((f) => !f.name.toLowerCase().includes('drone footage')),
    ];
  }

  if (matchedFolders.length === 0) {
    return { matchedFolders: [], videos: [] };
  }

  // Also check for any immediate subfolders inside the matched folders
  const allFoldersMap = new Map<string, string>();
  matchedFolders.forEach((f) => allFoldersMap.set(f.id, f.name));

  const parentClause = matchedFolders
    .slice(0, 10)
    .map((f) => `'${f.id}' in parents`)
    .join(' or ');

  const subFolderParams = new URLSearchParams({
    q: `trashed = false and mimeType = 'application/vnd.google-apps.folder' and (${parentClause})`,
    fields: 'files(id,name,parents)',
    pageSize: '50',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  try {
    const subData = await driveFetchJson(
      `https://www.googleapis.com/drive/v3/files?${subFolderParams.toString()}`,
      token
    );
    if (Array.isArray(subData.files)) {
      for (const sf of subData.files) {
        const parentId = Array.isArray(sf.parents) ? sf.parents[0] : '';
        const parentName = allFoldersMap.get(parentId);
        allFoldersMap.set(sf.id, parentName ? `${parentName} / ${sf.name}` : sf.name);
      }
    }
  } catch {
    // Ignore subfolder lookup errors
  }

  const allFolderIds = Array.from(allFoldersMap.keys());
  const folderParentsClause = allFolderIds
    .slice(0, 20)
    .map((id) => `'${id}' in parents`)
    .join(' or ');

  const videoQuery = `trashed = false and (${folderParentsClause}) and (mimeType contains 'video/' or name contains '.mp4' or name contains '.MP4' or name contains '.mov' or name contains '.MOV' or name contains '.webm')`;
  const videoParams = new URLSearchParams({
    q: videoQuery,
    fields:
      'files(id,name,mimeType,size,modifiedTime,thumbnailLink,parents,videoMediaMetadata(width,height,durationMillis))',
    orderBy: 'modifiedTime desc',
    pageSize: '40',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  const videoData = await driveFetchJson(
    `https://www.googleapis.com/drive/v3/files?${videoParams.toString()}`,
    token
  );

  const rawFiles: any[] = Array.isArray(videoData.files) ? videoData.files : [];
  const videos: DriveVideoFile[] = await Promise.all(
    rawFiles.map(async (f) => {
      const parentId = Array.isArray(f.parents) ? f.parents[0] : '';
      const folderName = allFoldersMap.get(parentId) || matchedFolders[0]?.name || 'drone footage';
      const thumbnailDataUrl = f.thumbnailLink
        ? await fetchThumbnailAsDataUrl(f.thumbnailLink, token)
        : undefined;

      return {
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        modifiedTime: f.modifiedTime,
        thumbnailLink: f.thumbnailLink,
        thumbnailDataUrl,
        folderName,
        width: f.videoMediaMetadata?.width,
        height: f.videoMediaMetadata?.height,
        durationMillis: f.videoMediaMetadata?.durationMillis,
      };
    })
  );

  return { matchedFolders, videos };
}

export async function listDriveVideoFiles(searchQuery = ''): Promise<DriveVideoFile[]> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('AUTH_REQUIRED');
  }

  let q =
    "trashed = false and (mimeType contains 'video/' or name contains '.mp4' or name contains '.MP4' or name contains '.mov' or name contains '.MOV' or name contains '.webm')";
  const trimmed = searchQuery.trim();
  if (trimmed) {
    const escaped = trimmed.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    q += ` and name contains '${escaped}'`;
  }

  const params = new URLSearchParams({
    q,
    fields:
      'files(id,name,mimeType,size,modifiedTime,thumbnailLink,videoMediaMetadata(width,height,durationMillis))',
    orderBy: 'modifiedTime desc',
    pageSize: '30',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  const data = await driveFetchJson(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    token
  );
  const rawFiles: any[] = Array.isArray(data.files) ? data.files : [];

  return rawFiles.map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size,
    modifiedTime: f.modifiedTime,
    thumbnailLink: f.thumbnailLink,
    width: f.videoMediaMetadata?.width,
    height: f.videoMediaMetadata?.height,
    durationMillis: f.videoMediaMetadata?.durationMillis,
  }));
}

export async function downloadDriveVideoBlob(
  fileId: string,
  mimeType = 'video/mp4'
): Promise<Blob> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('AUTH_REQUIRED');
  }

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId
    )}?alt=media&supportsAllDrives=true`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (res.status === 401 || res.status === 403) {
    cachedAccessToken = null;
    throw new Error('AUTH_REQUIRED');
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Failed to download video from Google Drive (${res.status}): ${errText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return new Blob([arrayBuffer], { type: mimeType || 'video/mp4' });
}
