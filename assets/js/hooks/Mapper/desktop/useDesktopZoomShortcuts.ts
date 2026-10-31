import { useEffect } from 'react';
import { zoomIn, zoomOut, zoomReset } from './bridge';

/**
 * Ctrl+= / Ctrl+- / Ctrl+0 in every desktop window.
 *
 * These used to be native menu accelerators. The menu is now reduced to
 * 「服务器设置…」 so zoom controls appear only in the main map bar, which means
 * the page has to handle the same keys — detached windows zoom with them
 * because they have no visible zoom UI at all.
 */
export function useDesktopZoomShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || !(event.ctrlKey || event.metaKey)) {
        return;
      }

      if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        void zoomIn();
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        void zoomOut();
      } else if (event.key === '0') {
        event.preventDefault();
        void zoomReset();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
