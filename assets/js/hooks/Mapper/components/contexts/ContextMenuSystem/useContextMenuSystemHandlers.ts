import { useCallback, useRef, useState } from 'react';
import { ContextMenu } from 'primereact/contextmenu';
import { OutCommand, OutCommandHandler } from '@/hooks/Mapper/types/mapHandlers.ts';
import { Commands } from '@/hooks/Mapper/types/mapHandlers.ts';
import { SolarSystemRawType } from '@/hooks/Mapper/types';
import { WaypointSetContextHandler } from '@/hooks/Mapper/components/contexts/types.ts';
import { ctxManager } from '@/hooks/Mapper/utils/contextManager.ts';
import { useDeleteSystems } from '@/hooks/Mapper/components/contexts/hooks';
import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';
import { emitMapEvent } from '@/hooks/Mapper/events';
import { findConnectedComponent } from '@/hooks/Mapper/helpers/graph.ts';
import { useToast } from '@/hooks/Mapper/ToastProvider.tsx';
// import { PingType } from '@/hooks/Mapper/types/ping.ts';

interface UseContextMenuSystemHandlersProps {
  hubs: string[];
  userHubs: string[];
  systems: SolarSystemRawType[];
  outCommand: OutCommandHandler;
  /**
   * Systems currently on screen. A cluster selection is bounded by what the
   * user can see, so a hidden system is neither selected nor traversed through.
   */
  visibleSystemIds: Set<string>;
}

export const useContextMenuSystemHandlers = ({
  systems,
  hubs,
  userHubs,
  outCommand,
  visibleSystemIds,
}: UseContextMenuSystemHandlersProps) => {
  const contextMenuRef = useRef<ContextMenu | null>(null);

  const [system, setSystem] = useState<string>();

  const { deleteSystems } = useDeleteSystems();
  const {
    data: { connections, pendingMoveSystemId },
    update,
  } = useMapRootState();
  const { show } = useToast();

  const ref = useRef({
    hubs,
    userHubs,
    system,
    systems,
    outCommand,
    deleteSystems,
    connections,
    visibleSystemIds,
    pendingMoveSystemId,
    update,
    show,
  });
  ref.current = {
    hubs,
    userHubs,
    system,
    systems,
    outCommand,
    deleteSystems,
    connections,
    visibleSystemIds,
    pendingMoveSystemId,
    update,
    show,
  };

  const open = useCallback((ev: any, systemId: string) => {
    setSystem(systemId);
    ev.preventDefault();
    ctxManager.next('ctxSys', contextMenuRef.current);
    contextMenuRef.current?.show(ev);
  }, []);

  const onDeleteSystem = useCallback(() => {
    const { system, deleteSystems } = ref.current;
    if (!system) {
      return;
    }

    deleteSystems([system]);
    setSystem(undefined);
  }, []);

  const onLockToggle = useCallback(() => {
    const { system, systems, outCommand } = ref.current;
    if (!system) {
      return;
    }

    const sysInfo = systems.find(x => x.id === system)!;

    outCommand({
      type: OutCommand.updateSystemLocked,
      data: {
        system_id: system,
        value: !sysInfo.locked,
      },
    });
    setSystem(undefined);
  }, []);

  const onHubToggle = useCallback(() => {
    const { hubs, system, outCommand } = ref.current;
    if (!system) {
      return;
    }

    outCommand({
      type: !hubs.includes(system) ? OutCommand.addHub : OutCommand.deleteHub,
      data: {
        system_id: system,
      },
    });
    setSystem(undefined);
  }, []);

  const onUserHubToggle = useCallback(() => {
    const { userHubs, system, outCommand } = ref.current;
    if (!system) {
      return;
    }

    outCommand({
      type: !userHubs.includes(system) ? OutCommand.addUserHub : OutCommand.deleteUserHub,
      data: {
        system_id: system,
      },
    });
    setSystem(undefined);
  }, []);

  // const onTogglePingRally = useCallback(() => {
  //   const { userHubs, system, outCommand } = ref.current;
  //   if (!system) {
  //     return;
  //   }
  //
  //   outCommand({
  //     type: OutCommand.openPing,
  //     data: {
  //       solar_system_id: system,
  //       type: PingType.Rally,
  //     },
  //   });
  //   setSystem(undefined);
  // }, []);

  const onSystemTag = useCallback((tag?: string) => {
    const { system, outCommand } = ref.current;
    if (!system) {
      return;
    }

    outCommand({
      type: OutCommand.updateSystemTag,
      data: {
        system_id: system,
        value: tag ?? '',
      },
    });
    setSystem(undefined);
  }, []);

  const onSystemTemporaryName = useCallback((temporaryName?: string) => {
    const { system, outCommand } = ref.current;
    if (!system) {
      return;
    }

    outCommand({
      type: OutCommand.updateSystemTemporaryName,
      data: {
        system_id: system,
        value: temporaryName ?? '',
      },
    });
    setSystem(undefined);
  }, []);

  const onSystemStatus = useCallback((status: number) => {
    const { system, outCommand } = ref.current;
    if (!system) {
      return;
    }

    outCommand({
      type: OutCommand.updateSystemStatus,
      data: {
        system_id: system,
        value: status,
      },
    });
    setSystem(undefined);
  }, []);

  const onSystemLabels = useCallback((labels: string) => {
    const { system, outCommand } = ref.current;
    if (!system) {
      return;
    }

    outCommand({
      type: OutCommand.updateSystemLabels,
      data: {
        system_id: system,
        value: labels,
      },
    });
    setSystem(undefined);
  }, []);

  const onOpenSettings = useCallback(() => {
    const { system, outCommand } = ref.current;
    if (!system) {
      return;
    }

    outCommand({
      type: OutCommand.openSettings,
      data: {
        system_id: system,
      },
    });
    setSystem(undefined);
  }, []);

  const onWaypointSet: WaypointSetContextHandler = useCallback(({ charIds, clearWay, fromBeginning, destination }) => {
    const { system, outCommand } = ref.current;
    if (!system) {
      return;
    }

    outCommand({
      type: OutCommand.setAutopilotWaypoint,
      data: {
        character_eve_ids: charIds,
        add_to_beginning: fromBeginning,
        clear_other_waypoints: clearWay,
        destination_id: destination,
      },
    });
    setSystem(undefined);
  }, []);

  const onRearrange = useCallback(() => {
    const { system, outCommand } = ref.current;
    if (!system) {
      return;
    }

    outCommand({
      type: OutCommand.rearrangeSystems,
      data: {
        solar_system_id: system,
      },
    });
    setSystem(undefined);
  }, []);

  const onAddSignature = useCallback(() => {
    const { system, outCommand } = ref.current;
    if (!system) {
      return;
    }

    outCommand({
      type: OutCommand.addSignature,
      data: {
        system_id: system,
      },
    });
    setSystem(undefined);
  }, []);

  // Two-phase move: this only arms the move. The destination comes from the
  // canvas context menu, which knows where the user right-clicked.
  const onMoveSystem = useCallback(() => {
    const { system, pendingMoveSystemId, update } = ref.current;
    if (!system) {
      return;
    }

    // Clicking the item again on the same system cancels, which gives the user a
    // way out without having to remember Escape.
    update({ pendingMoveSystemId: pendingMoveSystemId === system ? null : system });
    setSystem(undefined);
  }, []);

  const onSelectCluster = useCallback(() => {
    const { system, connections, visibleSystemIds, show } = ref.current;
    if (!system) {
      return;
    }

    // Locked systems are selected along with the rest of the cluster. The lock
    // means "do not move this", and reactflow enforces exactly that on its own:
    // its drag only picks up nodes that are draggable, so a locked node inside
    // the selection stays put while the others follow the pointer. Treating the
    // lock as a selection boundary instead made the whole item useless — it
    // returned an empty component and did nothing at all whenever the system
    // clicked was locked, which is the common case in practice (the
    // `map_system_v1.locked` column defaulted to true until migration
    // 20240613133932 and existing rows were never backfilled).
    const component = findConnectedComponent(system, connections, visibleSystemIds);

    // Defensive: the menu only opens on a node reactflow has rendered, and it
    // renders nothing for a hidden node, so the clicked system is always in
    // `visibleSystemIds` and the component always holds at least it. Reported
    // rather than swallowed, because a selection that silently does nothing is
    // indistinguishable from a broken menu item.
    if (component.size === 0) {
      show({
        severity: 'warn',
        summary: 'Nothing selected',
        detail: 'The system is no longer part of the visible map. Try again after the map has updated.',
      });
      setSystem(undefined);
      return;
    }

    emitMapEvent({ name: Commands.selectSystems, data: { systems: [...component] } });
    setSystem(undefined);
  }, []);

  return {
    open,

    contextMenuRef,
    onDeleteSystem,
    onLockToggle,
    onHubToggle,
    onUserHubToggle,
    // onTogglePingRally,
    onSystemTag,
    onSystemTemporaryName,
    onSystemStatus,
    onSystemLabels,
    onOpenSettings,
    onWaypointSet,
    onRearrange,
    onAddSignature,
    onMoveSystem,
    onSelectCluster,
    systemId: system,
  };
};
