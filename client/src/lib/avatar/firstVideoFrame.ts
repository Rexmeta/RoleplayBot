/** Subscription, canplay and DOM playing alone are not presented-frame evidence. */
export function onFirstVideoFrame(video: HTMLVideoElement, onFrame: () => void) {
  let closed = false, handle: number | undefined, previous = video.currentTime;
  const valid = () => !closed && !video.paused && video.videoWidth > 0 && video.videoHeight > 0;
  const cleanup = () => {
    closed = true;
    if (handle !== undefined) video.cancelVideoFrameCallback?.(handle);
    video.removeEventListener("timeupdate", advance);
  };
  const present = () => {
    if (!valid()) return false;
    cleanup(); onFrame(); return true;
  };
  const frame = () => {
    if (closed) return;
    if (!present()) handle = video.requestVideoFrameCallback(frame);
  };
  const advance = () => {
    const advanced = video.currentTime > previous;
    previous = video.currentTime;
    if (advanced) present();
  };
  if (video.requestVideoFrameCallback) handle = video.requestVideoFrameCallback(frame);
  else video.addEventListener("timeupdate", advance);
  return cleanup;
}
