const API_BASE = "http://localhost:5001/api";

export function getToken(): string | null {
  return localStorage.getItem("cc_token");
}

export async function apiFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Don't set Content-Type for FormData (browser will set it with boundary)
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    localStorage.removeItem("cc_token");
    // Redirect to landing
    if (window.location.pathname !== "/") {
      window.location.href = "/";
    }
  }

  return res;
}

export async function apiGet<T>(endpoint: string): Promise<T> {
  const res = await apiFetch(endpoint);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export async function apiPost<T>(
  endpoint: string,
  body: unknown
): Promise<T> {
  const isFormData = body instanceof FormData;
  const res = await apiFetch(endpoint, {
    method: "POST",
    body: isFormData ? (body as FormData) : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export async function apiPut<T>(
  endpoint: string,
  body: unknown
): Promise<T> {
  const isFormData = body instanceof FormData;
  const res = await apiFetch(endpoint, {
    method: "PUT",
    body: isFormData ? (body as FormData) : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export const UPLOADS_BASE = "http://localhost:5001";
