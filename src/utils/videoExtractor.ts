import { ExtractedFrame } from '../types/world';

export function formatSeconds(sec: number): string {
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(1).padStart(4, '0')}`;
}

export async function extractFramesFromVideoSource(
  videoSrc: string,
  frameCount = 5,
  maxDimension = 960,
  onProgress?: (
    framesSoFar: ExtractedFrame[],
    currentIndex: number,
    totalFrames: number,
    duration: number
  ) => void,
  timeoutMs = 30000
): Promise<{ frames: ExtractedFrame[]; duration: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    if (!videoSrc.startsWith('blob:') && !videoSrc.startsWith('data:')) {
      video.crossOrigin = 'anonymous';
    }
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    // Mount invisibly in DOM so Chromium hardware decoder paints frames reliably
    video.style.position = 'fixed';
    video.style.left = '-9999px';
    video.style.top = '-9999px';
    video.style.width = '320px';
    video.style.height = '180px';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    document.body.appendChild(video);

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
        if (video.parentNode) {
          video.parentNode.removeChild(video);
        }
      } catch {
        // Ignore cleanup errors
      }
    };

    const overallTimeout = window.setTimeout(() => {
      cleanup();
      reject(
        new Error(
          'Timed out while decoding video frames. Please ensure the file is a standard MP4, MOV, or WebM video.'
        )
      );
    }, timeoutMs);

    video.onerror = () => {
      window.clearTimeout(overallTimeout);
      cleanup();
      reject(
        new Error(
          'Browser could not decode this video codec. Please use a standard MP4 (H.264), MOV, or WebM drone clip.'
        )
      );
    };

    video.onloadedmetadata = async () => {
      try {
        const duration =
          Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 10;
        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;

        const scale = Math.min(1, maxDimension / Math.max(vw, vh));
        const width = Math.max(320, Math.round(vw * scale));
        const height = Math.max(180, Math.round(vh * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Could not initialize 2D canvas context for frame extraction.');
        }

        // For 2-10 minute clips, sample within the first 60s flight window so keyframes seek quickly and cover a coherent orbit
        const sampleWindow = Math.min(duration, 60);
        const timestamps: number[] = [];
        for (let i = 0; i < frameCount; i++) {
          const ratio = frameCount === 1 ? 0.5 : (i + 0.5) / frameCount;
          const t = Math.min(
            Math.max(0.2, sampleWindow * ratio),
            Math.max(0.2, duration - 0.1)
          );
          timestamps.push(t);
        }

        const extracted: ExtractedFrame[] = [];

        const seekAndCapture = (timeSec: number, idx: number): Promise<ExtractedFrame> => {
          return new Promise((resSeek) => {
            let settled = false;

            const captureNow = () => {
              if (settled) return;
              settled = true;
              video.removeEventListener('seeked', onSeeked);
              window.clearTimeout(seekTimer);
              ctx.drawImage(video, 0, 0, width, height);
              const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
              resSeek({
                index: idx,
                timestamp: timeSec,
                formattedTime: formatSeconds(timeSec),
                dataUrl,
                width,
                height,
              });
            };

            const onSeeked = () => {
              // Give the GPU decoder a moment to paint the frame buffer
              window.setTimeout(captureNow, 60);
            };

            const seekTimer = window.setTimeout(captureNow, 6000);

            video.addEventListener('seeked', onSeeked, { once: true });
            try {
              video.currentTime = timeSec;
            } catch {
              captureNow();
            }
          });
        };

        for (let i = 0; i < timestamps.length; i++) {
          const frame = await seekAndCapture(timestamps[i], i);
          extracted.push(frame);
          if (onProgress) {
            onProgress([...extracted], i + 1, timestamps.length, duration);
          }
        }

        window.clearTimeout(overallTimeout);
        cleanup();
        resolve({ frames: extracted, duration });
      } catch (err) {
        window.clearTimeout(overallTimeout);
        cleanup();
        reject(err);
      }
    };

    video.src = videoSrc;
    video.load();
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

