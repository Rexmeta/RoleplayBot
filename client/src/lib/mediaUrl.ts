export function toMediaUrl(ref: string | null | undefined): string {
  if (!ref) return "";

  if (/^https?:\/\//i.test(ref)) return ref;

  if (ref.startsWith("/objects?key=")) return ref;

  const stripped = ref.startsWith("/") ? ref.slice(1) : ref;

  if (
    stripped.startsWith("scenarios/") ||
    stripped.startsWith("videos/") ||
    stripped.startsWith("personas/")
  ) {
    const clean = stripped.split("?")[0];
    return `/objects?key=${encodeURIComponent(clean)}`;
  }

  if (ref.startsWith("/objects/uploads/")) {
    return ref;
  }

  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidLike.test(ref)) {
    return `/api/objects/resolve?id=${encodeURIComponent(ref)}`;
  }

  if (ref.startsWith("/")) return ref;

  return `/objects?key=${encodeURIComponent(ref)}`;
}
