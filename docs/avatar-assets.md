# Avatar Assets — Directory Structure & Naming Rules

This document covers the asset conventions for the **VideoAvatarRenderer** (`VITE_AVATAR_RENDERER=video`).  
The ImageAvatarRenderer uses a separate WebP image convention described in the codebase comments.

---

## Directory Layout

```
public/
└── avatars/
    └── {avatarId}/               # matches persona.id
        ├── neutral/               # required fallback emotion folder
        │   ├── idle.mp4
        │   ├── listening.mp4
        │   ├── listening_nod.mp4
        │   ├── thinking.mp4
        │   ├── speaking.mp4
        │   └── speaking_pause.mp4
        ├── happy/
        │   ├── idle.mp4
        │   ├── listening.mp4
        │   ├── listening_nod.mp4
        │   ├── thinking.mp4
        │   ├── speaking.mp4
        │   └── speaking_pause.mp4
        ├── sad/
        │   └── … (same six files)
        ├── angry/
        ├── surprised/
        ├── curious/
        ├── anxious/
        ├── tired/
        ├── disappointed/
        ├── confused/
        └── determined/
```

### Emotion folders

| Folder name    | Canonical emotion key |
|----------------|----------------------|
| `neutral`      | neutral              |
| `happy`        | happy                |
| `sad`          | sad                  |
| `angry`        | angry                |
| `surprised`    | surprised            |
| `curious`      | curious              |
| `anxious`      | anxious              |
| `tired`        | tired                |
| `disappointed` | disappointed         |
| `confused`     | confused             |
| `determined`   | determined           |

### State files

| Filename            | When played                                         |
|---------------------|-----------------------------------------------------|
| `idle.mp4`          | No activity — default standby                       |
| `listening.mp4`     | User is speaking                                    |
| `listening_nod.mp4` | User finished a short phrase; avatar gives a nod    |
| `thinking.mp4`      | LLM is processing (post-user speech, pre-TTS audio) |
| `speaking.mp4`      | Avatar is producing TTS audio                       |
| `speaking_pause.mp4`| Avatar paused briefly between sentences             |

---

## Fallback Logic

1. Renderer requests `avatars/{avatarId}/{emotion}/{state}.mp4`.
2. If that file returns a 404 / load error, the renderer falls back to `avatars/{avatarId}/neutral/{state}.mp4`.
3. The `neutral` folder is **required**. All six state files must exist for every avatar; missing neutral files will result in a blank video layer.

---

## Recommended Video Specifications

| Property        | Recommended value                                    |
|-----------------|------------------------------------------------------|
| Codec           | H.264 (Baseline or Main profile) for broadest compatibility |
| Container       | MP4 (`.mp4`)                                         |
| Resolution      | 512 × 512 px minimum; 1024 × 1024 px recommended     |
| Frame rate      | 24–30 fps                                            |
| Duration        | 2–4 s (seamlessly loopable; start ≈ end frame)       |
| Audio           | None (muted playback; omit audio track to reduce file size) |
| Bitrate         | ≤ 1 Mbps for smooth mobile decode                   |
| Colour profile  | sRGB                                                 |

### Loop guidance
- The last frame must visually match the first frame so the browser's `loop` attribute produces a seamless loop without a jump cut.
- Avoid hard cuts; a subtle ease or held pose at the loop point works best.

---

## Activation

Set the environment variable before starting the dev server:

```bash
VITE_AVATAR_RENDERER=video npm run dev
```

Or in `.env.local`:

```
VITE_AVATAR_RENDERER=video
```

The default value is `image`, which uses `ImageAvatarRenderer` and loads no video code.

---

## GPU Decode Hints

All `<video>` elements created by `VideoAvatarRenderer` include:

```html
<video muted loop playsinline preload="auto" …>
```

- **`muted`** — required for autoplay in most browsers.
- **`playsinline`** — prevents iOS from opening the native full-screen player.
- **`preload="auto"`** — hints to the browser to decode the video into memory before it is needed, enabling sub-50 ms state switches.
