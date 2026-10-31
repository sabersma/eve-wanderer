import { useCallback, useEffect, useRef, useState } from 'react';
import { Commands, OutCommand, SystemSignature } from '@/hooks/Mapper/types';
import { useMapEventListener } from '@/hooks/Mapper/events';
import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';

type SignaturesResponse = {
  signatures?: SystemSignature[];
};

/**
 * Loads the full signature list of one system. This mirrors the signature
 * widget's fetch instead of reading `data.systemSignatures`: that map-level
 * cache is filtered to wormholes for the map overlay, while the comparison
 * needs every group (gas, ore, relic, data, combat, ...).
 */
export function useComparedSignatures(systemId?: string) {
  const { outCommand } = useMapRootState();
  const [signatures, setSignatures] = useState<SystemSignature[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!systemId) {
      requestIdRef.current += 1;
      setSignatures([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const response = await outCommand<SignaturesResponse>({
        type: OutCommand.getSignatures,
        data: { system_id: systemId },
      });

      if (requestId !== requestIdRef.current) {
        return;
      }

      setSignatures((response?.signatures ?? []).filter(signature => !signature.deleted));
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      console.error('[useComparedSignatures] Failed to load signatures:', err);
      setSignatures([]);
      setError('加载信号失败');
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [outCommand, systemId]);

  useEffect(() => {
    void load();
  }, [load]);

  useMapEventListener(event => {
    if (event.name === Commands.signaturesUpdated && String(event.data) === String(systemId)) {
      void load();
      return true;
    }
  });

  return { signatures, isLoading, error, reload: load };
}
