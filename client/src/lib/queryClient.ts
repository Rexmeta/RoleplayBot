import { QueryClient, QueryCache, MutationCache, QueryFunction } from "@tanstack/react-query";

// Central 401 handler — clears auth state and redirects to login
function handle401(): void {
  localStorage.removeItem("authToken");
  if (window.location.pathname !== "/auth") {
    window.location.href = "/auth";
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    const isHtml = text.trim().startsWith('<');
    if (isHtml) {
      throw new Error(`서버에 연결할 수 없습니다 (${res.status}). 잠시 후 다시 시도해주세요.`);
    }
    throw new Error(`${res.status}: ${text}`);
  }
}

/**
 * SSE 스트리밍 요청 — AI 생성처럼 오래 걸리는 작업에 사용.
 * 서버는 5초마다 heartbeat를 보내 프록시 연결을 유지하고, 완료 시 결과를 전송한다.
 */
export async function streamApiRequest(
  url: string,
  data?: unknown
): Promise<Record<string, any>> {
  const token = localStorage.getItem("authToken");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  if (!response.ok || !response.body) {
    const text = (await response.text()) || response.statusText;
    const isHtml = text.trim().startsWith("<");
    throw new Error(
      isHtml
        ? `서버에 연결할 수 없습니다 (${response.status}). 잠시 후 다시 시도해주세요.`
        : `${response.status}: ${text}`
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (!raw) continue;
      let payload: any;
      try { payload = JSON.parse(raw); } catch { continue; }
      if (payload.type === "heartbeat") continue;
      if (payload.type === "error") throw new Error(payload.message || "AI 생성 실패");
      if (payload.type === "result") return payload;
    }
  }
  throw new Error("AI 생성 응답이 올바르지 않습니다");
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const token = localStorage.getItem("authToken");
  const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  // Handle 401 from mutations: clear token and redirect before throwing
  if (res.status === 401) {
    handle401();
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const token = localStorage.getItem("authToken");
    const headers: Record<string, string> = {};

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(queryKey.join("/") as string, {
      headers,
      credentials: "include",
    });

    if (res.status === 401) {
      if (unauthorizedBehavior === "returnNull") {
        // If the user had a token that the server now rejects, the session
        // expired mid-use — redirect to login. If there was no token, the
        // ProtectedRouter will handle the unauthenticated state silently.
        if (token) {
          handle401();
        }
        return null;
      }
      // "throw" behavior: redirect + throw typed error for QueryCache.onError
      handle401();
      const text = (await res.text()) || res.statusText;
      throw new Error(`401: ${text}`);
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

function is401Error(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("401:");
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    // Safety net: catch any thrown 401 errors that may come from custom queryFns
    onError: (error) => {
      if (is401Error(error)) {
        handle401();
      }
    },
  }),
  mutationCache: new MutationCache({
    // Safety net: catch 401 errors thrown by apiRequest in mutation handlers
    onError: (error) => {
      if (is401Error(error)) {
        handle401();
      }
    },
  }),
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
