import { memo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface PersonaPortraitProps {
  src?: string | null;
  name: string;
  alt?: string;
  /** CSS aspect-ratio, defaults to a 4:5 portrait */
  aspect?: string;
  /** object-position keeping face/upper body in frame */
  focal?: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
  imgClassName?: string;
  children?: React.ReactNode;
}

export function getInitials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join("").toUpperCase();
  return (Array.from(parts[0])[0] + Array.from(parts[parts.length - 1])[0]).toUpperCase();
}

function PersonaPortraitBase({
  src,
  name,
  alt,
  aspect = "4 / 5",
  focal = "50% 18%",
  sizes = "(min-width: 1024px) 220px, (min-width: 640px) 45vw, 92vw",
  priority = false,
  className,
  imgClassName,
  children,
}: PersonaPortraitProps) {
  const [failed, setFailed] = useState(!src);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(!src);
    setLoaded(false);
  }, [src]);

  return (
    <div
      className={cn("relative w-full overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200", className)}
      style={{ aspectRatio: aspect }}
      data-testid="persona-portrait"
      data-aspect={aspect}
    >
      {failed ? (
        <div
          role="img"
          aria-label={alt ?? name}
          className="absolute inset-0 flex items-center justify-center"
          data-testid="persona-portrait-fallback"
        >
          <span className="flex aspect-square w-[38%] max-w-28 items-center justify-center rounded-full bg-white/80 text-[clamp(1rem,4vw,1.75rem)] font-semibold tracking-wide text-slate-600 ring-1 ring-slate-300/70">
            {getInitials(name)}
          </span>
        </div>
      ) : (
        <img
          src={src!}
          alt={alt ?? name}
          sizes={sizes}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          width={400}
          height={500}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-500 motion-reduce:transition-none",
            loaded ? "opacity-100" : "opacity-0",
            imgClassName,
          )}
          style={{ objectPosition: focal }}
        />
      )}
      {children}
    </div>
  );
}

export const PersonaPortrait = memo(PersonaPortraitBase);
export default PersonaPortrait;
