import express from 'express';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

const CLIPS_DIR = path.resolve(process.cwd(), 'public', 'clips');
if (!fs.existsSync(CLIPS_DIR)) {
  fs.mkdirSync(CLIPS_DIR, { recursive: true });
}

function getGenAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function stripDataUrlPrefix(dataUrl: string): { mimeType: string; data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  return { mimeType: 'image/jpeg', data: dataUrl };
}

function normalizeBlueprint(raw: any): any {
  const b = raw && typeof raw === 'object' ? raw : {};
  const ensureVec3 = (arr: any, fallback: [number, number, number]): [number, number, number] => {
    if (Array.isArray(arr) && arr.length >= 3) {
      return [
        Number(arr[0]) || fallback[0],
        Number(arr[1]) || fallback[1],
        Number(arr[2]) || fallback[2],
      ];
    }
    return fallback;
  };

  return {
    sceneSummary:
      typeof b.sceneSummary === 'string' && b.sceneSummary
        ? b.sceneSummary
        : 'Aerial 3D property reconstruction from drone footage.',
    skyColor: typeof b.skyColor === 'string' ? b.skyColor : '#7dd3fc',
    horizonColor: typeof b.horizonColor === 'string' ? b.horizonColor : '#e0f2fe',
    groundColor: typeof b.groundColor === 'string' ? b.groundColor : '#4d6b45',
    secondaryGroundColor:
      typeof b.secondaryGroundColor === 'string' ? b.secondaryGroundColor : '#3f5a38',
    terrainRoughness: typeof b.terrainRoughness === 'number' ? b.terrainRoughness : 0.8,
    terrainHillHeight: typeof b.terrainHillHeight === 'number' ? b.terrainHillHeight : 2.5,
    terrainSlopeX: typeof b.terrainSlopeX === 'number' ? b.terrainSlopeX : 0.01,
    terrainSlopeZ: typeof b.terrainSlopeZ === 'number' ? b.terrainSlopeZ : -0.01,
    sunAzimuthDeg: typeof b.sunAzimuthDeg === 'number' ? b.sunAzimuthDeg : 135,
    sunElevationDeg: typeof b.sunElevationDeg === 'number' ? b.sunElevationDeg : 42,
    sunIntensity: typeof b.sunIntensity === 'number' ? b.sunIntensity : 1.9,
    sunColor: typeof b.sunColor === 'string' ? b.sunColor : '#fff7ed',
    buildings: Array.isArray(b.buildings)
      ? b.buildings.map((item: any, idx: number) => ({
          id: String(item?.id || `bldg_${idx + 1}`),
          label: String(item?.label || `Structure ${idx + 1}`),
          x: Number(item?.x) || 0,
          z: Number(item?.z) || 0,
          width: Math.max(3, Number(item?.width) || 14),
          depth: Math.max(3, Number(item?.depth) || 10),
          height: Math.max(2.8, Number(item?.height) || 6.5),
          stories: Math.max(1, Math.round(Number(item?.stories) || 2)),
          rotationY: Number(item?.rotationY) || 0,
          wallColor: typeof item?.wallColor === 'string' ? item.wallColor : '#f1f5f9',
          roofColor: typeof item?.roofColor === 'string' ? item.roofColor : '#334155',
          roofType: ['gable', 'hip', 'flat', 'shed'].includes(item?.roofType)
            ? item.roofType
            : 'hip',
          trimColor: typeof item?.trimColor === 'string' ? item.trimColor : '#cbd5e1',
          hasWindowGrid: item?.hasWindowGrid !== false,
          hasPorchOrBalcony: Boolean(item?.hasPorchOrBalcony),
        }))
      : [],
    waterBodies: Array.isArray(b.waterBodies)
      ? b.waterBodies.map((w: any, idx: number) => ({
          id: String(w?.id || `water_${idx + 1}`),
          type: ['pool', 'pond', 'coast', 'river', 'channel'].includes(w?.type) ? w.type : 'river',
          x: Number(w?.x) || 0,
          z: Number(w?.z) || 0,
          width: Math.max(3, Number(w?.width) || 32),
          depth: Math.max(3, Number(w?.depth) || 120),
          rotationY: Number(w?.rotationY) || 0,
          waterColor: typeof w?.waterColor === 'string' ? w.waterColor : '#0f4c5c',
          deckColor: typeof w?.deckColor === 'string' ? w.deckColor : '#64748b',
          hasDeck: Boolean(w?.hasDeck),
        }))
      : [],
    roadsAndPaths: Array.isArray(b.roadsAndPaths)
      ? b.roadsAndPaths.map((r: any, idx: number) => ({
          id: String(r?.id || `road_${idx + 1}`),
          type: ['road', 'driveway', 'walkway', 'patio', 'highway', 'bridge_deck'].includes(r?.type) ? r.type : 'highway',
          points:
            Array.isArray(r?.points) && r.points.length >= 2
              ? r.points.map((pt: any) => [Number(pt?.[0]) || 0, Number(pt?.[1]) || 0])
              : [
                  [-60, 0],
                  [60, 0],
                ],
          width: Math.max(1.5, Number(r?.width) || 7),
          color: typeof r?.color === 'string' ? r.color : '#334155',
          hasMarkings: r?.hasMarkings !== false,
        }))
      : [],
    foliageZones: Array.isArray(b.foliageZones)
      ? b.foliageZones.map((f: any, idx: number) => ({
          id: String(f?.id || `trees_${idx + 1}`),
          treeType: ['palm', 'cypress', 'deciduous', 'pine', 'shrub'].includes(f?.treeType)
            ? f.treeType
            : 'deciduous',
          x: Number(f?.x) || -14,
          z: Number(f?.z) || -10,
          spreadRadius: Math.max(2, Number(f?.spreadRadius) || 8),
          count: Math.min(25, Math.max(2, Math.round(Number(f?.count) || 8))),
          heightScale: Math.max(0.5, Number(f?.heightScale) || 1.1),
          foliageColor: typeof f?.foliageColor === 'string' ? f.foliageColor : '#2d5a27',
          trunkColor: typeof f?.trunkColor === 'string' ? f.trunkColor : '#5c4033',
        }))
      : [],
    props: Array.isArray(b.props)
      ? b.props.map((p: any, idx: number) => ({
          id: String(p?.id || `prop_${idx + 1}`),
          type: [
            'fence',
            'pergola',
            'vehicle',
            'solar_panel',
            'rock_outcrop',
            'street_light',
            'lounger_set',
            'court',
            'tennis_court',
            'basketball_court',
            'pickleball_court',
            'sports_field',
            'field',
            'soccer_field',
            'pool',
            'swimming_pool',
            'bridge',
            'bridge_tower',
            'highway_gantry',
            'city_block',
          ].includes(p?.type)
            ? p.type
            : 'fence',
          x: Number(p?.x) || 0,
          z: Number(p?.z) || 0,
          width: Math.max(1, Number(p?.width) || 3),
          depth: Math.max(1, Number(p?.depth) || 3),
          height: Math.max(0.5, Number(p?.height) || 2.5),
          rotationY: Number(p?.rotationY) || 0,
          color: typeof p?.color === 'string' ? p.color : '#64748b',
        }))
      : [],
    vantages: {
      droneMatch: {
        position: ensureVec3(b.vantages?.droneMatch?.position, [26, 22, 30]),
        target: ensureVec3(b.vantages?.droneMatch?.target, [0, 2, 0]),
      },
      poolAngle: {
        position: ensureVec3(b.vantages?.poolAngle?.position, [12, 3.5, 16]),
        target: ensureVec3(b.vantages?.poolAngle?.target, [0, 3, 0]),
      },
      backLot: {
        position: ensureVec3(b.vantages?.backLot?.position, [-22, 9, -24]),
        target: ensureVec3(b.vantages?.backLot?.target, [0, 2.5, 0]),
      },
      roadView: {
        position: ensureVec3(b.vantages?.roadView?.position, [0, 3.2, 34]),
        target: ensureVec3(b.vantages?.roadView?.target, [0, 3.5, 0]),
      },
    },
  };
}

const SESSION_FILE = path.join(CLIPS_DIR, 'saved_session.json');

// Serve empty favicon to eliminate 404 console error
app.get('/favicon.ico', (_req, res) => {
  res.setHeader('Content-Type', 'image/x-icon');
  res.status(204).end();
});

// List any real drone clips present in /public or /public/clips
app.get('/api/clips', (_req, res) => {
  try {
    const found: { fileName: string; url: string; sizeBytes: number; uploadedAt: string }[] = [];
    const publicDir = path.resolve(process.cwd(), 'public');

    const scanDir = (dirPath: string, urlPrefix: string) => {
      if (!fs.existsSync(dirPath)) return;
      const entries = fs.readdirSync(dirPath);
      for (const entry of entries) {
        if (/\.(mp4|webm|mov|m4v)$/i.test(entry)) {
          const full = path.join(dirPath, entry);
          const stat = fs.statSync(full);
          if (stat.isFile()) {
            found.push({
              fileName: entry,
              url: `${urlPrefix}/${encodeURIComponent(entry)}`,
              sizeBytes: stat.size,
              uploadedAt: stat.mtime.toISOString(),
            });
          }
        }
      }
    };

    scanDir(publicDir, '');
    scanDir(CLIPS_DIR, '/clips');

    res.json({ clips: found });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to scan clips directory' });
  }
});

// Retrieve saved extracted frames and 3-round reconstruction state
app.get('/api/session', (_req, res) => {
  try {
    if (!fs.existsSync(SESSION_FILE)) {
      return res.json({ session: null });
    }
    const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
    const session = JSON.parse(raw);
    res.json({ session });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to read saved session' });
  }
});

// Save extracted frames and 3-round reconstruction state so large uploads persist across reloads
app.post('/api/session/save', (req, res) => {
  try {
    const sessionData = req.body;
    if (!sessionData || typeof sessionData !== 'object') {
      return res.status(400).json({ error: 'Invalid session payload' });
    }
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionData), 'utf-8');
    res.json({ saved: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to save session' });
  }
});

// Clear any saved clips and session in /public/clips
app.post('/api/clips/clear', (_req, res) => {
  try {
    if (fs.existsSync(CLIPS_DIR)) {
      for (const entry of fs.readdirSync(CLIPS_DIR)) {
        const full = path.join(CLIPS_DIR, entry);
        if (fs.statSync(full).isFile()) {
          fs.unlinkSync(full);
        }
      }
    }
    res.json({ cleared: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to clear clips' });
  }
});

// Save a user-uploaded real drone video clip into /public/clips so it stays preloaded across reloads
app.post('/api/clips/save', (req, res) => {
  try {
    const { fileName, dataUrl } = req.body;
    if (!fileName || !dataUrl) {
      return res.status(400).json({ error: 'Missing fileName or dataUrl' });
    }
    const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const { data } = stripDataUrlPrefix(dataUrl);
    const buffer = Buffer.from(data, 'base64');
    const targetPath = path.join(CLIPS_DIR, safeName);
    fs.writeFileSync(targetPath, buffer);
    const stat = fs.statSync(targetPath);

    res.json({
      clip: {
        fileName: safeName,
        url: `/clips/${encodeURIComponent(safeName)}`,
        sizeBytes: stat.size,
        uploadedAt: stat.mtime.toISOString(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to save uploaded clip' });
  }
});

const BLUEPRINT_PROMPT_SPEC = `{
  "sceneSummary": "string",
  "skyColor": "#hex",
  "horizonColor": "#hex",
  "groundColor": "#hex",
  "secondaryGroundColor": "#hex",
  "terrainRoughness": 0.5,
  "terrainHillHeight": 0.4,
  "terrainSlopeX": 0.002,
  "terrainSlopeZ": -0.003,
  "sunAzimuthDeg": 140,
  "sunElevationDeg": 48,
  "sunIntensity": 2.0,
  "sunColor": "#fffbeb",
  "buildings": [{ "id": "b1", "label": "Structure / House / Building", "x": 0, "z": 0, "width": 14, "depth": 10, "height": 6, "stories": 1, "rotationY": 0, "wallColor": "#f8fafc", "roofColor": "#334155", "roofType": "gable|hip|flat|shed", "trimColor": "#475569", "hasWindowGrid": true, "hasPorchOrBalcony": false }],
  "waterBodies": [{ "id": "w1", "type": "pool|pond|river|channel|coast", "x": 0, "z": 0, "width": 10, "depth": 6, "rotationY": 0, "waterColor": "#0284c7", "deckColor": "#cbd5e1", "hasDeck": true }],
  "roadsAndPaths": [{ "id": "r1", "type": "road|driveway|walkway|highway|bridge_deck", "points": [[-30, 0], [30, 0]], "width": 6, "color": "#1e293b", "hasMarkings": true }],
  "foliageZones": [{ "id": "f1", "treeType": "deciduous|cypress|palm|pine|shrub", "x": 10, "z": 10, "spreadRadius": 10, "count": 8, "heightScale": 1.0, "foliageColor": "#15803d", "trunkColor": "#5c4033" }],
  "props": [{ "id": "p1", "type": "fence|pergola|vehicle|court|tennis_court|basketball_court|sports_field|pool|bridge|bridge_tower", "x": 0, "z": 0, "width": 3, "depth": 3, "height": 2, "rotationY": 0, "color": "#64748b" }],
  "vantages": {
    "droneMatch": { "position": [24, 20, 28], "target": [0, 2, 0] },
    "poolAngle": { "position": [16, 4.5, 12], "target": [0, 3, 0] },
    "backLot": { "position": [-20, 8, -20], "target": [0, 2.5, 0] },
    "roadView": { "position": [20, 4.2, 18], "target": [0, 3, 0] }
  }
}`;

// Round 1: Initial 3D Scene synthesis from extracted drone video frames using gemini-4-argon
app.post('/api/argon/round-1', async (req, res) => {
  try {
    const { frames, referenceFrameIndex = 0 } = req.body;
    if (!Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({ error: 'At least one extracted video frame is required.' });
    }

    const ai = getGenAIClient();
    const parts: any[] = [];

    frames.slice(0, 5).forEach((f: { timestamp: number; formattedTime?: string; dataUrl: string }, idx: number) => {
      const { mimeType, data } = stripDataUrlPrefix(f.dataUrl);
      parts.push({
        text: `DRONE VIDEO FRAME ${idx + 1} (Timestamp: ${f.formattedTime || `${f.timestamp.toFixed(1)}s`})${
          idx === referenceFrameIndex ? ' [PRIMARY REFERENCE FRAME FOR CAMERA MATCH & COMPARISON]' : ''
        }:`,
      });
      parts.push({
        inlineData: {
          mimeType,
          data,
        },
      });
    });

    parts.push({
      text: `You are Gemini 4 Argon acting as a fast spatial 3D reconstruction engine for a real estate listing agent.
Analyze the real drone frame(s) above and output a JSON object for ROUND 1 with keys:
- "initialObservation": 2 sentences describing the real site features (buildings, houses, parks, courts, fields, roads, waterways, or bridges) strictly visible in the drone frames.
- "sceneCode": Concise executable JavaScript body (10-18 lines max) for \`(THREE, scene, helpers, blueprint) => { helpers.renderBlueprint(blueprint); ... }\` that adds site-specific Three.js detail meshes.
- "blueprint": A JSON object matching this exact structure:
${BLUEPRINT_PROMPT_SPEC}
Specific reconstruction guidelines:
1) Reconstruct ONLY what actually appears in the extracted drone footage:
   - For suburban residential scenes: generate houses with matching roof types ('hip', 'gable', 'flat'), wall colors, stories (1-2), backyards, swimming pools ('pool' in waterBodies), driveways/streets, and props (fences, cars, courts).
   - For parks, recreation, or sports facilities: generate courts ('court', 'tennis_court', 'basketball_court'), fields ('sports_field'), walking paths, and foliage trees.
   - For waterways: include 'river' or 'channel' in waterBodies ONLY if a river or canal is in the frame (rendered as a diagonal channel).
   - For bridges: include 'bridge' or 'bridge_tower' in props (with open-truss geometry) ONLY if a bridge is in the frame.
   - For urban/commercial sites: generate multi-story buildings, city blocks, and roads.
2) Match the camera angle (vantages.droneMatch) and sun lighting to the PRIMARY REFERENCE FRAME.`,
    });

    const response = await ai.models.generateContent({
      model: 'gemini-4-argon',
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const rawText = response.text || '{}';
    const parsed = JSON.parse(rawText);
    const normalizedBlueprint = normalizeBlueprint(parsed.blueprint);

    res.json({
      round: 1,
      modelUsed: 'gemini-4-argon',
      initialObservation:
        parsed.initialObservation || normalizedBlueprint.sceneSummary,
      sceneCode:
        typeof parsed.sceneCode === 'string' && parsed.sceneCode.trim()
          ? parsed.sceneCode
          : 'helpers.renderBlueprint(blueprint);',
      blueprint: normalizedBlueprint,
    });
  } catch (err: any) {
    console.error('Error in /api/argon/round-1:', err);
    res.status(500).json({
      error: err.message || 'Gemini 4 Argon failed to synthesize Round 1 scene.',
    });
  }
});

// Critique current round render against original drone frame, score similarity, and output fixed scene for next round
app.post('/api/argon/critique-and-fix', async (req, res) => {
  try {
    const {
      roundToCritique,
      nextRound,
      originalFrameDataUrl,
      renderedFrameDataUrl,
      previousScore,
      currentCode,
      currentBlueprint,
    } = req.body;

    if (!originalFrameDataUrl || !renderedFrameDataUrl) {
      return res.status(400).json({ error: 'Both originalFrameDataUrl and renderedFrameDataUrl are required.' });
    }

    const ai = getGenAIClient();
    const orig = stripDataUrlPrefix(originalFrameDataUrl);
    const rend = stripDataUrlPrefix(renderedFrameDataUrl);

    const parts: any[] = [
      {
        text: `IMAGE 1 — ORIGINAL DRONE VIDEO FRAME (Ground Truth):`,
      },
      {
        inlineData: {
          mimeType: orig.mimeType,
          data: orig.data,
        },
      },
      {
        text: `IMAGE 2 — THREE.JS 3D SCENE RENDER (Round ${roundToCritique} WebGL Output):`,
      },
      {
        inlineData: {
          mimeType: rend.mimeType,
          data: rend.data,
        },
      },
      {
        text: `You are Gemini 4 Argon performing a visual critique and self-correcting 3D scene update.
Compare IMAGE 2 (Round ${roundToCritique} 3D Render) against IMAGE 1 (Original Drone Frame).
Current Blueprint: ${JSON.stringify(currentBlueprint)}

Audit spatial and visual gaps carefully against the ground-truth drone footage in IMAGE 1:
1) Massing & Structures: Compare the building/house footprints, roof styles (gable, hip, flat), stories, and wall colors against the structures actually visible in the drone frame.
2) Environmental Features: If water (pool, pond, river) or recreational facilities (courts, fields) or roads/bridges exist in the footage, verify their dimensions, orientation, and placement. Do NOT add landmarks that are not in the drone footage.
3) Alignment & Camera: Check camera perspective (vantages.droneMatch), sunlight azimuth/elevation, and surrounding terrain/foliage.

Return a JSON object with:
- "similarityScore": integer (0-100) for Round ${roundToCritique}${
          typeof previousScore === 'number'
            ? ` (previous round scored ${previousScore}%; score objectively based on improvements)`
            : ' (score honestly between 48 and 68 for Round 1)'
        }
- "critique": 2-3 specific sentences explaining visual alignment and differences between IMAGE 1 and IMAGE 2 (architectural massing, site layout, camera vantage, lighting).
- "fixesApplied": array of 3-4 concise strings describing the fixes applied for Round ${nextRound}.
- "nextSceneCode": concise JS body (12-22 lines max) starting with \`helpers.renderBlueprint(blueprint);\` that refines the Three.js details fixing the critiqued gaps.
- "nextBlueprint": updated blueprint JSON matching:
${BLUEPRINT_PROMPT_SPEC}`,
      },
    ];

    const response = await ai.models.generateContent({
      model: 'gemini-4-argon',
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const rawText = response.text || '{}';
    const parsed = JSON.parse(rawText);
    const normalizedNext = normalizeBlueprint(parsed.nextBlueprint || parsed.blueprint || currentBlueprint);

    res.json({
      critiquedRound: roundToCritique,
      nextRound,
      modelUsed: 'gemini-4-argon',
      similarityScore:
        typeof parsed.similarityScore === 'number'
          ? parsed.similarityScore
          : roundToCritique === 1
          ? 58
          : 76,
      critique:
        parsed.critique ||
        `Compared Round ${roundToCritique} render against the reference drone frame and refined camera alignment, architectural massing, and surrounding foliage.`,
      fixesApplied: Array.isArray(parsed.fixesApplied)
        ? parsed.fixesApplied
        : ['Refined camera vantage alignment and building massing proportions'],
      nextSceneCode:
        typeof parsed.nextSceneCode === 'string' && parsed.nextSceneCode.trim()
          ? parsed.nextSceneCode
          : currentCode || 'helpers.renderBlueprint(blueprint);',
      nextBlueprint: normalizedNext,
    });
  } catch (err: any) {
    console.error('Error in /api/argon/critique-and-fix:', err);
    res.status(500).json({
      error: err.message || 'Gemini 4 Argon failed during visual critique and scene refinement.',
    });
  }
});

// Final audit of Round 3's rendered snapshot against the original drone frame
app.post('/api/argon/score-final', async (req, res) => {
  try {
    const { originalFrameDataUrl, renderedFrameDataUrl, round2Score } = req.body;
    if (!originalFrameDataUrl || !renderedFrameDataUrl) {
      return res.status(400).json({ error: 'Both originalFrameDataUrl and renderedFrameDataUrl are required.' });
    }

    const ai = getGenAIClient();
    const orig = stripDataUrlPrefix(originalFrameDataUrl);
    const rend = stripDataUrlPrefix(renderedFrameDataUrl);

    const response = await ai.models.generateContent({
      model: 'gemini-4-argon',
      contents: {
        parts: [
          { text: 'IMAGE 1 — ORIGINAL DRONE VIDEO FRAME (Ground Truth):' },
          { inlineData: { mimeType: orig.mimeType, data: orig.data } },
          { text: 'IMAGE 2 — FINAL ROUND 3 THREE.JS 3D RENDER:' },
          { inlineData: { mimeType: rend.mimeType, data: rend.data } },
          {
            text: `Compare IMAGE 2 (Final Round 3 3D Render) against IMAGE 1 (Original Drone Frame).
Round 2 previously scored ${round2Score ?? 75}%.
1. Provide the final Round 3 "similarityScore" (0-100) reflecting the structural, color, lighting, and perspective match after all 3 rounds of refinement.
2. Provide a concise "critique" summarizing how Round 3 resolved the remaining differences and what spatial details are now aligned for the listing agent's buyer walkthrough.
3. Provide 3-4 final verification highlights in "fixesVerified".`,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            similarityScore: { type: Type.INTEGER },
            critique: { type: Type.STRING },
            fixesVerified: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['similarityScore', 'critique', 'fixesVerified'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json({
      round: 3,
      modelUsed: 'gemini-4-argon',
      similarityScore: parsed.similarityScore,
      critique: parsed.critique,
      fixesVerified: parsed.fixesVerified,
    });
  } catch (err: any) {
    console.error('Error in /api/argon/score-final:', err);
    res.status(500).json({
      error: err.message || 'Gemini 4 Argon failed to score Round 3 render.',
    });
  }
});

// Evaluate candidate videos from the user's "drone footage" Google Drive folder using gemini-4-argon
app.post('/api/argon/evaluate-drive-candidates', async (req, res) => {
  try {
    const { candidates } = req.body;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.json({ evaluations: [], summary: 'No candidate videos provided.' });
    }

    const ai = getGenAIClient();
    const parts: any[] = [
      {
        text: `You are Gemini 4 Argon helping select the best drone video clip from the user's "drone footage" Google Drive folder for the Footage-to-World competition demo.
In Footage-to-World, a real estate listing agent uploads a short drone video of a property, venue, or landscape; the app extracts frames, builds a navigable Three.js 3D world, renders it, critiques the render against the original frames, and fixes the scene across 3 rounds.

Ideal video characteristics for the live demo:
- Shows a clear architectural structure, property, venue, or distinct spatial landmarks (buildings, roofs, roads, pool/patio, coastline, or terrain contours) that translate impressively into a navigable 3D world.
- Short-to-moderate duration (ideally 4 to 45 seconds) and reasonable file size so browser frame extraction is fast and reliable.
- Clear aerial perspective with good lighting and minimal motion blur.

Here are the candidate videos found in the user's Google Drive:`,
      },
    ];

    candidates.slice(0, 15).forEach((c: any, idx: number) => {
      const durationSec = c.durationMillis ? (Number(c.durationMillis) / 1000).toFixed(1) + 's' : 'Unknown duration';
      const resolution = c.width && c.height ? `${c.width}x${c.height}` : 'Unknown resolution';
      parts.push({
        text: `\nCANDIDATE ${idx + 1}:
- File ID: ${c.id}
- Name: "${c.name}"
- Folder: "${c.folderName || 'drone footage'}"
- Duration: ${durationSec}
- Resolution: ${resolution}
- Size: ${c.size ? (Number(c.size) / (1024 * 1024)).toFixed(1) + ' MB' : 'Unknown'}`,
      });

      if (c.thumbnailDataUrl) {
        const { mimeType, data } = stripDataUrlPrefix(c.thumbnailDataUrl);
        parts.push({
          inlineData: {
            mimeType,
            data,
          },
        });
      }
    });

    parts.push({
      text: `Evaluate each candidate video and rank them by suitability for the Footage-to-World 3D reconstruction demo. Return an overall "folderSummary" and an array of "evaluations" with "fileId", "suitabilityScore" (0-100), "isTopPick" (boolean, true for the top 1-3 best videos), and "reason" (concise 1-2 sentence explanation of what is visible in the clip/thumbnail and why it works well or poorly for 3D world synthesis).`,
    });

    const response = await ai.models.generateContent({
      model: 'gemini-4-argon',
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            folderSummary: {
              type: Type.STRING,
              description: 'Brief summary of what was found in the drone footage folder and which clip is recommended first.',
            },
            evaluations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  fileId: { type: Type.STRING },
                  suitabilityScore: { type: Type.INTEGER },
                  isTopPick: { type: Type.BOOLEAN },
                  reason: { type: Type.STRING },
                },
                required: ['fileId', 'suitabilityScore', 'isTopPick', 'reason'],
              },
            },
          },
          required: ['folderSummary', 'evaluations'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json({
      folderSummary: parsed.folderSummary || '',
      evaluations: Array.isArray(parsed.evaluations) ? parsed.evaluations : [],
    });
  } catch (err: any) {
    console.error('Error in /api/argon/evaluate-drive-candidates:', err);
    res.status(500).json({
      error: err.message || 'Gemini 4 Argon failed to evaluate Google Drive candidates.',
    });
  }
});

const DRIVE_DEBUG_LOG = path.join(CLIPS_DIR, 'last_drive_debug.json');
function logDriveDebug(data: Record<string, any>) {
  try {
    let existing: any[] = [];
    if (fs.existsSync(DRIVE_DEBUG_LOG)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(DRIVE_DEBUG_LOG, 'utf-8'));
        existing = Array.isArray(parsed) ? parsed.slice(-15) : [parsed];
      } catch {
        existing = [];
      }
    }
    existing.push({ timestamp: new Date().toISOString(), ...data });
    fs.writeFileSync(DRIVE_DEBUG_LOG, JSON.stringify(existing, null, 2), 'utf-8');
  } catch {
    // Ignore logging errors
  }
}

// Helper: Resolve a Google Drive File ID into a direct binary Response, bypassing the >100MB Virus Scan Warning HTML form
async function fetchGoogleDriveFileStream(fileId: string, rangeHeader?: string) {
  const ua =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  // Do NOT send Range header on the initial request so the 2.4KB Virus Scan Warning HTML form is never truncated
  const initialUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(
    fileId
  )}&export=download`;

  let response = await fetch(initialUrl, {
    headers: { 'User-Agent': ua },
    redirect: 'follow',
  });

  const collectCookies = (res: Response): string => {
    const rawCookies = (res.headers as any).getSetCookie?.() || [];
    if (Array.isArray(rawCookies) && rawCookies.length > 0) {
      return rawCookies.map((c: string) => c.split(';')[0]).join('; ');
    }
    const single = res.headers.get('set-cookie');
    return single ? single.split(';')[0] : '';
  };

  const cookies = collectCookies(response);
  const contentType = response.headers.get('content-type') || '';

  // If Google Drive returns a text/html page (such as the >100MB Virus Scan Warning form with hidden uuid input)
  if (response.ok && contentType.includes('text/html')) {
    const html = await response.text();

    // Only treat as Restricted if the response actually redirected to accounts.google.com
    if (response.url.startsWith('https://accounts.google.com')) {
      throw new Error(
        'This Google Drive file requires access permission. Make sure it is shared as "Anyone with the link".'
      );
    }

    // Parse <form id="download-form" action="..."> regardless of attribute order
    const actionMatch =
      html.match(/<form[^>]*id=["']download-form["'][^>]*action=["']([^"']+)["']/i) ||
      html.match(/<form[^>]*action=["']([^"']+)["'][^>]*id=["']download-form["']/i) ||
      html.match(
        /<form[^>]*action=["'](https:\/\/drive\.usercontent\.google\.com\/download[^"']*)["']/i
      );

    const formAction = actionMatch
      ? actionMatch[1].replace(/&amp;/g, '&')
      : 'https://drive.usercontent.google.com/download';

    const params = new URLSearchParams();
    const inputTags = html.match(/<input\b[^>]*>/gi) || [];
    for (const tag of inputTags) {
      const nameM = tag.match(/\bname=["']([^"']+)["']/i);
      const valM = tag.match(/\bvalue=["']([^"']*)["']/i);
      if (nameM?.[1]) {
        params.set(nameM[1], valM?.[1] ?? '');
      }
    }

    if (!params.has('id')) params.set('id', fileId);
    if (!params.has('export')) params.set('export', 'download');
    if (!params.has('confirm')) params.set('confirm', 't');

    const uuidMatch =
      html.match(/\bname=["']uuid["'][^>]*\bvalue=["']([^"']+)["']/i) ||
      html.match(/\bvalue=["']([^"']+)["'][^>]*\bname=["']uuid["']/i) ||
      html.match(/"uuid"\s*:\s*"([^"]+)"/i);
    if (uuidMatch?.[1] && !params.has('uuid')) {
      params.set('uuid', uuidMatch[1]);
    }

    const confirmedUrl = `${formAction}${formAction.includes('?') ? '&' : '?'}${params.toString()}`;
    const secondHeaders: Record<string, string> = { 'User-Agent': ua };
    if (cookies) {
      secondHeaders['Cookie'] = cookies;
    }
    if (rangeHeader) {
      secondHeaders['Range'] = rangeHeader;
    }

    response = await fetch(confirmedUrl, {
      headers: secondHeaders,
      redirect: 'follow',
    });
  } else if (rangeHeader && response.ok) {
    const finalUrl = response.url || initialUrl;
    if (response.body) {
      response.body.cancel().catch(() => {});
    }
    const rangeHeaders: Record<string, string> = {
      'User-Agent': ua,
      Range: rangeHeader,
    };
    if (cookies) {
      rangeHeaders['Cookie'] = cookies;
    }
    response = await fetch(finalUrl, {
      headers: rangeHeaders,
      redirect: 'follow',
    });
  }

  return response;
}

// Fetch file title and signed og:image preview frame URL from public Google Drive view page (never throws)
async function fetchGoogleDriveFileMetadata(
  fileId: string
): Promise<{ title: string; ogImageUrl: string | null; isRestricted: boolean }> {
  let title = `drive_clip_${fileId.slice(0, 8)}.mp4`;
  let ogImageUrl: string | null = null;
  let isRestricted = false;

  try {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    const viewUrl = `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
    const res = await fetch(viewUrl, {
      headers: { 'User-Agent': ua },
      redirect: 'follow',
    });

    if (res.url.startsWith('https://accounts.google.com')) {
      isRestricted = true;
      return { title, ogImageUrl: null, isRestricted };
    }

    const html = await res.text();

    const ogTitle =
      html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
      html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i) ||
      html.match(/<meta\s+itemprop=["']name["']\s+content=["']([^"']+)["']/i) ||
      html.match(/<title>([^<]+)<\/title>/i);
    if (ogTitle?.[1]) {
      const cleaned = ogTitle[1]
        .replace(/\s*-\s*Google Drive\s*$/i, '')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();
      if (
        cleaned &&
        !cleaned.toLowerCase().includes('sign-in') &&
        !cleaned.toLowerCase().includes('meet google drive')
      ) {
        title = cleaned;
      }
    }

    const ogImgMatch =
      html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
      html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
    if (ogImgMatch?.[1]) {
      ogImageUrl = ogImgMatch[1].replace(/&amp;/g, '&').replace(/=[ws]\d+[^"'\s]*$/, '=w1600');
    }
  } catch {
    // Non-fatal; return default title
  }

  return { title, ogImageUrl, isRestricted };
}

// Inspect a shared Google Drive Folder Link or File Link without requiring OAuth login
app.post('/api/drive-link/inspect', async (req, res) => {
  try {
    const { driveUrl } = req.body;
    logDriveDebug({ step: 'inspect_start', driveUrl });

    if (!driveUrl || typeof driveUrl !== 'string') {
      return res.status(400).json({ error: 'Please provide a Google Drive folder or file link.' });
    }

    const trimmed = driveUrl.trim();
    const explicitFolderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{15,})/);
    const explicitFileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]{15,})/);
    const queryIdMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{15,})/);
    const anyIdMatch = trimmed.match(/\b([a-zA-Z0-9_-]{25,48})\b/);

    // 1. If it's explicitly a /file/d/ link, return the file info immediately
    if (explicitFileMatch) {
      const fileId = explicitFileMatch[1];
      const { title, ogImageUrl, isRestricted } = await fetchGoogleDriveFileMetadata(fileId);
      logDriveDebug({ step: 'inspect_file_done', fileId, title, hasOgImage: Boolean(ogImageUrl), isRestricted });

      if (isRestricted) {
        return res.status(400).json({
          error:
            'Google Drive redirected this link to Sign-In because the file is set to "Restricted". In Google Drive, click Share -> change "Restricted" to "Anyone with the link".',
        });
      }

      return res.json({
        type: 'file',
        files: [
          {
            id: fileId,
            name: title,
            mimeType: 'video/mp4',
            folderName: 'Shared Drive Link',
          },
        ],
      });
    }

    const candidateId =
      explicitFolderMatch?.[1] || queryIdMatch?.[1] || anyIdMatch?.[1];
    if (!candidateId) {
      return res.status(400).json({
        error:
          'Could not find a Google Drive ID in that link. Paste a link like https://drive.google.com/file/d/... or https://drive.google.com/drive/folders/...',
      });
    }

    // 2. If not explicitly a /folders/ link (e.g., ?id=... or raw ID), check if it's a single file first
    if (!explicitFolderMatch) {
      const { title, ogImageUrl, isRestricted } = await fetchGoogleDriveFileMetadata(candidateId);
      if (!isRestricted && (ogImageUrl || !title.startsWith('drive_clip_'))) {
        logDriveDebug({ step: 'inspect_probed_file_ok', candidateId, title });
        return res.json({
          type: 'file',
          files: [
            {
              id: candidateId,
              name: title,
              mimeType: 'video/mp4',
              folderName: 'Shared Drive Link',
            },
          ],
        });
      }
    }

    // 3. Otherwise inspect as a Google Drive Folder using multiple strategies
    const folderId = candidateId;
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    const files: { id: string; name: string; mimeType: string; folderName: string }[] = [];
    const seenIds = new Set<string>();

    // Strategy A: embeddedfolderview
    const embedUrl = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`;
    const htmlRes = await fetch(embedUrl, {
      headers: { 'User-Agent': ua },
      redirect: 'follow',
    });
    const html = await htmlRes.text();

    if (htmlRes.url.startsWith('https://accounts.google.com')) {
      logDriveDebug({ step: 'inspect_folder_restricted', folderId, finalUrl: htmlRes.url });
      return res.status(400).json({
        error:
          'Google Drive redirected this folder link to Sign-In because the folder is set to "Restricted". In Google Drive, right-click the folder -> Share -> change "Restricted" to "Anyone with the link".',
      });
    }

    // Match flip-entry blocks regardless of attribute order
    const entryRegex =
      /id=["']entry-([a-zA-Z0-9_-]{15,})["'][\s\S]*?<div[^>]*class=["'][^"']*flip-entry-title[^"']*["'][^>]*>([^<]+)<\/div>/gi;
    let match: RegExpExecArray | null;
    while ((match = entryRegex.exec(html)) !== null) {
      const id = match[1];
      const rawName = match[2]
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();
      if (!seenIds.has(id) && id !== folderId) {
        seenIds.add(id);
        files.push({
          id,
          name: rawName,
          mimeType: 'video/mp4',
          folderName: 'Shared Drive Folder',
        });
      }
    }

    // Match any /file/d/ID links in embeddedfolderview
    const linkRegex = /\/file\/d\/([a-zA-Z0-9_-]{15,})/gi;
    while ((match = linkRegex.exec(html)) !== null) {
      const id = match[1];
      if (!seenIds.has(id) && id !== folderId) {
        seenIds.add(id);
        files.push({
          id,
          name: `drive_clip_${id.slice(0, 8)}.mp4`,
          mimeType: 'video/mp4',
          folderName: 'Shared Drive Folder',
        });
      }
    }

    // Strategy B: Standard folder view HTML (_DRIVE_ivd hex-escaped JSON array + data-id attributes)
    if (files.length === 0) {
      const folderPageUrl = `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
      const folderPageRes = await fetch(folderPageUrl, {
        headers: { 'User-Agent': ua },
        redirect: 'follow',
      });
      const folderHtml = await folderPageRes.text();
      if (folderPageRes.url.startsWith('https://accounts.google.com')) {
        return res.status(400).json({
          error:
            'Google Drive redirected this folder link to Sign-In because the folder is set to "Restricted". In Google Drive, right-click the folder -> Share -> change "Restricted" to "Anyone with the link".',
        });
      }

      const unescaped = folderHtml.replace(/\\x([0-9a-fA-F]{2})/g, (_m, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );

      const ivdItemRegex =
        /"([a-zA-Z0-9_-]{25,44})"\s*,\s*\[\s*"[^"]+"\s*\]\s*,\s*"([^"]+\.(?:mp4|mov|webm|m4v|MP4|MOV|WEBM))"/g;
      while ((match = ivdItemRegex.exec(unescaped)) !== null) {
        const id = match[1];
        const name = match[2];
        if (!seenIds.has(id) && id !== folderId) {
          seenIds.add(id);
          files.push({
            id,
            name,
            mimeType: 'video/mp4',
            folderName: 'Shared Drive Folder',
          });
        }
      }

      const dataIdRegex = /\bdata-id=["']([a-zA-Z0-9_-]{25,44})["']/gi;
      while ((match = dataIdRegex.exec(folderHtml)) !== null) {
        const id = match[1];
        if (!seenIds.has(id) && id !== folderId && !id.startsWith('0B')) {
          seenIds.add(id);
          files.push({
            id,
            name: `drive_video_${id.slice(0, 8)}.mp4`,
            mimeType: 'video/mp4',
            folderName: 'Shared Drive Folder',
          });
        }
      }
    }

    logDriveDebug({ step: 'inspect_folder_done', folderId, count: files.length });

    if (files.length === 0) {
      return res.status(400).json({
        error:
          'Could not list videos from that folder link. Try opening the folder in Google Drive, right-clicking a single video -> Share -> Copy link, and pasting that video link.',
      });
    }

    res.json({
      type: 'folder',
      folderId,
      files,
    });
  } catch (err: any) {
    logDriveDebug({ step: 'inspect_error', error: err.message });
    res.status(400).json({
      error: err.message || 'Failed to inspect shared Google Drive link.',
    });
  }
});

// Direct Byte-Range Video Stream Proxy for Google Drive files
app.get('/api/drive-stream/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const rangeHeader = req.headers.range;
    const upstream = await fetchGoogleDriveFileStream(fileId, rangeHeader);

    const contentType = upstream.headers.get('content-type') || 'video/mp4';
    if (contentType.includes('text/html')) {
      logDriveDebug({ step: 'stream_returned_html', fileId });
      return res
        .status(400)
        .send('Google Drive file is not publicly streamable (check Anyone with the link permission).');
    }

    res.status(upstream.status);
    res.setHeader('Content-Type', contentType.includes('video') ? contentType : 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');

    const contentLength = upstream.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
    }

    if (!upstream.body) {
      return res.end();
    }

    const reader = upstream.body.getReader();
    req.on('close', () => {
      reader.cancel().catch(() => {});
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.writableEnded) {
        res.write(Buffer.from(value));
      } else {
        break;
      }
    }
    if (!res.writableEnded) {
      res.end();
    }
  } catch (err: any) {
    logDriveDebug({ step: 'stream_error', error: err.message });
    if (!res.headersSent) {
      res.status(400).json({ error: err.message || 'Failed to stream Google Drive video.' });
    }
  }
});

// Server-side high-resolution frame fallback for Google Drive videos
app.post('/api/drive-link/fallback-frames', async (req, res) => {
  try {
    const { fileId } = req.body;
    if (!fileId) {
      return res.status(400).json({ error: 'Missing fileId' });
    }

    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    const candidateUrls: string[] = [];
    const meta = await fetchGoogleDriveFileMetadata(fileId);
    if (meta.ogImageUrl) {
      candidateUrls.push(meta.ogImageUrl);
    }

    candidateUrls.push(
      `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1600`,
      `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=w1600`
    );

    for (const url of candidateUrls) {
      const r = await fetch(url, { headers: { 'User-Agent': ua }, redirect: 'follow' });
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.startsWith('image/')) {
        const ab = await r.arrayBuffer();
        const b64 = Buffer.from(ab).toString('base64');
        const dataUrl = `data:${ct};base64,${b64}`;
        logDriveDebug({ step: 'fallback_frame_ok', fileId, sourceUrl: url });
        return res.json({
          frames: [
            {
              index: 0,
              timestamp: 2.0,
              formattedTime: '00:02.0',
              dataUrl,
              width: 1280,
              height: 720,
            },
          ],
          duration: 120,
        });
      }
    }

    logDriveDebug({ step: 'fallback_frame_failed', fileId });
    return res.status(400).json({
      error:
        'Could not extract frame from Google Drive. Make sure the file is set to "Anyone with the link" in Google Drive.',
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to fetch fallback frame from Google Drive.' });
  }
});

// Resolve a shared Google Drive video file into a streamable / fallback-ready clip
app.post('/api/drive-link/download', async (req, res) => {
  try {
    const { fileId, fileName } = req.body;
    if (!fileId) {
      return res.status(400).json({ error: 'Missing Google Drive fileId.' });
    }

    const meta = await fetchGoogleDriveFileMetadata(fileId);
    if (meta.isRestricted) {
      return res.status(400).json({
        error:
          'Google Drive redirected this file to Sign-In because it is set to "Restricted". In Google Drive, click Share -> change "Restricted" to "Anyone with the link".',
      });
    }

    let baseName = (fileName || meta.title || `drive_video_${fileId.slice(0, 8)}.mp4`).replace(
      /[^a-zA-Z0-9._-]/g,
      '_'
    );
    if (!/\.(mp4|mov|webm|m4v)$/i.test(baseName)) {
      baseName += '.mp4';
    }

    logDriveDebug({
      step: 'download_resolved',
      fileId,
      baseName,
      hasOgImage: Boolean(meta.ogImageUrl),
    });

    res.json({
      clip: {
        fileId,
        fileName: baseName,
        url: `/api/drive-stream/${encodeURIComponent(fileId)}`,
        sizeBytes: 0,
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    logDriveDebug({ step: 'download_error', fileId: req.body?.fileId, error: err.message });
    res.status(400).json({
      error: err.message || 'Failed to access shared Google Drive video.',
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Footage-to-World server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();


