import { CULTURE_DIMENSIONS, type CultureProfile } from "./cultureMap";

/** A display heuristic, NOT a validated statistical or cultural threshold. */
export const CULTURE_SIMILARITY_THRESHOLD = 10;

export function cultureProfileConfidence(profile: CultureProfile) {
  return profile.origin?.originalProfile.confidence ?? profile.assessment?.confidence ?? "unspecified";
}

export function matchesCultureProfile(
  profile: CultureProfile,
  filters: { search?: string; region?: string; confidence?: string },
) {
  const search = filters.search?.trim().toLocaleLowerCase() ?? "";
  const region = profile.region || "__unspecified__";
  return (!search || [profile.name, profile.country, profile.region].some(part => part.toLocaleLowerCase().includes(search)))
    && (!filters.region || filters.region === "all" || region === filters.region)
    && (!filters.confidence || filters.confidence === "all" || cultureProfileConfidence(profile) === filters.confidence);
}

/** Only operational app dimensions are compared. Origin values preserve the
 * uploaded, opposite persuading axis and must never drive a comparison. */
export function compareCultureProfiles(reference: CultureProfile, other: CultureProfile) {
  return CULTURE_DIMENSIONS.map(dimension => {
    const referenceValue = reference.dimensions[dimension.key];
    const value = other.dimensions[dimension.key];
    const delta = Number((value - referenceValue).toFixed(10));
    const similar = Math.abs(delta) <= CULTURE_SIMILARITY_THRESHOLD;
    const description = similar
      ? `${other.name}과(와) ${reference.name}의 ${dimension.label} 점수는 유사합니다 (차이 ${Math.abs(delta)}점).`
      : `${other.name}은(는) ${reference.name} 대비 ${dimension.label} 축의 ${delta > 0 ? dimension.high : dimension.low} 방향으로 ${Math.abs(delta)}점 차이가 있습니다.`;
    return { ...dimension, referenceValue, value, delta, similar, description };
  });
}
