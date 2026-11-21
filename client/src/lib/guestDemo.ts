export class GuestDemoError extends Error {
  constructor(readonly code: string) { super(code); }
}

export async function guestDemoRequest<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    ...(body === undefined ? {} : {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new GuestDemoError(typeof data?.code === "string" ? data.code : "guest_unavailable");
  }
  return data;
}
