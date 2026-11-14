import { useCallback, useEffect, useRef, useState } from "react";
import { resolveApiErrorMessage } from "@/lib/apiError";
import {
  OperationsError,
  useOperationsRequest,
  useOnline,
  type WorkspaceIdentity,
} from "./workspace";

/** `OperationsError` messages are already public copy; anything else (a raw
 * "Failed to fetch", a parsing error) goes through the shared presentation. */
function operationsErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof OperationsError) return err.message;
  return resolveApiErrorMessage(err, fallback);
}

/** Each mounted branch owns requests, results and command keys. */
export function useOperationsPanel<T>(
  base: string,
  identity: WorkspaceIdentity,
  query = "",
) {
  const request = useOperationsRequest(base, identity);
  const online = useOnline();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const generation = useRef(0);
  const lock = useRef(false);
  const commands = useRef(new Map<string, string>());
  const load = useCallback(async () => {
    const revision = ++generation.current;
    setLoading(true);
    try {
      const result = await request<T>(query);
      if (alive.current && revision === generation.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (
        alive.current &&
        revision === generation.current &&
        !(e instanceof DOMException && e.name === "AbortError")
      )
        setError(operationsErrorMessage(e, "No pudimos cargar los datos."));
    } finally {
      if (alive.current && revision === generation.current) setLoading(false);
    }
  }, [request, query]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);
  const mutate = async (
    path: string,
    method: string,
    body: unknown,
    success: string,
  ): Promise<boolean> => {
    if (lock.current || !online) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const fingerprint = JSON.stringify([path, method, body]);
    let key = commands.current.get(fingerprint);
    if (!key) {
      key = crypto.randomUUID();
      commands.current.set(fingerprint, key);
    }
    try {
      await request(path, method, body, key);
      if (!alive.current) return false;
      commands.current.delete(fingerprint);
      setNotice(success);
      await load();
      return true;
    } catch (e) {
      if (alive.current) {
        if (e instanceof OperationsError && e.status === 409) await load();
        setError(operationsErrorMessage(e, "No pudimos guardar los cambios."));
      }
      return false;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return { data, request, load, mutate, error, notice, busy, loading, online };
}
