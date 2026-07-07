import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export function useApiQuery<T>(queryKey: string[], path: string) {
  return useQuery<T>({
    queryKey,
    queryFn: () => apiFetch<T>(path),
  });
}

export function useApiPost<T, B = void>(path: string, invalidateKeys?: string[][]) {
  const queryClient = useQueryClient();
  return useMutation<T, Error, B>({
    mutationFn: (body) => apiFetch<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    onSuccess: () => {
      if (invalidateKeys) {
        for (const key of invalidateKeys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
      }
    },
  });
}

export function useApiDelete(path: string, invalidateKeys?: string[][]) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiFetch<void>(path.replace(":id", id), { method: "DELETE" }),
    onSuccess: () => {
      if (invalidateKeys) {
        for (const key of invalidateKeys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
      }
    },
  });
}
