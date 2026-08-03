/**
 * AvatarRendererFactory
 *
 * Returns the correct AvatarRenderer implementation based on
 * the `VITE_AVATAR_RENDERER` environment variable.
 *
 * Supported values:
 *   "image"  (default) — ImageAvatarRenderer
 *   "video"            — VideoAvatarRenderer (not yet implemented; falls back to image)
 */

import type { AvatarRenderer } from './AvatarRenderer';
import { ImageAvatarRenderer } from './ImageAvatarRenderer';

export type AvatarRendererType = 'image' | 'video';

export function createAvatarRenderer(): AvatarRenderer {
  const type = (import.meta.env.VITE_AVATAR_RENDERER as AvatarRendererType | undefined) ?? 'image';

  switch (type) {
    case 'video':
      // VideoAvatarRenderer is a future task; fall back to image for now
      console.warn('[AvatarRendererFactory] "video" renderer is not yet available — falling back to "image"');
      return new ImageAvatarRenderer();

    case 'image':
    default:
      return new ImageAvatarRenderer();
  }
}
