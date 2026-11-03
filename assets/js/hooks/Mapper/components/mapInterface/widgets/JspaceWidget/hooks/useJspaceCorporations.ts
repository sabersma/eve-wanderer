import { useCallback, useEffect, useRef, useState } from 'react';
import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';
import { OutCommand } from '@/hooks/Mapper/types';
import { JspaceCorporationsResponse } from '@/hooks/Mapper/components/mapInterface/widgets/JspaceWidget/types.ts';

// The widget shows three rows until the user expands it; five keeps one
// expansion click useful without making the integration request expensive.
const LIMIT = 5;

const ERROR_MESSAGES: Record<string, string> = {
  jspace_not_configured: 'J-Space Helper is not configured on this server',
  jspace_unavailable: 'J-Space Helper is unavailable',
  jspace_timeout: 'J-Space Helper did not respond in time',
  unknown_system: 'Unknown solar system',
};

export function errorMessage(code: string) {
  return ERROR_MESSAGES[code] ?? 'Failed to load J-Space data';
}

interface UseJspaceCorporationsProps {
  systemId?: string;
  enabled: boolean;
}

/**
 * Loads the top corporations by active days for one system through the map's
 * LiveView command channel. The browser never talks to J-Space Helper directly:
 * the server holds the shared token and caches the answer.
 */
export function useJspaceCorporations({ systemId, enabled }: UseJspaceCorporationsProps) {
  const { outCommand } = useMapRootState();
  const [data, setData] = useState<JspaceCorporationsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!systemId || !enabled) {
      requestIdRef.current += 1;
      setData(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const response = await outCommand<JspaceCorporationsResponse>({
        type: OutCommand.getJspaceCorporations,
        data: { system_id: Number(systemId), limit: LIMIT },
      });

      // A slower earlier request must not overwrite a newer system's answer.
      if (requestId !== requestIdRef.current) return;

      if (response?.error) {
        setData(null);
        setError(errorMessage(response.error));
        return;
      }

      setData(response ?? null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error('[useJspaceCorporations] Failed to load J-Space data:', err);
      setData(null);
      setError('Failed to load J-Space data');
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [outCommand, systemId, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, isLoading, error, reload: load };
}
