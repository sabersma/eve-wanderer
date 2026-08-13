import { MapData, useMapState } from '@/hooks/Mapper/components/map/MapProvider.tsx';
import { useEventBuffer } from '@/hooks/Mapper/hooks';
import { SolarSystemConnection, SolarSystemRawType } from '@/hooks/Mapper/types';
import { CommandInit } from '@/hooks/Mapper/types/mapHandlers.ts';
import { ViewMode } from '@/hooks/Mapper/mapRootProvider';
import { useCallback, useRef } from 'react';
import { useReactFlow } from 'reactflow';
import { convertConnection2Edge, convertSystem2Node } from '../../helpers';
import { LayoutPositions } from '../../helpers/layout';

export const useMapInit = (layoutPositions: LayoutPositions | null, viewMode: ViewMode) => {
  const rf = useReactFlow();
  const { data, update } = useMapState();

  const ref = useRef({ rf, data, update, layoutPositions, viewMode });
  ref.current = { update, data, rf, layoutPositions, viewMode };

  const updateSystems = useCallback((systems: SolarSystemRawType[]) => {
    const { rf, layoutPositions, viewMode } = ref.current;
    rf.setNodes(systems.map(convertSystem2Node));

    // In a home view, restore the per-view layout on top of the data
    // coordinates (init re-push resets nodes to shared coordinates).
    if (viewMode === 'home' && layoutPositions) {
      rf.setNodes(nodes =>
        nodes.map(n => {
          const pos = layoutPositions[n.id];
          return pos ? { ...n, position: pos } : n;
        }),
      );
    }
  }, []);

  const { handleEvent: handleUpdateSystems } = useEventBuffer<any>(updateSystems);

  const updateEdges = useCallback((connections: SolarSystemConnection[]) => {
    const { rf } = ref.current;
    rf.setEdges(connections.map(convertConnection2Edge));
  }, []);

  const { handleEvent: handleUpdateConnections } = useEventBuffer<any>(updateEdges);

  return useCallback(
    ({
      systems,
      system_signatures,
      kills,
      connections,
      wormholes,
      characters,
      user_characters,
      present_characters,
      hubs,
      options,
      user_permissions,
    }: CommandInit) => {
      const { update } = ref.current;

      const updateData: Partial<MapData> = {};

      if (wormholes) {
        updateData.wormholesData = wormholes.reduce((acc, x) => ({ ...acc, [x.name]: x }), {});
      }

      if (characters) {
        updateData.characters = characters.slice();
      }

      if (user_characters) {
        updateData.userCharacters = user_characters;
      }

      if (present_characters) {
        updateData.presentCharacters = present_characters;
      }

      if (hubs) {
        updateData.hubs = hubs;
      }

      if (options) {
        updateData.options = options;
      }

      if (options) {
        updateData.userPermissions = user_permissions;
      }

      if (systems) {
        updateData.systems = systems;
      }

      if (system_signatures) {
        updateData.systemSignatures = system_signatures;
      }

      if (kills) {
        updateData.kills = kills.reduce((acc, x) => ({ ...acc, [x.solar_system_id]: x.kills }), {});
      }

      update(updateData);

      if (systems) {
        handleUpdateSystems(systems);
        // rf.setNodes(systems.map(convertSystem2Node));
      }

      if (connections) {
        handleUpdateConnections(connections);
        // rf.setEdges(connections.map(convertConnection2Edge));
      }
    },
    [],
  );
};
