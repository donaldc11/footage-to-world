import React, { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import {
  CheckCircle2,
  Download,
  Film,
  FolderSearch,
  HardDrive,
  Link2,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  Upload,
  X,
} from 'lucide-react';
import {
  CandidateEvaluation,
  downloadDriveVideoBlob,
  DriveFolderInfo,
  DriveVideoFile,
  googleSignIn,
  initAuth,
  listDriveVideoFiles,
  logout,
  scanDroneFootageFolders,
} from '../utils/googleDriveAuth';

interface GoogleDriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVideoLoaded: (blob: Blob, fileName: string) => Promise<void>;
  onDirectServerClipLoaded: (clipUrl: string, fileName: string, fileId?: string) => Promise<void>;
  onOpenLocalFilePicker: () => void;
}

function formatFileSize(bytesStr?: string): string {
  if (!bytesStr) return 'Video clip';
  const bytes = Number(bytesStr);
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Video clip';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  return `${Math.round(kb)} KB`;
}

function formatDurationMillis(msStr?: string): string | null {
  if (!msStr) return null;
  const ms = Number(msStr);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const GoogleDriveModal: React.FC<GoogleDriveModalProps> = ({
  isOpen,
  onClose,
  onVideoLoaded,
  onDirectServerClipLoaded,
  onOpenLocalFilePicker,
}) => {
  const [needsAuth, setNeedsAuth] = useState<boolean>(true);
  const [user, setUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  // Shared Drive Link state (works WITHOUT logging into the lab account!)
  const [sharedLinkInput, setSharedLinkInput] = useState<string>('');
  const [isInspectingLink, setIsInspectingLink] = useState<boolean>(false);
  const [sharedLinkFiles, setSharedLinkFiles] = useState<DriveVideoFile[]>([]);

  const [viewTab, setViewTab] = useState<'sharedLink' | 'droneFolder' | 'allVideos'>('sharedLink');
  const [matchedFolders, setMatchedFolders] = useState<DriveFolderInfo[]>([]);
  const [folderVideos, setFolderVideos] = useState<DriveVideoFile[]>([]);
  const [evaluations, setEvaluations] = useState<Record<string, CandidateEvaluation>>({});
  const [folderSummary, setFolderSummary] = useState<string>('');
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);

  const [allFiles, setAllFiles] = useState<DriveVideoFile[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = initAuth(
      (authedUser) => {
        setUser(authedUser);
        setNeedsAuth(false);
        setViewTab('droneFolder');
      },
      () => {
        setUser(null);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isOpen && !needsAuth) {
      if (viewTab === 'droneFolder') {
        scanAndEvaluateDroneFolder();
      } else if (viewTab === 'allVideos') {
        fetchAllDriveVideos(searchQuery);
      }
    }
  }, [isOpen, needsAuth, viewTab]);

  const runArgonEvaluation = async (videos: DriveVideoFile[]) => {
    if (videos.length === 0) return;
    setIsEvaluating(true);
    try {
      const res = await fetch('/api/argon/evaluate-drive-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidates: videos }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.folderSummary) {
        setFolderSummary(data.folderSummary);
      }
      if (Array.isArray(data.evaluations)) {
        const map: Record<string, CandidateEvaluation> = {};
        data.evaluations.forEach((ev: CandidateEvaluation) => {
          map[ev.fileId] = ev;
        });
        setEvaluations(map);
      }
    } catch {
      // Non-fatal
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleDownloadFromSharedLink = async (file: DriveVideoFile) => {
    setErrorMsg(null);
    setDownloadingFileId(file.id);
    try {
      const res = await fetch('/api/drive-link/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: file.id, fileName: file.name }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not access video from shared Drive link.');
      }
      if (data.clip?.url) {
        onClose();
        await onDirectServerClipLoaded(data.clip.url, data.clip.fileName, file.id);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to download video from shared Drive link.');
    } finally {
      setDownloadingFileId(null);
    }
  };

  const handleInspectSharedLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sharedLinkInput.trim()) return;
    setErrorMsg(null);
    setIsInspectingLink(true);
    setFolderSummary('');
    setEvaluations({});
    try {
      const res = await fetch('/api/drive-link/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driveUrl: sharedLinkInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not inspect that Google Drive link.');
      }

      const foundFiles: DriveVideoFile[] = Array.isArray(data.files) ? data.files : [];
      setSharedLinkFiles(foundFiles);
      setIsInspectingLink(false);

      // If it's a single video file link, immediately load and start extracting keyframes!
      if (data.type === 'file' && foundFiles.length === 1) {
        await handleDownloadFromSharedLink(foundFiles[0]);
        return;
      }

      if (foundFiles.length > 0) {
        await runArgonEvaluation(foundFiles);
      }
    } catch (err: any) {
      setIsInspectingLink(false);
      setErrorMsg(err.message || 'Failed to inspect shared Google Drive link.');
    }
  };

  const scanAndEvaluateDroneFolder = async () => {
    setErrorMsg(null);
    setIsLoadingFiles(true);
    setFolderSummary('');
    setEvaluations({});
    try {
      const { matchedFolders: foundFolders, videos } = await scanDroneFootageFolders();
      setMatchedFolders(foundFolders);
      setFolderVideos(videos);
      setIsLoadingFiles(false);

      if (videos.length > 0) {
        await runArgonEvaluation(videos);
      }
    } catch (err: any) {
      setIsLoadingFiles(false);
      if (err.message === 'AUTH_REQUIRED') {
        setNeedsAuth(true);
      } else {
        setErrorMsg(err.message || 'Could not scan the "drone footage" folder in Google Drive.');
      }
    }
  };

  const fetchAllDriveVideos = async (query = '') => {
    setErrorMsg(null);
    setIsLoadingFiles(true);
    try {
      const list = await listDriveVideoFiles(query);
      setAllFiles(list);
    } catch (err: any) {
      if (err.message === 'AUTH_REQUIRED') {
        setNeedsAuth(true);
      } else {
        setErrorMsg(err.message || 'Could not load video files from Google Drive.');
      }
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleLogin = async () => {
    setErrorMsg(null);
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setNeedsAuth(false);
        setViewTab('droneFolder');
        await scanAndEvaluateDroneFolder();
      }
    } catch (err: any) {
      setErrorMsg(
        'Sign-in blocked on this lab account. Use the "Paste Shared Drive Folder / File Link" box below (no sign-in required) or upload the video file from your computer.'
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setUser(null);
    setFolderVideos([]);
    setAllFiles([]);
    setNeedsAuth(true);
    setViewTab('sharedLink');
  };

  const handleSelectOAuthVideo = async (file: DriveVideoFile) => {
    setErrorMsg(null);
    setDownloadingFileId(file.id);
    try {
      const blob = await downloadDriveVideoBlob(file.id, file.mimeType || 'video/mp4');
      await onVideoLoaded(blob, file.name);
      onClose();
    } catch (err: any) {
      if (err.message === 'AUTH_REQUIRED') {
        setNeedsAuth(true);
      } else {
        setErrorMsg(err.message || 'Failed to download drone video from Google Drive.');
      }
    } finally {
      setDownloadingFileId(null);
    }
  };

  if (!isOpen) return null;

  const sortBySuitability = (list: DriveVideoFile[]) =>
    [...list].sort((a, b) => {
      const scoreA = evaluations[a.id]?.suitabilityScore ?? -1;
      const scoreB = evaluations[b.id]?.suitabilityScore ?? -1;
      return scoreB - scoreA;
    });

  const displayedList =
    viewTab === 'sharedLink'
      ? sortBySuitability(sharedLinkFiles)
      : viewTab === 'droneFolder'
      ? sortBySuitability(folderVideos)
      : allFiles;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-6 pointer-events-auto">
      <div className="bg-[#0d121a] border border-white/20 rounded-xl max-w-3xl w-full max-h-[86vh] flex flex-col shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/12">
          <div className="flex items-center gap-2.5">
            <HardDrive className="w-4 h-4 text-amber-400 shrink-0" />
            <h2 className="text-base font-display font-semibold text-white">
              Load Drone Footage (Shared Drive Link, Local Upload, or Drive Account)
            </h2>
          </div>

          <div className="flex items-center gap-3">
            {!needsAuth && user && (
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-400 hover:text-white bg-slate-800/80 rounded-md transition-colors cursor-pointer"
                title={`Signed in as ${user.email || user.displayName || 'User'}`}
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 flex-1 overflow-y-auto">
          {/* Top Mode Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-white/10">
            <div className="flex items-center gap-1 p-1 bg-[#070a0f] rounded-lg border border-white/10">
              <button
                type="button"
                onClick={() => setViewTab('sharedLink')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  viewTab === 'sharedLink'
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Link2 className="w-3.5 h-3.5" />
                Paste Shared Drive Link (No Login)
              </button>
              <button
                type="button"
                onClick={() => setViewTab('droneFolder')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  viewTab === 'droneFolder'
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <FolderSearch className="w-3.5 h-3.5" />
                OAuth Drive Folder
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenLocalFilePicker();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-white/10 transition-colors cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-amber-400" />
              Upload Local File (.mp4 / .mov)
            </button>
          </div>

          {errorMsg && (
            <div className="mb-4 px-3.5 py-2.5 rounded-lg bg-red-950/90 border border-red-500/40 text-xs text-red-200">
              {errorMsg}
            </div>
          )}

          {/* TAB 1: Paste Shared Google Drive Folder or Video Link (Works across any Google account without login!) */}
          {viewTab === 'sharedLink' && (
            <div>
              <div className="mb-4 p-4 rounded-xl bg-[#111722] border border-white/12">
                <h3 className="text-xs font-display font-semibold text-white mb-1">
                  Paste your "drone footage" Google Drive Folder Link or Video Link
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-3">
                  Since you are on a lab account (`@gcplab.me`), you can right-click your{' '}
                  <span className="text-slate-200 font-medium">drone footage</span> folder (or any
                  video file) in your personal Google Drive, set sharing to{' '}
                  <span className="text-amber-300">"Anyone with the link"</span>, and paste the link
                  here. The server will list all videos in the folder and rank them with{' '}
                  <span className="font-mono text-sky-400">gemini-4-argon</span>—no login needed.
                </p>

                <form onSubmit={handleInspectSharedLink} className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Link2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={sharedLinkInput}
                      onChange={(e) => setSharedLinkInput(e.target.value)}
                      placeholder="https://drive.google.com/file/d/... or https://drive.google.com/drive/folders/..."
                      className="w-full pl-9 pr-3 py-2.5 text-xs bg-[#070a0f] border border-white/15 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isInspectingLink || !sharedLinkInput.trim()}
                    className="px-4 py-2.5 text-xs font-semibold bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5"
                  >
                    {isInspectingLink ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Scanning Link...
                      </>
                    ) : (
                      'Scan Folder / Video Link'
                    )}
                  </button>
                </form>
              </div>

              {folderSummary && (
                <div className="mb-4 p-3.5 rounded-lg bg-[#111722] border border-sky-500/30 text-xs text-slate-200 leading-relaxed">
                  <span className="font-mono text-sky-400 font-semibold mr-1.5">
                    Argon Folder Recommendation:
                  </span>
                  {folderSummary}
                </div>
              )}

              {displayedList.length > 0 && (
                <div className="space-y-2.5">
                  {displayedList.map((file) => {
                    const isDownloading = downloadingFileId === file.id;
                    const evalInfo = evaluations[file.id];
                    return (
                      <div
                        key={file.id}
                        className={`p-3 rounded-lg border transition-colors ${
                          evalInfo?.isTopPick
                            ? 'bg-[#151e2e] border-amber-400/50'
                            : 'bg-[#111722] border-white/10 hover:border-white/25'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-12 h-10 rounded border border-white/10 bg-[#070a0f] flex items-center justify-center shrink-0">
                              <Film className="w-4 h-4 text-amber-400" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-white truncate">
                                  {file.name}
                                </span>
                                {evalInfo?.isTopPick && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 shrink-0">
                                    <CheckCircle2 className="w-3 h-3 text-amber-400" />
                                    Recommended Candidate
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-400 font-mono">
                                ID: {file.id}
                                {evalInfo && (
                                  <span className="ml-2 text-sky-400 font-semibold">
                                    · Suitability: {evalInfo.suitabilityScore}%
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleDownloadFromSharedLink(file)}
                            disabled={Boolean(downloadingFileId)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-950 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            {isDownloading ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                Importing...
                              </>
                            ) : (
                              <>
                                <Download className="w-3.5 h-3.5" />
                                Use This Video
                              </>
                            )}
                          </button>
                        </div>

                        {evalInfo?.reason && (
                          <p className="mt-2 pt-2 border-t border-white/10 text-xs text-slate-300 leading-snug">
                            <span className="font-mono text-sky-400 mr-1.5">Argon Assessment:</span>
                            {evalInfo.reason}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2 & 3: OAuth Google Drive Folder */}
          {viewTab !== 'sharedLink' &&
            (needsAuth ? (
              <div className="py-8 flex flex-col items-center text-center max-w-md mx-auto">
                <p className="text-sm text-slate-200 font-medium mb-2">
                  Sign in with a Google Account
                </p>
                <p className="text-xs text-slate-400 leading-relaxed mb-5">
                  If this lab account cannot sign in to your Drive, switch to the{' '}
                  <button
                    type="button"
                    onClick={() => setViewTab('sharedLink')}
                    className="text-amber-400 underline cursor-pointer"
                  >
                    Paste Shared Drive Link
                  </button>{' '}
                  tab above.
                </p>

                <button
                  type="button"
                  onClick={handleLogin}
                  disabled={isLoggingIn}
                  className="gsi-material-button inline-flex items-center justify-center gap-3 px-5 py-2.5 bg-white hover:bg-slate-100 text-slate-900 font-medium text-sm rounded-full shadow transition-colors cursor-pointer disabled:opacity-60"
                >
                  <div className="w-5 h-5 shrink-0">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 48 48"
                      style={{ display: 'block', width: '100%', height: '100%' }}
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      ></path>
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      ></path>
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      ></path>
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      ></path>
                      <path fill="none" d="M0 0h48v48H0z"></path>
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents">
                    {isLoggingIn ? 'Connecting to Google Drive...' : 'Sign in with Google'}
                  </span>
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {displayedList.map((file) => {
                  const isDownloading = downloadingFileId === file.id;
                  const evalInfo = evaluations[file.id];
                  const durationLabel = formatDurationMillis(file.durationMillis);
                  return (
                    <div
                      key={file.id}
                      className="p-3 rounded-lg border bg-[#111722] border-white/10 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white truncate">{file.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {durationLabel ? `${durationLabel} · ` : ''}
                          {formatFileSize(file.size)}
                          {evalInfo ? ` · Suitability: ${evalInfo.suitabilityScore}%` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSelectOAuthVideo(file)}
                        disabled={Boolean(downloadingFileId)}
                        className="px-3.5 py-2 text-xs font-medium text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg cursor-pointer"
                      >
                        {isDownloading ? 'Loading...' : 'Use This Video'}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};
