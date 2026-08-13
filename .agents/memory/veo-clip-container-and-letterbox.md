---
name: Veo clip container & letterbox
description: Veo always returns MP4/H.264; letterbox black bars are baked into frames and must be normalized before storage.
---

# Veo clip container & letterbox

## Rule
Veo API always returns MP4/H.264 regardless of what container format is requested. Additionally, clips often have black letterbox bars baked into the frames (not as metadata padding). These bars must be detected and removed with `ffprobe`/`cropdetect` before storing the clip.

**Why:** If the raw Veo output is saved without normalization, players show black bars that look like broken UI. Serving the file as `.webm` after a container rename causes Chrome to refuse playback because the codec is H.264, not VP8/VP9/AV1.

**How to apply:** Any code path that receives a video blob or URL from Veo must:
1. Run `ffprobe` to detect letterbox regions (`cropdetect` filter).
2. Re-encode or crop if bars are detected before storing.
3. Always save as `.mp4` with H.264 — never rename to `.webm`.
4. If the destination key/pipeline requires `.webm` (e.g. scenario intro videos), transcode with ffmpeg to real VP9/Opus first — check the EBML magic (0x1A45DFA3) before trusting a `.webm` key. Symptom of a mislabeled file in prod: Chrome starts playback then aborts mid-stream (video freezes, then white screen).
