import { Node, useReactFlow } from 'reactflow';
import { useCallback, useRef } from 'react';
import { CommandUpdateSystems } from '@/hooks/Mapper/types/mapHandlers.ts';
import { ViewMode } from '@/hooks/Mapper/mapRootProvider';
import { convertSystem2Node } from '../../helpers/index.ts';
import { useMapState } from '@/hooks/Mapper/components/map/MapProvider.tsx';

export const useMapUpdateSystems = (viewMode: ViewMode) => {
  const rf = useReactFlow();

  const {
    update,
    data: { systems },
  } = useMapState();

  const ref = useRef({ systems, update, viewMode });
  ref.current = { systems, update, viewMode };

  return useCallback(
    (systems: CommandUpdateSystems) => {
      const { viewMode: currentViewMode } = ref.current;
      const nodes = rf.getNodes();
      const prepared: Node[] = nodes.map(node => {
        const system = systems.find(s => s.id === node.id);

        if (!system) {
          return node;
        }

        // In a home view, nodes are placed by the per-view local layout, not
        // the shared data coordinates. Only update the data and the
        // draggable/deletable flags (which depend on `locked`), but keep the
        // node's position so a label/lock change does not yank it back.
        if (currentViewMode === 'home') {
          return { ...node, data: system, draggable: !system.locked, deletable: !system.locked };
        }

        return {
          ...node,
          ...convertSystem2Node(system),
        };
      });

      rf.setNodes(prepared);

      const out = ref.current.systems.map(current => {
        const newSystem = systems.find(x => current.id === x.id);
        if (!newSystem) {
          return current;
        }

        return newSystem;
      });

      update({ systems: out }, true);
    },
    [rf, update],
  );
};
