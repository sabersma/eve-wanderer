import { useToast } from '@/hooks/Mapper/ToastProvider';
import { CommandMapError } from '@/hooks/Mapper/types';
import { useCallback } from 'react';

/**
 * Surfaces a refusal from the server on an action that has no reply channel.
 * Without this the request just looks like it did nothing.
 */
export const useCommandMapError = () => {
  const { show } = useToast();

  const mapError = useCallback(
    ({ message }: CommandMapError) => {
      show({
        severity: 'warn',
        summary: 'Action not allowed',
        detail: message,
        life: 5000,
      });
    },
    [show],
  );

  return { mapError };
};
