import { OnMapAddSystemCallback } from '@/hooks/Mapper/components/map/map.types.ts';
import { recenterSystemsByBounds } from '@/hooks/Mapper/helpers/recenterSystems.ts';
import { OutCommand, OutCommandHandler, SolarSystemConnection, SolarSystemRawType } from '@/hooks/Mapper/types';
import { decodeUriBase64ToJson } from '@/hooks/Mapper/utils';
import { ctxManager } from '@/hooks/Mapper/utils/contextManager.ts';
import { ContextMenu } from 'primereact/contextmenu';
import React, { useCallback, useRef, useState } from 'react';
import { useReactFlow, XYPosition } from 'reactflow';
import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';
import { useToast } from '@/hooks/Mapper/ToastProvider.tsx';
import { findFreeSlot, occupancyOfNodes } from '@/hooks/Mapper/components/map/helpers/occupancy.ts';
import { getSystemById } from '@/hooks/Mapper/helpers';

export type PasteSystemsAndConnections = {
  systems: SolarSystemRawType[];
  connections: SolarSystemConnection[];
};

type UseContextMenuRootHandlers = {
  onAddSystem?: OnMapAddSystemCallback;
  onCommand?: OutCommandHandler;
  /**
   * Why adding a system is not currently possible, or null when it is. Set by
   * the subscription view's hide mode, which has nowhere on screen to put a
   * system that is not connected to a subscription.
   */
  addSystemBlockedReason?: string | null;
};

export const useContextMenuRootHandlers = ({
  onAddSystem,
  onCommand,
  addSystemBlockedReason = null,
}: UseContextMenuRootHandlers = {}) => {
  const rf = useReactFlow();
  const contextMenuRef = useRef<ContextMenu | null>(null);
  const [position, setPosition] = useState<XYPosition | null>(null);
  const [pasteSystemsAndConnections, setPasteSystemsAndConnections] = useState<PasteSystemsAndConnections>();

  const {
    data: { pendingMoveSystemId, systems },
    update,
  } = useMapRootState();
  const { show } = useToast();

  const handleRootContext = async (e: React.MouseEvent<HTMLDivElement>) => {
    setPosition(rf.project({ x: e.clientX, y: e.clientY }));
    e.preventDefault();
    ctxManager.next('ctxRoot', contextMenuRef.current);
    contextMenuRef.current?.show(e);

    try {
      const text = await navigator.clipboard.readText();
      const result = decodeUriBase64ToJson(text);
      setPasteSystemsAndConnections(result as PasteSystemsAndConnections);
    } catch (err) {
      setPasteSystemsAndConnections(undefined);
      // do nothing
    }
  };

  const ref = useRef({
    onAddSystem,
    position,
    pasteSystemsAndConnections,
    onCommand,
    pendingMoveSystemId,
    systems,
    update,
    show,
  });
  ref.current = {
    onAddSystem,
    position,
    pasteSystemsAndConnections,
    onCommand,
    pendingMoveSystemId,
    systems,
    update,
    show,
  };

  const onAddSystemCallback = useCallback(() => {
    ref.current.onAddSystem?.({ coordinates: position });
  }, [position]);

  const onPasteSystemsAnsConnections = useCallback(async () => {
    const { pasteSystemsAndConnections, onCommand, position } = ref.current;
    if (!position || !onCommand || !pasteSystemsAndConnections) {
      return;
    }

    const { systems } = recenterSystemsByBounds(pasteSystemsAndConnections.systems);

    await onCommand({
      type: OutCommand.manualPasteSystemsAndConnections,
      data: {
        systems: systems.map(({ position: srcPos, ...rest }) => ({
          position: { x: Math.round(srcPos.x + position.x), y: Math.round(srcPos.y + position.y) },
          ...rest,
        })),
        connections: pasteSystemsAndConnections.connections,
      },
    });
  }, []);

  // Second half of the two-phase move: the system to move was armed by the
  // system's own context menu, and this is the destination.
  const onMoveSystemHere = useCallback(async () => {
    const { pendingMoveSystemId, position, onCommand, systems, update, show } = ref.current;
    if (!pendingMoveSystemId || !position || !onCommand) {
      return;
    }

    // Snapped rather than dropped exactly where the user clicked: a free-hand
    // click almost never lands on the layout pitch, and an off-grid node overlaps
    // its neighbours and breaks the alignment of everything around it.
    // The node being moved is left out of the occupancy table, or it would
    // collide with its own current position.
    const nodes = rf.getNodes().map(n => ({ id: n.id, position: n.position, hidden: n.hidden }));
    const occ = occupancyOfNodes(nodes, new Set([pendingMoveSystemId]));
    const { position: snapped, ok } = findFreeSlot(occ, {
      x: Math.round(position.x),
      y: Math.round(position.y),
    });

    const name = getSystemById(systems, pendingMoveSystemId)?.name ?? pendingMoveSystemId;

    if (!ok) {
      // The slot was not free either: `findFreeSlot` returns a deterministic
      // overflow position rather than stacking. Say so, because the node will
      // land somewhere the user did not ask for.
      show({
        severity: 'warn',
        summary: 'No free space nearby',
        detail: `${name} was placed at the nearest free slot.`,
        life: 5000,
      });
    } else if (snapped.x !== Math.round(position.x) || snapped.y !== Math.round(position.y)) {
      show({
        severity: 'info',
        summary: 'Position occupied',
        detail: `${name} was moved to the nearest free slot.`,
        life: 4000,
      });
    }

    update({ pendingMoveSystemId: null });

    await onCommand({
      type: OutCommand.updateSystemPosition,
      data: { solar_system_id: pendingMoveSystemId, position: snapped },
    });
  }, [rf]);

  const onCancelMoveSystem = useCallback(() => {
    ref.current.update({ pendingMoveSystemId: null });
  }, []);

  return {
    handleRootContext,
    pasteSystemsAndConnections,
    contextMenuRef,
    onAddSystem: onAddSystemCallback,
    onPasteSystemsAnsConnections,
    onMoveSystemHere,
    onCancelMoveSystem,
    pendingMoveSystemId,
    addSystemBlockedReason,
  };
};
