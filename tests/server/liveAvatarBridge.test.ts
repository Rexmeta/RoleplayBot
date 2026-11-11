import { describe, it, expect, vi, afterEach } from "vitest";
import { LiveAvatarAudioBridge } from "../../server/services/liveAvatar/audioBridge";
import type { AvatarPcmFrame } from "../../shared/avatar/liveAvatar";

function setup(limits?: { maxBufferedMs: number; maxQueueAgeMs: number; operationTimeoutMs: number }) {
  const transport = {
    sendAudio: vi.fn().mockResolvedValue(undefined),
    finishTurn: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const fallback = vi.fn();
  return { transport, fallback, bridge: new LiveAvatarAudioBridge(transport, fallback, limits) };
}
const frame = (overrides: Partial<AvatarPcmFrame> = {}): AvatarPcmFrame => ({
  source: "ai", encoding: "pcm_s16le", sampleRate: 24000, channels: 1,
  turnSeq: 1, sequence: 0, generation: 0, data: new Uint8Array(480), ...overrides,
});
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

describe("isolated live-avatar audio lifecycle (synthetic transport only)", () => {
  it("keeps local audio ownership until real media readiness", async () => {
    const { bridge, transport } = setup();
    expect(bridge.ownsAudio).toBe(false);
    expect(bridge.push(frame())).toBe(false);
    await settle();
    expect(transport.sendAudio).not.toHaveBeenCalled();
    bridge.mediaReady();
    expect(bridge.ownsAudio).toBe(true);
    await bridge.close();
  });

  it("serializes frames and turn completion, copying bytes before enqueue", async () => {
    const { bridge, transport } = setup();
    bridge.mediaReady();
    const first = frame();
    expect(bridge.push(first)).toBe(true);
    first.data[0] = 99;
    bridge.push(frame({ sequence: 1 }));
    bridge.finishTurn(1);
    bridge.finishTurn(1);
    expect(bridge.push(frame({ sequence: 2 }))).toBe(false);
    await settle();
    expect(transport.sendAudio.mock.calls.map(([f]) => f.sequence)).toEqual([0, 1]);
    expect(transport.sendAudio.mock.calls[0][0].data[0]).toBe(0);
    expect(transport.finishTurn).toHaveBeenCalledTimes(1);
    expect(transport.finishTurn.mock.invocationCallOrder[0]).toBeGreaterThan(transport.sendAudio.mock.invocationCallOrder[1]);
    await bridge.close();
  });

  it.each([
    { source: "microphone" }, { encoding: "opus" }, { sampleRate: 16000 },
    { channels: 2 }, { data: new Uint8Array(3) }, { data: new Uint8Array(0) },
    { turnSeq: -1 }, { turnSeq: NaN }, { sequence: 0.5 },
  ])("rejects unsupported PCM without writing to transport: %j", async invalid => {
    const { bridge, transport, fallback } = setup();
    bridge.mediaReady();
    expect(bridge.push(frame(invalid as Partial<AvatarPcmFrame>))).toBe(false);
    expect(bridge.ownsAudio).toBe(false);
    expect(fallback).toHaveBeenCalledWith("invalid_pcm");
    await settle();
    expect(transport.sendAudio).not.toHaveBeenCalled();
    await bridge.close();
  });

  it("drops duplicate, older-turn and older-generation frames", async () => {
    const { bridge, transport } = setup();
    bridge.mediaReady();
    bridge.push(frame({ turnSeq: 3, sequence: 4 }));
    expect(bridge.push(frame({ turnSeq: 3, sequence: 4 }))).toBe(false);
    expect(bridge.push(frame({ turnSeq: 2, sequence: 5 }))).toBe(false);
    expect(bridge.push(frame({ turnSeq: 4, sequence: 5, generation: -1 }))).toBe(false);
    await settle();
    expect(transport.sendAudio).toHaveBeenCalledTimes(1);
    await bridge.close();
  });

  it("bounds pending duration and restores existing output on overflow", async () => {
    const { bridge, fallback } = setup({ maxBufferedMs: 15, maxQueueAgeMs: 1000, operationTimeoutMs: 1000 });
    bridge.mediaReady();
    bridge.push(frame());
    expect(bridge.push(frame({ sequence: 1 }))).toBe(false);
    expect(fallback).toHaveBeenCalledWith("queue_overflow");
    expect(bridge.ownsAudio).toBe(false);
    await bridge.close();
  });

  it("clears queued/in-flight work on barge-in and waits for flush plus fresh media readiness", async () => {
    const { bridge, transport } = setup();
    let ack!: () => void;
    transport.sendAudio.mockImplementation(() => new Promise(() => {}));
    transport.interrupt.mockImplementation(() => new Promise<void>(resolve => { ack = resolve; }));
    bridge.mediaReady();
    bridge.push(frame());
    bridge.push(frame({ sequence: 1 }));
    await settle();
    const oldSignal = transport.sendAudio.mock.calls[0][1];
    bridge.interrupt();
    bridge.mediaReady();
    expect(bridge.ownsAudio).toBe(false);
    expect(oldSignal.aborted).toBe(true);
    await settle();
    expect(transport.sendAudio).toHaveBeenCalledTimes(1);
    expect(bridge.push(frame({ turnSeq: 2, generation: 1 }))).toBe(false);
    ack();
    await settle();
    bridge.mediaReady();
    expect(bridge.ownsAudio).toBe(true);
    expect(bridge.push(frame({ sequence: 2, generation: 1 }))).toBe(false);
    transport.sendAudio.mockResolvedValue(undefined);
    expect(bridge.push(frame({ turnSeq: 2, generation: 1 }))).toBe(true);
    await settle();
    await bridge.close();
  });

  it("fails closed on timeout, aborting and closing once", async () => {
    vi.useFakeTimers();
    const { bridge, transport, fallback } = setup();
    transport.sendAudio.mockImplementation(() => new Promise(() => {}));
    bridge.mediaReady();
    bridge.push(frame());
    await vi.advanceTimersByTimeAsync(1100);
    expect(fallback).toHaveBeenCalledWith("transport_timeout");
    expect(bridge.ownsAudio).toBe(false);
    bridge.mediaReady();
    bridge.interrupt();
    expect(bridge.ownsAudio).toBe(false);
    await Promise.all([bridge.close(), bridge.close()]);
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it("reports a rejected transport and never replays lost frames through local output", async () => {
    const { bridge, transport, fallback } = setup();
    transport.sendAudio.mockRejectedValue(new Error("provider failure"));
    bridge.mediaReady();
    bridge.push(frame());
    bridge.push(frame({ sequence: 1 }));
    await settle();
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledWith("transport_failed");
    expect(transport.sendAudio).toHaveBeenCalledTimes(1);
    await bridge.close();
  });

  it("discards a frame whose queue age exceeded its limit", async () => {
    vi.useFakeTimers();
    const { bridge, transport, fallback } = setup({ maxBufferedMs: 1000, maxQueueAgeMs: 10, operationTimeoutMs: 1000 });
    let release!: () => void;
    transport.sendAudio.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    bridge.mediaReady();
    bridge.push(frame());
    bridge.push(frame({ sequence: 1 }));
    await settle();
    await vi.advanceTimersByTimeAsync(20);
    release();
    await settle();
    expect(fallback).toHaveBeenCalledWith("stale_audio");
    expect(transport.sendAudio).toHaveBeenCalledTimes(1);
    await bridge.close();
  });

  it("cannot reactivate after termination or persona-switch cleanup", async () => {
    const { bridge, transport } = setup();
    bridge.mediaReady();
    await bridge.close();
    bridge.mediaReady();
    expect(bridge.push(frame())).toBe(false);
    expect(transport.sendAudio).not.toHaveBeenCalled();
    expect(bridge.state).toBe("closed");
  });

  it("does not hang local shutdown when remote cleanup never acknowledges", async () => {
    vi.useFakeTimers();
    const { bridge, transport } = setup();
    transport.close.mockImplementation(() => new Promise(() => {}));
    const closed = bridge.close();
    await vi.advanceTimersByTimeAsync(1100);
    await closed;
    expect(bridge.state).toBe("closed");
    expect(transport.close).toHaveBeenCalledTimes(1);
  });
});
