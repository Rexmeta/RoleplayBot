import { describe, expect, it } from "vitest";
import { compareCultureProfiles, cultureProfileConfidence, matchesCultureProfile } from "../../shared/cultureComparison";
import { CULTURE_DIMENSIONS, SYSTEM_CULTURE_OWNER_ID, type CultureProfile } from "../../shared/cultureMap";
import { countryCultureSeedProfiles } from "../../server/services/cultureMap/dataset";

const profiles: CultureProfile[] = countryCultureSeedProfiles.map(seed => ({
  ...seed.content, id: seed.id, ownerId: SYSTEM_CULTURE_OWNER_ID, version: 1,
  createdAt: "", updatedAt: "",
}));

describe("culture comparison on app axes", () => {
  it("uses operational transformed persuading values, not uploaded provenance", () => {
    const [a, b] = profiles.filter(p => p.origin!.originalProfile.dimensions.persuading !== 50);
    const rows = compareCultureProfiles(a, b);
    const row = rows.find(row => row.key === "persuading")!;
    expect(row.referenceValue).toBe(100 - a.origin!.originalProfile.dimensions.persuading);
    expect(row.value).toBe(100 - b.origin!.originalProfile.dimensions.persuading);
    expect(row.delta).toBe(row.value - row.referenceValue);
    expect(rows.map(row => row.key)).toEqual(CULTURE_DIMENSIONS.map(d => d.key));
    expect(row.low).toBe("원리 우선");
    expect(row.high).toBe("적용 우선");
  });

  it("describes identical and near-identical scores as similar regardless of country", () => {
    const a = profiles[0];
    const b = { ...profiles[1], dimensions: { ...a.dimensions, communicating: a.dimensions.communicating + 10 } };
    for (const row of compareCultureProfiles(a, b)) {
      expect(row.similar).toBe(true);
      expect(row.description).toContain("유사");
      expect(row.description).not.toContain("방향");
    }
    b.dimensions.communicating += 1;
    const row = compareCultureProfiles(a, b)[0];
    expect(row.similar).toBe(false);
    expect(row.description).toContain("고맥락");
    expect(compareCultureProfiles(b, a)[0].description).toContain("저맥락");
    expect(compareCultureProfiles(b, a)[0].delta).toBe(-11);
  });

  it("compares edited clone values without silently restoring its source scores", () => {
    const source = profiles[0];
    const clone = { ...source, dimensions: { ...source.dimensions, persuading: 0 } };
    expect(compareCultureProfiles(source, clone).find(d => d.key === "persuading")!.value).toBe(0);
    expect(cultureProfileConfidence(clone)).toBe(cultureProfileConfidence(source));
  });

  it("combines search, region, and confidence without excluding custom profiles by default", () => {
    const a = profiles[0];
    expect(matchesCultureProfile(a, { search: ` ${a.country} `, region: a.region, confidence: cultureProfileConfidence(a) })).toBe(true);
    expect(matchesCultureProfile(a, { region: "nonexistent" })).toBe(false);
    expect(matchesCultureProfile(a, { confidence: "unspecified" })).toBe(false);
    expect(matchesCultureProfile(a, { search: "no matching name" })).toBe(false);
    const custom = { ...a, origin: undefined, region: "" };
    expect(cultureProfileConfidence(custom)).toBe("unspecified");
    expect(matchesCultureProfile(custom, { region: "__unspecified__", confidence: "unspecified" })).toBe(true);
    expect(matchesCultureProfile(custom, { region: "all", confidence: "all" })).toBe(true);
  });
});
