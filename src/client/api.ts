import * as React from 'react';
import { API, type Conversation } from '../model.js';

export function endpoint(parent: string, id?: string, operation?: string): string {
  return `${API}${id ? `/${id}` : ''}${operation ? `/${operation}` : ''}?parent=${encodeURIComponent(parent)}`;
}

export async function request<T>(url: string, signal?: AbortSignal, body?: unknown): Promise<T | undefined> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST', signal, credentials: 'same-origin', cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (response.status === 204) {
    return undefined;
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('子智能体面板未在宿主激活，请检查插件加载状态。');
  }
  const value = await response.json() as T & { error?: string };
  if (!response.ok) {
    throw new Error(value.error || `请求失败：${response.status}`);
  }
  return value;
}

export function usePolling<T>(url: string): { value?: T; error?: string; refresh(): void } {
  const [state, setState] = React.useState<{ url: string; value?: T; error?: string }>({ url });
  const [attempt, retry] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let current: T | undefined;
    const poll = async () => {
      try {
        const revision = (current as Conversation | undefined)?.revision;
        const value = await request<T>(`${url}${revision === undefined ? '' : `&revision=${revision}`}`, abort.signal);
        if (!abort.signal.aborted) {
          current = value ?? current;
          setState({ url, value: current });
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          setState({ url, value: current, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (!abort.signal.aborted) {
        timer = setTimeout(() => { void poll(); }, document.hidden ? 5000 : 750);
      }
    };
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [url, attempt]);
  return { ...(state.url === url ? state : {}), refresh: () => { retry(); } };
}

export function resource(parent: string, id = 'list', title = '外部子智能体'): string {
  return `dsh-resource://external-subagent/session/${encodeURIComponent(parent)}/${id}?title=${encodeURIComponent(title)}`;
}

export function parseResource(address: string): { parent: string; id: string; title: string } | undefined {
  try {
    const url = new URL(address);
    const parts = url.pathname.split('/');
    if (url.protocol !== 'dsh-resource:' || url.hostname !== 'external-subagent' || parts.length !== 4 || parts[1] !== 'session' || !parts[2] || !/^(list|[a-f0-9-]{36})$/.test(parts[3])) {
      return undefined;
    }
    return { parent: decodeURIComponent(parts[2]), id: parts[3], title: url.searchParams.get('title') || '外部子智能体' };
  } catch {
    return undefined;
  }
}
