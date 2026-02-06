export function toMediaUrl(ref: string | null | undefined): string {
  if (!ref) return "";

  if (/^https?:\/\//i.test(ref)) return ref;

  if (ref.startsWith("/objects?key=")) return ref;

  if (
    ref.startsWith("scenarios/") ||
    ref.startsWith("videos/") ||
    ref.startsWith("personas/")
  ) {
    return `/objects?key=${encodeURIComponent(ref)}`;
  }

  if (ref.startsWith("/objects/uploads/")) {
    const id = ref.split("/objects/uploads/")[1];
    return `/api/objects/resolve?id=${encodeURIComponent(id)}`;
  }

  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidLike.test(ref)) {
    return `/api/objects/resolve?id=${encodeURIComponent(ref)}`;
  }

  if (ref.startsWith("/")) return ref;

  return `/objects?key=${encodeURIComponent(ref)}`;
}
