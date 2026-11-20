import { useState } from "react";
import { ImageOff, UserRound } from "lucide-react";
import { toMediaUrl } from "@/lib/mediaUrl";
import { cn } from "@/lib/utils";
import { personaLiveAvatarSchema, type PersonaLiveAvatar } from "@shared/avatar/personaAvatar";

export type ScenarioPersonaMedia = {
  id: string;
  mbti: string;
  images?: {
    base?: string;
    male?: { expressions?: Record<string, string> };
    female?: { expressions?: Record<string, string> };
  } | null;
  avatarMode?: "image" | "video" | "live" | null;
  liveAvatar?: PersonaLiveAvatar | null;
  videos?: { enabled?: boolean } | null;
};

export interface PersonaMediaPreviewProps {
  persona?: ScenarioPersonaMedia;
  gender?: "male" | "female";
  compact?: boolean;
  className?: string;
}

const LIVE_TITLE = "설정된 표시 방식이며 실제 연결 가능 여부는 시나리오 정책과 준비 상태에 따라 달라집니다.";

function resolveImageRef(persona: ScenarioPersonaMedia, gender?: "male" | "female"): string {
  const images = persona.images;
  if (!images) return "";
  if (images.base) return images.base;
  if (!gender) return "";
  const expr = images[gender]?.expressions;
  return expr?.["중립"] || expr?.neutral || "";
}

function Thumb({ sources, alt, size }: { sources: string[]; alt: string; size: string }) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const src = sources[sourceIndex];
  if (!src) {
    const label = sources.length ? "이미지를 불러오지 못했습니다" : "기본 이미지 없음";
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={cn(size, "inline-flex shrink-0 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-slate-400")}
      >
        <ImageOff className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setSourceIndex(sourceIndex + 1)}
      className={cn(size, "shrink-0 rounded-md border border-slate-200 bg-slate-100 object-cover object-top")}
    />
  );
}

export function PersonaPortrait({ persona, image, gender, alt, size }: {
  persona?: ScenarioPersonaMedia;
  image?: string;
  gender?: "male" | "female";
  alt: string;
  size: string;
}) {
  const sources = Array.from(new Set([
    toMediaUrl(image?.trim()),
    toMediaUrl(persona && resolveImageRef(persona, gender)),
  ].filter(Boolean)));
  return <Thumb key={JSON.stringify(sources)} sources={sources} alt={alt} size={size} />;
}

export function PersonaMediaPreview({ persona, gender, compact = false, className }: PersonaMediaPreviewProps) {
  const size = compact ? "h-7 w-7" : "h-10 w-10";

  if (!persona) {
    return (
      <span className={cn("inline-flex items-center gap-2 text-xs text-slate-500", className)}>
        <span
          role="img"
          aria-label="페르소나 미선택"
          className={cn(size, "inline-flex shrink-0 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-slate-400")}
        >
          <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        {!compact && <span>페르소나 미선택</span>}
      </span>
    );
  }

  const mode = persona.avatarMode ?? (persona.videos?.enabled ? "video" : "image");
  const hasLiveReference = mode === "live" && personaLiveAvatarSchema.safeParse(persona.liveAvatar).success;
  const alt = `${persona.mbti || persona.id} 기본 이미지`;

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <PersonaPortrait persona={persona} gender={gender} alt={alt} size={size} />
      {mode === "live" ? (
        hasLiveReference
          ? <span className="se-chip is-info" title={LIVE_TITLE}>라이브 아바타 설정</span>
          : <span className="se-chip is-warn" title="페르소나의 아바타 표시 탭에서 사용할 아바타를 선택하고 저장하세요.">라이브 아바타 미연결</span>
      ) : mode === "video" ? (
        <span className="se-chip" title="설정된 표시 방식">영상 아바타</span>
      ) : mode === "image" ? (
        !compact && <span className="se-chip" title="설정된 표시 방식">이미지 아바타</span>
      ) : null}
    </span>
  );
}

export default PersonaMediaPreview;
