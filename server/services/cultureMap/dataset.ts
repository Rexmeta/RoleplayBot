import { z } from "zod";
import { v5 as uuidv5 } from "uuid";
import rawDataset from "../../data/culture-map/roleplayx-2026.json";
import {
  CULTURE_DIMENSIONS, EDITORIAL_CULTURE_NOTICE, SYSTEM_CULTURE_OWNER_ID,
  cultureDatasetProfileSchema, cultureProfileInputSchema, type CultureValues,
} from "../../../shared/cultureMap";

const axisSchema = z.object({ key: z.string(), ko: z.string(), low: z.string(), high: z.string() }).strict();
const datasetSchema = z.object({
  dataset: z.string(), createdOn: z.string(), importantNotice: z.string(), method: z.string(),
  scale: z.object({
    range: z.tuple([z.literal(0), z.literal(100)]), neutral: z.literal(50),
    precision: z.literal(5), axes: z.array(axisSchema).length(8),
  }).strict(),
  sources: z.array(z.object({ id: z.string(), title: z.string(), url: z.string().url(), usage: z.string() }).strict()),
  profiles: z.array(cultureDatasetProfileSchema).length(47),
}).strict();

export const countryCultureDataset = datasetSchema.parse(rawDataset);
// Fail closed if a replacement file changes scale semantics. Seven axes agree;
// the uploaded persuading scale is applications -> principles, unlike this app.
const expectedAxes = [
  ["communicating", "저맥락·명시적", "고맥락·암묵적"],
  ["evaluating", "직접적", "간접적"],
  ["persuading", "적용 우선", "원리 우선"],
  ["leading", "평등주의", "위계주의"],
  ["deciding", "합의형", "하향식"],
  ["trusting", "업무 기반", "관계 기반"],
  ["disagreeing", "공개적 논쟁", "갈등 회피"],
  ["scheduling", "선형적 일정", "유연한 일정"],
];
for (const [key, low, high] of expectedAxes) {
  const axis = countryCultureDataset.scale.axes.find(a => a.key === key);
  if (!axis || axis.low !== low || axis.high !== high) throw new Error(`Unrecognized dataset axis: ${key}`);
}
export function datasetDimensionsToApp(original: CultureValues): CultureValues {
  return { ...original, persuading: 100 - original.persuading };
}
export function countrySeedKey(profile: { countryCode: string; profileVersion: string; profileType: string }) {
  return JSON.stringify([profile.countryCode, profile.profileVersion, profile.profileType]);
}
export function countrySeedId(profile: Parameters<typeof countrySeedKey>[0]) {
  return uuidv5(`${SYSTEM_CULTURE_OWNER_ID}:${countrySeedKey(profile)}`, uuidv5.URL);
}
const keys = new Set<string>();
const sourceIds = new Set(countryCultureDataset.sources.map(s => s.id));
for (const profile of countryCultureDataset.profiles) {
  const key = countrySeedKey(profile);
  if (keys.has(key)) throw new Error(`Duplicate country baseline: ${key}`);
  keys.add(key);
  if (profile.sourceIds.some(id => !sourceIds.has(id))) throw new Error(`Missing source for ${key}`);
  if (CULTURE_DIMENSIONS.some(({ key }) => profile.dimensions[key] % 5 !== 0)) throw new Error(`Invalid dataset precision: ${key}`);
}
export const countryCultureSeedProfiles = countryCultureDataset.profiles.map(originalProfile => ({
  id: countrySeedId(originalProfile),
  content: cultureProfileInputSchema.parse({
    name: originalProfile.countryNameKo, country: originalProfile.countryNameKo,
    region: originalProfile.region, visibility: "shared",
    description: `${EDITORIAL_CULTURE_NOTICE}\n공식 Erin Meyer 점수가 아니며 검증 전 초안입니다.\n${originalProfile.notesKo}`,
    dimensions: datasetDimensionsToApp(originalProfile.dimensions),
    sources: originalProfile.sourceIds.map(id => {
      const source = countryCultureDataset.sources.find(s => s.id === id)!;
      return {
        title: source.title, url: source.url, locator: `첨부 JSON sources.${id}`,
        note: `${source.usage} — 첨부 자료의 참고문헌이며, 해당 기관이 이 점수를 측정하거나 검증했다는 의미가 아닙니다.`,
      };
    }),
    origin: {
      datasetId: "roleplayx-2026", dataset: countryCultureDataset.dataset,
      createdOn: countryCultureDataset.createdOn, importantNotice: countryCultureDataset.importantNotice,
      method: countryCultureDataset.method, originalProfile,
      axisTransforms: ["persuading:100-x"],
    },
  }),
}));
