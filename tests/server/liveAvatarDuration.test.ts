import { describe, expect, it } from "vitest";
import { liveAvatarDeadline, liveAvatarDurationSeconds } from "../../shared/avatar/conversationDuration";

describe("live avatar scenario duration", () => {
  it.each([[5, 300], [10, 600], [12, 600], [60, 600], [0, 600], [-1, 600],
    [undefined, 600], [null, 600], [NaN, 600], [Infinity, 600]])("bounds %s minutes", (input, seconds) => {
    expect(liveAvatarDurationSeconds(input)).toBe(seconds);
  });
  it("preserves the earlier deadline and supports legacy sessions", () => {
    const early = "2026-11-17T06:00:00.000Z", late = "2026-11-17T06:10:00.000Z";
    expect(liveAvatarDeadline(early, late)).toBe(early);
    expect(liveAvatarDeadline(late, early)).toBe(early);
    expect(liveAvatarDeadline(late)).toBe(late);
  });
});
