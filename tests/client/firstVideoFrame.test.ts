// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { onFirstVideoFrame } from "../../client/src/lib/avatar/firstVideoFrame";
function fixture(native: boolean) {
  const video = document.createElement("video");
  let frame: (() => void) | undefined;
  Object.defineProperties(video, {
    paused: { value: false, configurable: true, writable: true },
    videoWidth: { value: 640, configurable: true, writable: true },
    videoHeight: { value: 480, configurable: true, writable: true },
    currentTime: { value: 0, configurable: true, writable: true },
    requestVideoFrameCallback: { configurable: true, value: native ? (cb: () => void) => { frame = cb; return 1; } : undefined },
    cancelVideoFrameCallback: { value: vi.fn(), configurable: true },
  });
  return { video, frame: () => frame?.() };
}
describe("offline first presented-frame evidence", () => {
  it("ignores DOM playing/readiness/subscription and reports a native frame only once", () => {
    const f = fixture(true), report = vi.fn();
    const stop = onFirstVideoFrame(f.video, report);
    f.video.dispatchEvent(new Event("playing")); f.video.dispatchEvent(new Event("canplay"));
    expect(report).not.toHaveBeenCalled();
    f.frame(); f.frame();
    expect(report).toHaveBeenCalledTimes(1); stop();
  });
  it("does not report paused or dimensionless native frames; cancellation fences late callbacks", () => {
    const f = fixture(true), report = vi.fn();
    Object.defineProperty(f.video, "paused", { value: true });
    const stop = onFirstVideoFrame(f.video, report);
    f.frame(); expect(report).not.toHaveBeenCalled();
    Object.defineProperty(f.video, "paused", { value: false });
    Object.defineProperty(f.video, "videoWidth", { value: 0 });
    f.frame(); expect(report).not.toHaveBeenCalled();
    stop(); Object.defineProperty(f.video, "videoWidth", { value: 640 });
    f.frame(); expect(report).not.toHaveBeenCalled();
  });
  it("fallback requires advancing media time and no longer reports after cancellation", () => {
    const f = fixture(false), report = vi.fn();
    const stop = onFirstVideoFrame(f.video, report);
    f.video.dispatchEvent(new Event("playing")); f.video.dispatchEvent(new Event("timeupdate"));
    expect(report).not.toHaveBeenCalled();
    f.video.currentTime = 1; f.video.dispatchEvent(new Event("timeupdate"));
    f.video.currentTime = 2; f.video.dispatchEvent(new Event("timeupdate"));
    expect(report).toHaveBeenCalledTimes(1); stop();
    const another = fixture(false), cancel = onFirstVideoFrame(another.video, report);
    cancel(); another.video.currentTime = 1; another.video.dispatchEvent(new Event("timeupdate"));
    expect(report).toHaveBeenCalledTimes(1);
  });
});
