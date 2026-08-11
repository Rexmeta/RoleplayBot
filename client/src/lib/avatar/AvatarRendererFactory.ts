/**
 * AvatarRendererFactory
 *
 * Returns the correct AvatarRenderer implementation based on
 * the `VITE_AVATAR_RENDERER` environment variable.
 *
 * Supported values:
 *   "image"  (default) — ImageAvatarRenderer
 *   "video"            — VideoAvatarRenderer (dynamic import; excluded from image-mode bundle)
 */

import type { AvatarRenderer } from './AvatarRenderer';
import { ImageAvatarRenderer } from './ImageAvatarRenderer';

export type AvatarRendererType = 'image' | 'video';

export async function createAvatarRenderer(hint?: 'image' | 'video'): Promise<AvatarRenderer> {
  // hint (persona-level setting) takes priority over the env variable
  const envType = (import.meta.env.VITE_AVATAR_RENDERER as AvatarRendererType | undefined) ?? 'image';
  const type: AvatarRendererType = hint ?? envType;

  switch (type) {
    case 'video': {
      const { VideoAvatarRenderer } = await import('./VideoAvatarRenderer');
      return new VideoAvatarRenderer();
    }

    case 'image':
    default:
      return new ImageAvatarRenderer();
  }
}
