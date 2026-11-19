import { describe, expect, it } from "vitest";
import { createInstance } from "i18next";
import en from "@/locales/en.json";
import ko from "@/locales/ko.json";
import { liveAvatarBlockerText, liveAvatarStartRefusalText } from "../liveAvatarBlockers";

describe.each(["ko", "en"])("%s live avatar start refusals", language => {
  it("uses the real translations and keeps all four reasons distinct", async () => {
    const i18n = createInstance();
    await i18n.init({ lng: language, resources: { en: { translation: en }, ko: { translation: ko } } });
    const translations = language === "ko" ? ko : en;
    const reasons = Object.entries(translations.liveAvatar.blockers).map(([code, expected]) => {
      expect(liveAvatarBlockerText(code, i18n.t, language)).toBe(expected);
      const actual = liveAvatarStartRefusalText(code, i18n.t, language);
      expect(actual).toBe(expected);
      return actual;
    });
    expect(new Set(reasons).size).toBe(4);
    expect(liveAvatarStartRefusalText("REQUEST_FAILED", i18n.t, language)).toBeNull();
    expect(liveAvatarStartRefusalText("toString", i18n.t, language)).toBeNull();
  });
});
