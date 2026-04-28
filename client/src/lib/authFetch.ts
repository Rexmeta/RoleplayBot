export function makeAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("authToken");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function authFetch(url: string): Promise<any> {
  const response = await fetch(url, {
    credentials: "include",
    headers: makeAuthHeaders(),
  });
  return response.json();
}

export async function authFetchRaw(
  url: string,
  options?: RequestInit
): Promise<Response> {
  const headers: Record<string, string> = {
    ...makeAuthHeaders(),
    ...(options?.headers as Record<string, string> | undefined),
  };
  return fetch(url, { credentials: "include", ...options, headers });
}
