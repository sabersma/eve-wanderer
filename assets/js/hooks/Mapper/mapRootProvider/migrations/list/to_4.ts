import { MigrationStructure } from '@/hooks/Mapper/mapRootProvider/types.ts';
import { DEFAULT_WIDGETS } from '@/hooks/Mapper/components/mapInterface/constants.tsx';

// v4 adds the J-Space widget. Windows are stored per map, so a settings blob
// written before the widget existed has no window descriptor for it and the
// widget would be impossible to enable. Append every missing default window;
// visibility stays untouched, so new widgets still start hidden.
export const to_4: MigrationStructure = {
  to: 4,
  up: (prev: any) => {
    const widgets = prev?.widgets;

    if (!widgets || !Array.isArray(widgets.windows)) {
      return prev;
    }

    const storedIds = new Set(widgets.windows.map((window: any) => window.id));

    // Drop `content` (a component factory), the same shape useStoreWidgets
    // persists.
    const missing = DEFAULT_WIDGETS.filter(({ id }) => !storedIds.has(id)).map(({ id, position, size, zIndex }) => ({
      id,
      position,
      size,
      zIndex,
    }));

    if (missing.length === 0) {
      return prev;
    }

    return {
      ...prev,
      widgets: {
        ...widgets,
        windows: [...widgets.windows, ...missing],
      },
    };
  },
};
