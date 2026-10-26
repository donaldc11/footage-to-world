import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Compass,
  Eye,
  EyeOff,
  Film,
  HardDrive,
  Loader2,
  MousePointer,
  Navigation,
  Sun,
  Upload,
  Video,
} from 'lucide-react';
import { ComparisonDrawer } from './components/ComparisonDrawer';
import { GoogleDriveModal } from './components/GoogleDriveModal';
import { WorldViewport, WorldViewportHandle } from './components/WorldViewport';
import {
  ExtractedFrame,
  RoundArtifact,
  SavedClipInfo,
  SceneBlueprint,
} from './types/world';
import { DEFAULT_INITIAL_BLUEPRINT } from './utils/threeBuilder';
import { extractFramesFromVideoSource, fileToDataUrl } from './utils/videoExtractor';

export default function App() {
  const viewportRef = useRef<WorldViewportHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [savedClips, setSavedClips] = useState<SavedClipInfo[]>([]);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [extractedFrames, setExtractedFrames] = useState<ExtractedFrame[]>([]);
  const [referenceFrameIndex, setReferenceFrameIndex] = useState<number>(0);

  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [isReconstructing, setIsReconstructing] = useState<boolean>(false);
  const [currentStepLabel, setCurrentStepLabel] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [rounds, setRounds] = useState<RoundArtifact[]>([]);
  const [activeRoundNumber, setActiveRoundNumber] = useState<1 | 2 | 3>(1);

  const [navigationMode, setNavigationMode] = useState<'orbit' | 'flight'>('orbit');
  const [activeVantageId, setActiveVantageId] = useState<
    'droneMatch' | 'poolAngle' | 'backLot' | 'roadView'
  >('droneMatch');
  const [wireframe, setWireframe] = useState<boolean>(false);
  const [zenMode, setZenMode] = useState<boolean>(false);
  const [isDriveModalOpen, setIsDriveModalOpen] = useState<boolean>(false);
  const [quickDriveLink, setQuickDriveLink] = useState<string>('');
  const [isLoadingQuickLink, setIsLoadingQuickLink] = useState<boolean>(false);
  const [sunlightAngleDeg, setSunlightAngleDeg] = useState<number>(
    DEFAULT_INITIAL_BLUEPRINT.sunAzimuthDeg ?? 135
  );

  // Determine the currently active 3D scene blueprint & code
  const activeRoundArtifact =
    rounds.find((r) => r.round === activeRoundNumber) || rounds[rounds.length - 1] || null;

  const activeBlueprint: SceneBlueprint =
    activeRoundArtifact?.blueprint || DEFAULT_INITIAL_BLUEPRINT;
  const activeSceneCode: string = activeRoundArtifact?.sceneCode || '';

  // Sync Sunlight Angle slider when the active round blueprint updates
  useEffect(() => {
    if (typeof activeBlueprint?.sunAzimuthDeg === 'number') {
      setSunlightAngleDeg(Math.round(activeBlueprint.sunAzimuthDeg));
    }
  }, [activeBlueprint?.sunAzimuthDeg, activeRoundNumber]);

  // Check if user has already placed or uploaded a real drone clip or saved session
  useEffect(() => {
    let cancelled = false;
    async function restoreExistingClipsAndSession() {
      try {
        const [clipsRes, sessionRes] = await Promise.all([
          fetch('/api/clips').catch(() => null),
          fetch('/api/session').catch(() => null),
        ]);

        if (clipsRes && clipsRes.ok) {
          const data = await clipsRes.json();
          if (!cancelled && Array.isArray(data.clips) && data.clips.length > 0) {
            setSavedClips(data.clips);
          }
        }

        if (sessionRes && sessionRes.ok) {
          const sData = await sessionRes.json();
          const s = sData?.session;
          if (!cancelled && s && Array.isArray(s.extractedFrames) && s.extractedFrames.length > 0) {
            setVideoFileName(s.videoFileName || 'Uploaded Drone Clip');
            setVideoDuration(typeof s.videoDuration === 'number' ? s.videoDuration : null);
            setExtractedFrames(s.extractedFrames);
            setReferenceFrameIndex(
              typeof s.referenceFrameIndex === 'number' ? s.referenceFrameIndex : 0
            );
            if (Array.isArray(s.rounds) && s.rounds.length > 0) {
              setRounds(s.rounds);
            }
            if (s.activeRoundNumber === 1 || s.activeRoundNumber === 2 || s.activeRoundNumber === 3) {
              setActiveRoundNumber(s.activeRoundNumber);
            }
          }
        }
      } catch {
        // Ignore if no clips directory yet
      }
    }
    restoreExistingClipsAndSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistSessionToServer = async (payload: {
    videoFileName: string | null;
    videoDuration: number | null;
    extractedFrames: ExtractedFrame[];
    referenceFrameIndex: number;
    rounds: RoundArtifact[];
    activeRoundNumber: 1 | 2 | 3;
  }) => {
    try {
      await fetch('/api/session/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          updatedAt: new Date().toISOString(),
        }),
      });
    } catch {
      // Non-fatal
    }
  };

  const handleClearAll = async () => {
    setIsExtracting(false);
    setIsReconstructing(false);
    setCurrentStepLabel('');
    setErrorMessage(null);
    setVideoFileName(null);
    setVideoDuration(null);
    setExtractedFrames([]);
    setReferenceFrameIndex(0);
    setRounds([]);
    setActiveRoundNumber(1);
    setSavedClips([]);
    setQuickDriveLink('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    try {
      await fetch('/api/clips/clear', { method: 'POST' });
    } catch {
      // Ignore clear error
    }
  };

  const loadVideoAndExtract = async (
    videoUrl: string,
    fileName: string,
    autoStartBuild = true,
    driveFileId?: string
  ) => {
    setErrorMessage(null);
    setVideoFileName(fileName);
    setIsExtracting(true);
    setCurrentStepLabel(`Loading ${fileName} and extracting keyframes...`);
    try {
      let frames: ExtractedFrame[] = [];
      let duration = 10;

      // If loading from a Google Drive link, pre-fetch the high-res Drive frame in parallel
      // so large 2-10 minute videos or HEVC .MOV files never stall
      const fallbackPromise = driveFileId
        ? fetch('/api/drive-link/fallback-frames', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: driveFileId }),
          })
            .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
            .catch(() => ({ ok: false, data: {} as any }))
        : null;

      try {
        const result = await extractFramesFromVideoSource(
          videoUrl,
          5,
          960,
          (framesSoFar, currentIdx, total, dur) => {
            setVideoDuration(dur);
            setExtractedFrames(framesSoFar);
            setCurrentStepLabel(
              `Extracted frame ${currentIdx}/${total} from ${fileName} (${dur.toFixed(1)}s clip)...`
            );
          },
          driveFileId ? 8000 : 30000
        );
        frames = result.frames;
        duration = result.duration;
      } catch (decodeErr: any) {
        if (fallbackPromise) {
          setCurrentStepLabel(`Using high-resolution frame extracted from Google Drive...`);
          const fb = await fallbackPromise;
          if (fb.ok && Array.isArray(fb.data.frames) && fb.data.frames.length > 0) {
            frames = fb.data.frames;
            duration = fb.data.duration || 120;
          } else {
            throw new Error(fb.data.error || decodeErr.message);
          }
        } else {
          throw decodeErr;
        }
      }

      setVideoFileName(fileName);
      setVideoDuration(duration);
      setExtractedFrames(frames);
      const midIdx = Math.min(1, frames.length - 1);
      setReferenceFrameIndex(midIdx);
      setRounds([]);
      setIsExtracting(false);
      setCurrentStepLabel('');

      await persistSessionToServer({
        videoFileName: fileName,
        videoDuration: duration,
        extractedFrames: frames,
        referenceFrameIndex: midIdx,
        rounds: [],
        activeRoundNumber: 1,
      });

      if (autoStartBuild && frames.length > 0) {
        await runThreeRoundArgonPipeline(frames, midIdx);
      }
    } catch (err: any) {
      setIsExtracting(false);
      setCurrentStepLabel('');
      setErrorMessage(err.message || 'Could not extract frames from video.');
    }
  };

  const handleQuickDriveLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = quickDriveLink.trim();
    if (!trimmed) return;
    setErrorMessage(null);
    setIsLoadingQuickLink(true);
    try {
      const res = await fetch('/api/drive-link/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driveUrl: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not access that Google Drive link.');
      }

      const files = Array.isArray(data.files) ? data.files : [];
      if (files.length === 0) {
        throw new Error('No video files found at that Google Drive link.');
      }

      // Load the first/selected video immediately
      const targetFile = files[0];
      const dlRes = await fetch('/api/drive-link/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: targetFile.id, fileName: targetFile.name }),
      });
      const dlData = await dlRes.json();
      setIsLoadingQuickLink(false);

      if (dlRes.ok && dlData.clip?.url) {
        await loadVideoAndExtract(
          dlData.clip.url,
          dlData.clip.fileName,
          true,
          targetFile.id
        );
      } else {
        // Fallback directly to server-side Google Drive frame extraction
        await loadVideoAndExtract(
          `/api/drive-stream/${encodeURIComponent(targetFile.id)}`,
          targetFile.name,
          true,
          targetFile.id
        );
      }
    } catch (err: any) {
      setIsLoadingQuickLink(false);
      setErrorMessage(err.message || 'Failed to load Google Drive link.');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const objectUrl = URL.createObjectURL(file);
    // Persist the uploaded clip to /public/clips in background if <= 35MB so it stays preloaded
    if (file.size <= 35 * 1024 * 1024) {
      fileToDataUrl(file)
        .then((dataUrl) =>
          fetch('/api/clips/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: file.name, dataUrl }),
          })
        )
        .then((r) => r.json())
        .then((saved) => {
          if (saved?.clip) {
            setSavedClips((prev) => {
              const filtered = prev.filter((c) => c.fileName !== saved.clip.fileName);
              return [saved.clip, ...filtered];
            });
          }
        })
        .catch(() => {});
    }

    await loadVideoAndExtract(objectUrl, file.name, true);
  };

  const handleDriveVideoLoaded = async (blob: Blob, fileName: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const file = new File([blob], fileName, { type: blob.type || 'video/mp4' });
    if (file.size <= 35 * 1024 * 1024) {
      fileToDataUrl(file)
        .then((dataUrl) =>
          fetch('/api/clips/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: file.name, dataUrl }),
          })
        )
        .then((r) => r.json())
        .then((saved) => {
          if (saved?.clip) {
            setSavedClips((prev) => {
              const filtered = prev.filter((c) => c.fileName !== saved.clip.fileName);
              return [saved.clip, ...filtered];
            });
          }
        })
        .catch(() => {});
    }

    await loadVideoAndExtract(objectUrl, fileName, true);
  };

  const handleJumpToVantage = (vantageKey: 'droneMatch' | 'poolAngle' | 'backLot' | 'roadView') => {
    setActiveVantageId(vantageKey);
    const v = activeBlueprint.vantages?.[vantageKey] || DEFAULT_INITIAL_BLUEPRINT.vantages[vantageKey];
    if (v && viewportRef.current) {
      viewportRef.current.flyToVantage(v.position, v.target);
    }
  };

  const handleRecaptureSnapshot = async (roundNum: 1 | 2 | 3) => {
    if (!viewportRef.current) return;
    const targetRound = rounds.find((r) => r.round === roundNum);
    if (!targetRound) return;

    setActiveRoundNumber(roundNum);
    await new Promise((r) => setTimeout(r, 120));
    const snapshot = await viewportRef.current.captureRenderFromVantage(
      targetRound.blueprint.vantages?.droneMatch
    );
    setRounds((prev) =>
      prev.map((item) => (item.round === roundNum ? { ...item, renderSnapshotUrl: snapshot } : item))
    );
  };

  const runThreeRoundArgonPipeline = async (
    framesToUse = extractedFrames,
    refIdx = referenceFrameIndex
  ) => {
    if (!framesToUse || framesToUse.length === 0) {
      setErrorMessage('Please upload a drone video clip first.');
      return;
    }

    const referenceFrame = framesToUse[refIdx] || framesToUse[0];
    setErrorMessage(null);
    setIsReconstructing(true);
    setRounds([]);

    try {
      // =========================================================================
      // ROUND 1: Initial 3D Scene Synthesis from Extracted Video Frames
      // =========================================================================
      setCurrentStepLabel('Round 1/3: Gemini 4 Argon synthesizing 3D scene from video frames...');
      const r1Res = await fetch('/api/argon/round-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames: framesToUse.map((f) => ({
            timestamp: f.timestamp,
            formattedTime: f.formattedTime,
            dataUrl: f.dataUrl,
          })),
          referenceFrameIndex: refIdx,
        }),
      });

      if (!r1Res.ok) {
        const errData = await r1Res.json().catch(() => ({}));
        throw new Error(errData.error || 'Round 1 synthesis failed.');
      }

      const r1Data = await r1Res.json();
      const r1Blueprint: SceneBlueprint = r1Data.blueprint;
      const r1Code: string = r1Data.sceneCode || '';

      const round1Initial: RoundArtifact = {
        round: 1,
        status: 'rendering',
        originalFrameUrl: referenceFrame.dataUrl,
        originalFrameTimestamp: referenceFrame.formattedTime,
        renderSnapshotUrl: null,
        similarityScore: null,
        critique: r1Data.initialObservation || 'Initial 3D world synthesized from drone frames.',
        fixesApplied: ['Initial multi-frame spatial extraction & base 3D geometry generation'],
        sceneCode: r1Code,
        blueprint: r1Blueprint,
        modelUsed: 'gemini-4-argon',
        isSimulatedGeometry: true,
      };

      setRounds([round1Initial]);
      setActiveRoundNumber(1);

      // Allow React + Three.js a moment to mount Round 1 geometry, then capture WebGL snapshot
      await new Promise((r) => setTimeout(r, 250));
      setCurrentStepLabel('Round 1/3: Capturing live Three.js render & running Argon visual critique...');
      const r1RenderUrl = await viewportRef.current!.captureRenderFromVantage(
        r1Blueprint.vantages?.droneMatch
      );

      setRounds((prev) =>
        prev.map((item) =>
          item.round === 1
            ? { ...item, status: 'critiquing', renderSnapshotUrl: r1RenderUrl }
            : item
        )
      );

      // =========================================================================
      // CRITIQUE ROUND 1 & SYNTHESIZE ROUND 2
      // =========================================================================
      const c1Res = await fetch('/api/argon/critique-and-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roundToCritique: 1,
          nextRound: 2,
          originalFrameDataUrl: referenceFrame.dataUrl,
          renderedFrameDataUrl: r1RenderUrl,
          currentCode: r1Code,
          currentBlueprint: r1Blueprint,
        }),
      });

      if (!c1Res.ok) {
        const errData = await c1Res.json().catch(() => ({}));
        throw new Error(errData.error || 'Round 1 critique failed.');
      }

      const c1Data = await c1Res.json();
      const r1Score: number = c1Data.similarityScore;
      const r2Blueprint: SceneBlueprint = c1Data.nextBlueprint;
      const r2Code: string = c1Data.nextSceneCode;

      // Mark Round 1 complete with its audited similarity score and critique, and add Round 2
      const round2Initial: RoundArtifact = {
        round: 2,
        status: 'rendering',
        originalFrameUrl: referenceFrame.dataUrl,
        originalFrameTimestamp: referenceFrame.formattedTime,
        renderSnapshotUrl: null,
        similarityScore: null,
        critique: 'Applying Round 1 critique fixes and rendering Round 2 scene...',
        fixesApplied: Array.isArray(c1Data.fixesApplied) ? c1Data.fixesApplied : [],
        sceneCode: r2Code,
        blueprint: r2Blueprint,
        modelUsed: 'gemini-4-argon',
        isSimulatedGeometry: true,
      };

      setRounds((prev) => [
        ...prev.map((item) =>
          item.round === 1
            ? {
                ...item,
                status: 'complete' as const,
                similarityScore: r1Score,
                critique: c1Data.critique,
              }
            : item
        ),
        round2Initial,
      ]);
      setActiveRoundNumber(2);

      // Wait for Round 2 Three.js scene to render, then capture Round 2 WebGL snapshot
      await new Promise((r) => setTimeout(r, 250));
      setCurrentStepLabel('Round 2/3: Capturing Round 2 render & running Argon critique for Round 3...');
      const r2RenderUrl = await viewportRef.current!.captureRenderFromVantage(
        r2Blueprint.vantages?.droneMatch
      );

      setRounds((prev) =>
        prev.map((item) =>
          item.round === 2
            ? { ...item, status: 'critiquing', renderSnapshotUrl: r2RenderUrl }
            : item
        )
      );

      // =========================================================================
      // CRITIQUE ROUND 2 & SYNTHESIZE ROUND 3
      // =========================================================================
      const c2Res = await fetch('/api/argon/critique-and-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roundToCritique: 2,
          nextRound: 3,
          originalFrameDataUrl: referenceFrame.dataUrl,
          renderedFrameDataUrl: r2RenderUrl,
          previousScore: r1Score,
          currentCode: r2Code,
          currentBlueprint: r2Blueprint,
        }),
      });

      if (!c2Res.ok) {
        const errData = await c2Res.json().catch(() => ({}));
        throw new Error(errData.error || 'Round 2 critique failed.');
      }

      const c2Data = await c2Res.json();
      const r2Score: number = c2Data.similarityScore;
      const r3Blueprint: SceneBlueprint = c2Data.nextBlueprint;
      const r3Code: string = c2Data.nextSceneCode;

      const round3Initial: RoundArtifact = {
        round: 3,
        status: 'rendering',
        originalFrameUrl: referenceFrame.dataUrl,
        originalFrameTimestamp: referenceFrame.formattedTime,
        renderSnapshotUrl: null,
        similarityScore: null,
        critique: 'Rendering final Round 3 scene and verifying against original drone frame...',
        fixesApplied: Array.isArray(c2Data.fixesApplied) ? c2Data.fixesApplied : [],
        sceneCode: r3Code,
        blueprint: r3Blueprint,
        modelUsed: 'gemini-4-argon',
        isSimulatedGeometry: true,
      };

      setRounds((prev) => [
        ...prev.map((item) =>
          item.round === 2
            ? {
                ...item,
                status: 'complete' as const,
                similarityScore: r2Score,
                critique: c2Data.critique,
              }
            : item
        ),
        round3Initial,
      ]);
      setActiveRoundNumber(3);

      // Render Round 3 and capture snapshot
      await new Promise((r) => setTimeout(r, 250));
      setCurrentStepLabel('Round 3/3: Auditing final Round 3 render against original drone frame...');
      const r3RenderUrl = await viewportRef.current!.captureRenderFromVantage(
        r3Blueprint.vantages?.droneMatch
      );

      setRounds((prev) =>
        prev.map((item) =>
          item.round === 3
            ? { ...item, status: 'critiquing', renderSnapshotUrl: r3RenderUrl }
            : item
        )
      );

      // =========================================================================
      // SCORE & VERIFY FINAL ROUND 3 RENDER
      // =========================================================================
      const finalRes = await fetch('/api/argon/score-final', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalFrameDataUrl: referenceFrame.dataUrl,
          renderedFrameDataUrl: r3RenderUrl,
          round2Score: r2Score,
          currentCode: r3Code,
        }),
      });

      if (!finalRes.ok) {
        const errData = await finalRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Round 3 final scoring failed.');
      }

      const finalData = await finalRes.json();

      setRounds((prev) =>
        prev.map((item) =>
          item.round === 3
            ? {
                ...item,
                status: 'complete' as const,
                similarityScore: finalData.similarityScore,
                critique: finalData.critique,
                fixesApplied:
                  Array.isArray(item.fixesApplied) && item.fixesApplied.length > 0
                    ? item.fixesApplied
                    : finalData.fixesVerified || [],
              }
            : item
        )
      );

      setCurrentStepLabel('');
      setIsReconstructing(false);
    } catch (err: any) {
      console.error('Reconstruction pipeline error:', err);
      setErrorMessage(err.message || 'An error occurred during the 3-round reconstruction.');
      setIsReconstructing(false);
      setCurrentStepLabel('');
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0a0d12] select-none">
      {/* Hidden Video File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* 100% Full-Viewport 3D World (The Main Screen — Not a Dashboard) */}
      <WorldViewport
        ref={viewportRef}
        blueprint={activeBlueprint}
        sceneCode={activeSceneCode}
        navigationMode={navigationMode}
        wireframe={wireframe}
        sunlightAngleDeg={sunlightAngleDeg}
      />

      {/* Top Navigation Bar — Strict 3-Zone Contract */}
      <header className="fixed top-0 inset-x-0 z-30 flex items-center justify-between gap-8 px-6 py-3.5 bg-[#0a0d12]/90 border-b border-white/12 pointer-events-auto">
        {/* Zone 1: Single-line Brand Wordmark */}
        <a
          href="#world"
          onClick={(e) => {
            e.preventDefault();
            handleJumpToVantage('droneMatch');
          }}
          className="text-lg font-display font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          Footage-to-World
        </a>

        {/* Zone 2: 4 Concise Buyer Sightline Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
          <a
            href="#drone-angle"
            onClick={(e) => {
              e.preventDefault();
              handleJumpToVantage('droneMatch');
            }}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeVantageId === 'droneMatch' ? 'text-amber-400 underline underline-offset-4' : ''
            }`}
          >
            Drone Angle
          </a>
          <a
            href="#pool-angle"
            onClick={(e) => {
              e.preventDefault();
              handleJumpToVantage('poolAngle');
            }}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeVantageId === 'poolAngle' ? 'text-amber-400 underline underline-offset-4' : ''
            }`}
          >
            Angle from Pool
          </a>
          <a
            href="#back-lot"
            onClick={(e) => {
              e.preventDefault();
              handleJumpToVantage('backLot');
            }}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeVantageId === 'backLot' ? 'text-amber-400 underline underline-offset-4' : ''
            }`}
          >
            The Back Lot
          </a>
          <a
            href="#road-view"
            onClick={(e) => {
              e.preventDefault();
              handleJumpToVantage('roadView');
            }}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeVantageId === 'roadView' ? 'text-amber-400 underline underline-offset-4' : ''
            }`}
          >
            View from Road
          </a>
          <a
            href="#google-drive"
            onClick={(e) => {
              e.preventDefault();
              setIsDriveModalOpen(true);
            }}
            className="hover:text-amber-300 text-sky-300 transition-colors whitespace-nowrap shrink-0"
          >
            Google Drive
          </a>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 text-xs font-medium text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Upload Drone Video
          </button>
        </div>
      </header>

      {/* Subtle Top-Left Provenance & Listing Agent Context Strip */}
      <div className="fixed top-16 left-6 z-20 pointer-events-auto max-w-xl">
        <div className="px-3.5 py-2 rounded-lg bg-[#0d121a]/90 border border-white/12 text-xs text-slate-300 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-white">Listing Agent Spatial Walkthrough</span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span>
            {videoFileName
              ? `Source: Real Video (${videoFileName}${
                  videoDuration ? `, ${videoDuration.toFixed(1)}s` : ''
                })`
              : 'Source: Ready for Drone Video Upload'}
          </span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span className="text-amber-300">3D World: Simulated Three.js scene</span>
          {(videoFileName || extractedFrames.length > 0 || isExtracting || isReconstructing || errorMessage) && (
            <>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <button
                type="button"
                onClick={handleClearAll}
                className="text-rose-400 hover:text-rose-300 underline underline-offset-2 font-medium cursor-pointer"
              >
                Clear / Reset
              </button>
            </>
          )}
        </div>

        {/* If user has saved real clips in /public/clips, allow switching between them */}
        {savedClips.length > 0 && (
          <div className="mt-2 px-3 py-1.5 rounded-lg bg-[#0d121a]/90 border border-white/12 flex items-center gap-2 text-xs">
            <Film className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-slate-400 shrink-0">Saved Clips:</span>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {savedClips.map((clip) => (
                <button
                  key={clip.fileName}
                  type="button"
                  onClick={() => loadVideoAndExtract(clip.url, clip.fileName, true)}
                  className={`px-2 py-0.5 rounded text-xs font-mono transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    videoFileName === clip.fileName
                      ? 'bg-amber-400 text-slate-950 font-semibold'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  {clip.fileName}
                </button>
              ))}
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="mt-2 px-3.5 py-2.5 rounded-lg bg-red-950/95 border border-red-500/40 text-xs text-red-200 flex items-center justify-between gap-4">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-red-300 hover:text-white font-medium shrink-0 cursor-pointer"
            >
              Reset & Try Again
            </button>
          </div>
        )}
      </div>

      {/* Zero-State Prompt when no real drone video has been uploaded yet */}
      {extractedFrames.length === 0 && !isExtracting && !zenMode && (
        <div className="fixed top-32 left-6 z-20 w-[min(450px,90vw)] bg-[#0d121a]/95 border border-white/15 rounded-xl p-5 shadow-2xl pointer-events-auto">
          <div className="flex items-center gap-2.5 mb-2">
            <Video className="w-5 h-5 text-amber-400 shrink-0" />
            <h2 className="text-base font-display font-semibold text-white">
              Upload Your Drone Video
            </h2>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed mb-4">
            Upload a property or venue drone clip (`.mp4`, `.mov`, or `.webm`) from your computer or
            paste a Google Drive link (set to <span className="text-amber-300">"Anyone with the link"</span>).
            The app extracts frames, sends them to{' '}
            <span className="font-mono text-sky-400">gemini-4-argon</span> to build a navigable 3D
            world, and self-corrects across 3 auditable rounds.
          </p>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2.5 px-4 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-display font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              Upload Drone Video File (.mp4 / .mov / .webm)
            </button>

            <form onSubmit={handleQuickDriveLinkSubmit} className="pt-2 border-t border-white/10">
              <label className="block text-[11px] font-medium text-slate-300 mb-1.5">
                Or Paste Google Drive Video / Folder Link Directly:
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={quickDriveLink}
                  onChange={(e) => setQuickDriveLink(e.target.value)}
                  placeholder="https://drive.google.com/file/d/... or /folders/..."
                  className="flex-1 px-3 py-2 text-xs bg-[#070a0f] border border-white/15 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  disabled={isLoadingQuickLink || !quickDriveLink.trim()}
                  className="px-3.5 py-2 rounded-lg bg-sky-400 hover:bg-sky-300 disabled:opacity-50 text-slate-950 font-display font-semibold text-xs whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5"
                >
                  {isLoadingQuickLink ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    'Load Link'
                  )}
                </button>
              </div>
            </form>

            <button
              type="button"
              onClick={() => setIsDriveModalOpen(true)}
              className="w-full py-2 px-4 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 font-display font-medium text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer border border-white/10"
            >
              <HardDrive className="w-3.5 h-3.5 text-sky-400" />
              Browse / Rank Folder Candidates in Google Drive
            </button>
          </div>
        </div>
      )}

      {/* Google Drive Video Picker Modal */}
      <GoogleDriveModal
        isOpen={isDriveModalOpen}
        onClose={() => setIsDriveModalOpen(false)}
        onVideoLoaded={handleDriveVideoLoaded}
        onDirectServerClipLoaded={async (clipUrl, fileName, fileId) => {
          setSavedClips((prev) => {
            const filtered = prev.filter((c) => c.fileName !== fileName);
            return [
              { fileName, url: clipUrl, sizeBytes: 0, uploadedAt: new Date().toISOString() },
              ...filtered,
            ];
          });
          await loadVideoAndExtract(clipUrl, fileName, true, fileId);
        }}
        onOpenLocalFilePicker={() => fileInputRef.current?.click()}
      />

      {/* Extracting Frames Overlay Indicator */}
      {isExtracting && (
        <div className="fixed top-32 left-6 z-20 px-4 py-3 rounded-xl bg-[#0d121a]/95 border border-sky-500/40 text-xs text-sky-200 flex items-center gap-2.5 pointer-events-auto">
          <Loader2 className="w-4 h-4 animate-spin text-sky-400 shrink-0" />
          <span>{currentStepLabel || 'Decoding video and extracting keyframes...'}</span>
        </div>
      )}

      {/* Auditable 3-Round Frame vs. Render Comparison Drawer */}
      {!zenMode && (
        <ComparisonDrawer
          rounds={rounds}
          activeRoundNumber={activeRoundNumber}
          onSelectRound={(r) => setActiveRoundNumber(r)}
          extractedFrames={extractedFrames}
          referenceFrameIndex={referenceFrameIndex}
          onSelectReferenceFrame={(idx) => setReferenceFrameIndex(idx)}
          isReconstructing={isReconstructing}
          currentStepLabel={currentStepLabel}
          onRunReconstruction={() =>
            runThreeRoundArgonPipeline(extractedFrames, referenceFrameIndex)
          }
          onRecaptureSnapshot={handleRecaptureSnapshot}
          videoFileName={videoFileName}
        />
      )}

      {/* Unified Collapsible Bottom Flight & World Controls Dock */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[min(1140px,95vw)] pointer-events-auto">
        <div className="bg-[#0d121a]/95 border border-white/15 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-2xl">
          {/* Navigation Mode Switcher */}
          <div className="flex items-center gap-1 p-1 bg-[#070a0f] rounded-lg border border-white/10">
            <button
              type="button"
              onClick={() => setNavigationMode('orbit')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                navigationMode === 'orbit'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <MousePointer className="w-3.5 h-3.5" />
              Orbit Mouse
            </button>
            <button
              type="button"
              onClick={() => setNavigationMode('flight')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                navigationMode === 'flight'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Navigation className="w-3.5 h-3.5" />
              Flight Mode (WASD)
            </button>
          </div>

          {/* Round World Selector */}
          <div className="flex items-center gap-1 p-1 bg-[#070a0f] rounded-lg border border-white/10">
            {([1, 2, 3] as const).map((rNum) => {
              const rObj = rounds.find((item) => item.round === rNum);
              const isSelected = activeRoundNumber === rNum;
              return (
                <button
                  key={rNum}
                  type="button"
                  disabled={!rObj}
                  onClick={() => setActiveRoundNumber(rNum)}
                  className={`px-3 py-1 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-35 ${
                    isSelected
                      ? 'bg-sky-400 text-slate-950 font-semibold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Round {rNum}
                  {rObj?.similarityScore !== null && rObj?.similarityScore !== undefined
                    ? ` (${rObj.similarityScore}%)`
                    : ''}
                </button>
              );
            })}
          </div>

          {/* Interactive Sunlight Angle Slider */}
          <div className="flex items-center gap-2.5 px-3 py-1.5 bg-[#070a0f] rounded-lg border border-white/10">
            <label
              htmlFor="sunlight-angle-slider"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 whitespace-nowrap shrink-0"
            >
              <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Sunlight Angle</span>
            </label>
            <input
              id="sunlight-angle-slider"
              type="range"
              min={0}
              max={360}
              step={1}
              value={sunlightAngleDeg}
              onChange={(e) => setSunlightAngleDeg(Number(e.target.value))}
              className="w-24 sm:w-28 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
              aria-label="Sunlight Angle in degrees"
            />
            <span className="text-xs font-mono text-amber-300 w-9 text-right shrink-0">
              {sunlightAngleDeg}°
            </span>
          </div>

          {/* Buyer Camera Sightlines & Geometry Inspection */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleJumpToVantage('droneMatch')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800/90 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Compass className="w-3.5 h-3.5 text-amber-400" />
              Match Frame Angle
            </button>

            <button
              type="button"
              onClick={() => setWireframe((w) => !w)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                wireframe
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40'
                  : 'bg-slate-800/90 text-slate-300 hover:text-white'
              }`}
            >
              <Box className="w-3.5 h-3.5" />
              Wireframe
            </button>

            <button
              type="button"
              onClick={() => setZenMode((z) => !z)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800/90 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {zenMode ? (
                <>
                  <Eye className="w-3.5 h-3.5 text-amber-400" />
                  Show HUD
                </>
              ) : (
                <>
                  <EyeOff className="w-3.5 h-3.5" />
                  Cinema Mode
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
