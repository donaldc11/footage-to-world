# Footage-to-World

Turn real drone footage into a navigable 3D world.

Built at the **Gemini 4 Argon SF hackathon** (Oct 25, 2026) with Google AI Studio Build.

## What it does

1. Paste a Google Drive link to a drone video (or upload an .mp4/.mov/.webm).
2. The app extracts frames and sends them to Gemini (Argon) for scene analysis.
3. It builds a **simulated Three.js scene** from what the footage actually shows — houses, parks, bridges, water — then runs a **3-round autonomous loop**: render, visual self-critique against the source frames, scene fix, re-score.
4. An audit panel shows each round's similarity score and what the model chose to fix.

## Honest limits

- The output is a **simulated approximation**, not a photogrammetric reconstruction. Similarity scores swing run to run (we saw 45-74%).
- No real-world geometry is measured; the scene is generated geometry inspired by the frames.

## Stack

- Vite + React + TypeScript front end (`src/`)
- Three.js scene builder (`src/utils/threeBuilder.ts`)
- Gemini server calls (`server.ts`, AI Studio Cloud Run runtime)
- Google Drive video ingest (`src/utils/googleDriveAuth.ts`)

## Running it

This app runs inside Google AI Studio Build, which injects `GEMINI_API_KEY` and hosting at runtime (see `.env.example`). `firebase-applet-config.json` values are redacted; supply your own Firebase web app config.

## License

Hackathon prototype, provided as-is for judging review.
