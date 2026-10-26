import React, { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Eye,
  Layers,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { ExtractedFrame, RoundArtifact } from '../types/world';

interface ComparisonDrawerProps {
  rounds: RoundArtifact[];
  activeRoundNumber: 1 | 2 | 3;
  onSelectRound: (round: 1 | 2 | 3) => void;
  extractedFrames: ExtractedFrame[];
  referenceFrameIndex: number;
  onSelectReferenceFrame: (idx: number) => void;
  isReconstructing: boolean;
  currentStepLabel: string;
  onRunReconstruction: () => void;
  onRecaptureSnapshot: (round: 1 | 2 | 3) => void;
  videoFileName: string | null;
}

export const ComparisonDrawer: React.FC<ComparisonDrawerProps> = ({
  rounds,
  activeRoundNumber,
  onSelectRound,
  extractedFrames,
  referenceFrameIndex,
  onSelectReferenceFrame,
  isReconstructing,
  currentStepLabel,
  onRunReconstruction,
  onRecaptureSnapshot,
  videoFileName,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showCodeModal, setShowCodeModal] = useState(false);

  const activeRound =
    rounds.find((r) => r.round === activeRoundNumber) || rounds[rounds.length - 1] || null;

  return (
    <>
      {/* Auditable 3-Round Comparison & Critique Panel (Collapsible so 3D World stays unobstructed) */}
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-20 w-[min(1180px,95vw)] pointer-events-auto">
        {/* Collapse / Expand Header Tab */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#0d121a] border border-white/15 rounded-t-xl">
          <div className="flex items-center gap-3 text-xs text-slate-300">
            <span className="font-display font-semibold text-white">
              3-Round Render vs. Original Frame Audit
            </span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="font-mono text-sky-400">Model: gemini-4-argon</span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="text-amber-300/90 font-medium">
              Simulated Three.js scene (Procedural 3D Reconstruction from Footage)
            </span>
            {isReconstructing && (
              <>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span className="inline-flex items-center gap-1.5 text-sky-300 font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {currentStepLabel}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {extractedFrames.length > 0 && (
              <button
                type="button"
                onClick={onRunReconstruction}
                disabled={isReconstructing}
                className="px-3 py-1 text-xs font-medium bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {rounds.length > 0 ? 'Re-Run 3-Round Loop' : 'Start 3-Round Argon Build'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white bg-slate-800/90 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isExpanded ? (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  Hide Audit Panel
                </>
              ) : (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  Show Frame vs. Render Audit
                </>
              )}
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="bg-[#0d121a]/95 border-x border-b border-white/15 rounded-b-xl p-4 shadow-2xl">
            {/* Extracted Real Video Keyframes Strip */}
            {extractedFrames.length > 0 && (
              <div className="mb-4 pb-3 border-b border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-slate-400">
                    <span className="text-slate-200 font-medium">
                      Extracted Real Video Frames ({videoFileName || 'Uploaded Clip'})
                    </span>
                    <span className="mx-2 text-slate-600">·</span>
                    <span>
                      Click any frame to set the primary reference angle for camera match and similarity scoring
                    </span>
                  </div>
                  <span className="text-xs font-mono text-slate-400">
                    Reference Frame #{referenceFrameIndex + 1} ({extractedFrames[referenceFrameIndex]?.formattedTime})
                  </span>
                </div>

                <div className="grid grid-cols-5 gap-2.5">
                  {extractedFrames.map((frame, idx) => {
                    const isRef = idx === referenceFrameIndex;
                    return (
                      <button
                        key={frame.index}
                        type="button"
                        onClick={() => onSelectReferenceFrame(idx)}
                        disabled={isReconstructing}
                        className={`group relative rounded-lg overflow-hidden border text-left transition-all cursor-pointer ${
                          isRef
                            ? 'border-amber-400 ring-1 ring-amber-400/50'
                            : 'border-white/10 hover:border-white/30'
                        }`}
                      >
                        <img
                          src={frame.dataUrl}
                          alt={`Extracted drone frame at ${frame.formattedTime}`}
                          className="w-full h-14 object-cover block"
                          referrerPolicy="no-referrer"
                        />
                        <div className="px-2 py-1 bg-[#0a0d12] flex items-center justify-between text-[11px] font-mono">
                          <span className="text-slate-300">Frame {idx + 1}</span>
                          <span className={isRef ? 'text-amber-400 font-semibold' : 'text-slate-500'}>
                            {isRef ? 'Ref Match' : frame.formattedTime}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3-Round Auditable Progression Grid */}
            {rounds.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-400">
                {extractedFrames.length === 0
                  ? 'Upload your real drone video clip to extract frames and begin the 3-round Gemini 4 Argon reconstruction.'
                  : 'Frames extracted from your real drone video. Click "Start 3-Round Argon Build" above to synthesize, render, critique, and refine the 3D scene.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
                {/* Left 7 columns: All 3 Rounds Auditable Frame + Render + Score Cards */}
                <div className="lg:col-span-7 grid grid-cols-3 gap-3">
                  {[1, 2, 3].map((rNum) => {
                    const roundItem = rounds.find((r) => r.round === rNum);
                    const isSelected = activeRoundNumber === rNum;

                    if (!roundItem) {
                      return (
                        <div
                          key={rNum}
                          className="rounded-lg border border-white/10 bg-[#111722] p-3 flex flex-col justify-between min-h-[210px]"
                        >
                          <div className="flex items-center justify-between text-xs font-mono text-slate-500">
                            <span>Round {rNum}</span>
                            <span>Pending</span>
                          </div>
                          <div className="text-xs text-slate-500 text-center my-auto">
                            Waiting for Round {rNum - 1} critique & code fix...
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={rNum}
                        onClick={() => onSelectRound(rNum as 1 | 2 | 3)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') onSelectRound(rNum as 1 | 2 | 3);
                        }}
                        className={`rounded-lg border p-2.5 flex flex-col justify-between transition-all cursor-pointer ${
                          isSelected
                            ? 'border-amber-400 bg-[#151d2b]'
                            : 'border-white/10 bg-[#111722] hover:border-white/25'
                        }`}
                      >
                        {/* Round Header + Similarity Score */}
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-display font-semibold text-white">
                            Round {rNum}
                          </span>
                          {roundItem.similarityScore !== null ? (
                            <span className="text-sm font-mono font-semibold text-sky-400">
                              {roundItem.similarityScore}% Match
                            </span>
                          ) : (
                            <span className="text-xs font-mono text-amber-300 inline-flex items-center gap-1">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              {roundItem.status}
                            </span>
                          )}
                        </div>

                        {/* Side-by-Side Original Frame vs Three.js Render inside each Round card */}
                        <div className="grid grid-cols-2 gap-1.5 mb-2">
                          <div>
                            <div className="text-[10px] font-mono text-slate-400 mb-1 truncate">
                              Original Frame
                            </div>
                            <div className="aspect-video rounded overflow-hidden border border-white/10 bg-black">
                              <img
                                src={roundItem.originalFrameUrl}
                                alt={`Round ${rNum} original drone frame`}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            </div>
                          </div>

                          <div>
                            <div className="text-[10px] font-mono text-slate-400 mb-1 truncate">
                              Simulated Three.js scene
                            </div>
                            <div className="aspect-video rounded overflow-hidden border border-white/10 bg-slate-900 flex items-center justify-center">
                              {roundItem.renderSnapshotUrl ? (
                                <img
                                  src={roundItem.renderSnapshotUrl}
                                  alt={`Round ${rNum} Three.js render snapshot`}
                                  className="w-full h-full object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Brief Critique Snippet & Active World Indicator */}
                        <p className="text-[11px] text-slate-300 line-clamp-2 leading-snug mb-2">
                          {roundItem.critique || 'Synthesizing and rendering 3D world geometry...'}
                        </p>

                        <div className="flex items-center justify-between pt-1.5 border-t border-white/10 text-[11px]">
                          <span className={isSelected ? 'text-amber-400 font-medium' : 'text-slate-400'}>
                            {isSelected ? 'Viewing in 3D Viewport' : 'Click to inspect 3D'}
                          </span>
                          <span className="font-mono text-slate-500">
                            {roundItem.fixesApplied.length} fixes
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Right 5 columns: Detailed Side-by-Side Comparison & Argon Critique for Active Round */}
                {activeRound && (
                  <div className="lg:col-span-5 rounded-lg border border-white/15 bg-[#111722] p-3.5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between gap-2 pb-2 mb-2.5 border-b border-white/10">
                        <div>
                          <h3 className="text-sm font-display font-semibold text-white">
                            Round {activeRound.round} Critique & Applied Scene Fixes
                          </h3>
                          <p className="text-xs text-slate-400">
                            Original Frame ({activeRound.originalFrameTimestamp}) vs. Three.js WebGL Render
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-slate-400">Similarity Score</div>
                          <div className="text-lg font-mono font-bold text-sky-400">
                            {activeRound.similarityScore !== null
                              ? `${activeRound.similarityScore}%`
                              : '...'}
                          </div>
                        </div>
                      </div>

                      <p className="text-xs text-slate-200 leading-relaxed mb-3">
                        {activeRound.critique}
                      </p>

                      {activeRound.fixesApplied.length > 0 && (
                        <div className="space-y-1 mb-3">
                          <div className="text-[11px] font-mono text-slate-400">
                            Scene Code Adjustments Applied:
                          </div>
                          <ul className="space-y-1 max-h-24 overflow-y-auto pr-1">
                            {activeRound.fixesApplied.map((fix, i) => (
                              <li
                                key={i}
                                className="text-xs text-slate-300 flex items-start gap-1.5 leading-snug"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                <span>{fix}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10">
                      <button
                        type="button"
                        onClick={() => onRecaptureSnapshot(activeRound.round)}
                        disabled={isReconstructing}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Update Render Snapshot
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowCodeModal(true)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-sky-300 hover:text-sky-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Code2 className="w-3.5 h-3.5" />
                        Inspect Round {activeRound.round} Three.js Code
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal to inspect the exact Three.js code generated and fixed by Gemini 4 Argon */}
      {showCodeModal && activeRound && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-6 pointer-events-auto">
          <div className="bg-[#0d121a] border border-white/20 rounded-xl max-w-4xl w-full max-h-[82vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
              <div className="flex items-center gap-3">
                <Layers className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-display font-semibold text-white">
                  Round {activeRound.round} Generated Three.js Scene Code & Spatial Blueprint
                </h3>
                <span className="text-xs font-mono text-sky-400">
                  Similarity: {activeRound.similarityScore ?? '—'}%
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowCodeModal(false)}
                className="px-3 py-1 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 rounded-md cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs font-mono">
              <div>
                <div className="text-slate-400 mb-1.5">
                  Executable Three.js Builder Code (`sceneCode`):
                </div>
                <pre className="p-3.5 rounded-lg bg-[#070a0f] border border-white/10 text-emerald-300 overflow-x-auto whitespace-pre-wrap">
                  {activeRound.sceneCode}
                </pre>
              </div>

              <div>
                <div className="text-slate-400 mb-1.5">
                  Structured Spatial Blueprint (`blueprint`):
                </div>
                <pre className="p-3.5 rounded-lg bg-[#070a0f] border border-white/10 text-sky-300 overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(activeRound.blueprint, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
