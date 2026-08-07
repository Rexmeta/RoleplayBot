---
name: Veo avatar clip container & letterbox
description: Veo returns MP4/H.264 with occasional baked-in black bars; both must be normalised before storing an avatar clip.
---

Veo output for avatar clips is **always H.264/AAC in an MP4 container**, never WebM,
and the frame is **sometimes a square render padded into the requested aspect ratio
with solid black bars** (letterbox when portrait was requested, pillarbox when the
render came back landscape).

Two rules follow, and both were learned the hard way:

1. **Store the clip under a key/content-type that matches the actual bytes.**
   Serving MP4 bytes as `video/webm` makes Chrome refuse to decode them: `canplay`
   never fires, so a renderer that waits for readiness reports a timeout and falls
   back to the static portrait. Every clip appears "missing" while the object itself
   downloads fine over HTTP — which makes it look like a network or CSS problem.

2. **Crop the padding before upload.** `object-fit: cover` scales the padded frame to
   fill the portrait, so a black bar lands across the top of the avatar and reads as a
   layout bug. Requesting a portrait aspect ratio does *not* guarantee Veo renders one.

**Why:** a black band above the avatar was chased through viewport offsets, fixed-panel
positioning and CSS stacking for a long time before the pixels were measured; the bars
were inside the generated video the whole time. Measure the asset before suspecting layout.

**How to apply:** when a generated clip looks mispositioned or silently fails to play,
run `ffprobe` for the real container/codec and `ffmpeg -vf cropdetect` for the content
rectangle *before* touching client code. Detection parses ffmpeg's report from **both**
stdout and stderr — a shell-level `2>&1` moves the lines off stderr and makes the crop
silently no-op.
