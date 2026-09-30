import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "./workspace";

/**
 * 已保存会话（我们自己的实现）。
 *
 * 上游用 CopilotKit 的 useThreads：列表/改名/归档都打云上的富线程接口，本地运行时上必然
 * 报 "Thread mutations are not available"。这里换成打我们自己的 /api/threads，
 * 返回结构刻意与 useThreads 对齐（threads / isLoading / error / renameThread …），
 * 界面代码只要换 hook 名。
 */
export type SavedThread = {
  id: string;
  name: string;
  archived: boolean;
  agentId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export function useSavedThreads({ enabled }: { enabled: boolean }) {
  const { api } = useWorkspace();
  const [threads, setThreads] = useState<SavedThread[]>([]);
  const [isLoading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  const [isMutating, setMutating] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await api.request<{ threads: SavedThread[] }>("/api/threads");
      setThreads(result.threads ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [api, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    async (path: string, body: unknown, method: string) => {
      setMutating(true);
      try {
        await api.request(path, body, method);
        await load();
      } finally {
        setMutating(false);
      }
    },
    [api, load],
  );

  return {
    threads,
    isLoading,
    error,
    isMutating,
    refetchThreads: () => void load(),
    renameThread: (id: string, name: string) =>
      mutate(`/api/threads/${encodeURIComponent(id)}`, { name }, "PATCH"),
    archiveThread: (id: string) =>
      mutate(`/api/threads/${encodeURIComponent(id)}/archive`, {}, "POST"),
    unarchiveThread: (id: string) =>
      mutate(`/api/threads/${encodeURIComponent(id)}/unarchive`, {}, "POST"),
    deleteThread: (id: string) =>
      mutate(`/api/threads/${encodeURIComponent(id)}`, undefined, "DELETE"),
    // 服务端一次返回全部会话，没有分页
    hasMoreThreads: false,
    isFetchingMoreThreads: false,
    fetchMoreError: null as Error | null,
    fetchMoreThreads: () => {},
  };
}
