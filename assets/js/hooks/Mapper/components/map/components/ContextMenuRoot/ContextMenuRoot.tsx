import React, { RefObject, useMemo } from 'react';
import { ContextMenu } from 'primereact/contextmenu';
import { PrimeIcons } from 'primereact/api';
import { MenuItem } from 'primereact/menuitem';
import { PasteSystemsAndConnections } from '@/hooks/Mapper/components/map/components';
import { useMapState } from '@/hooks/Mapper/components/map/MapProvider.tsx';
import { checkPermissions } from '@/hooks/Mapper/components/map/helpers';
import { MenuItemWithInfo, WdMenuItem } from '@/hooks/Mapper/components/ui-kit';
import clsx from 'clsx';

export interface ContextMenuRootProps {
  contextMenuRef: RefObject<ContextMenu>;
  pasteSystemsAndConnections: PasteSystemsAndConnections | undefined;
  onAddSystem(): void;
  onPasteSystemsAnsConnections(): void;
  addSystemBlockedReason?: string | null;
  /** The system awaiting a destination, or null when no move is in progress. */
  pendingMoveSystemId?: string | null;
  onMoveSystemHere(): void;
  onCancelMoveSystem(): void;
}

export const ContextMenuRoot: React.FC<ContextMenuRootProps> = ({
  contextMenuRef,
  onAddSystem,
  onPasteSystemsAnsConnections,
  pasteSystemsAndConnections,
  addSystemBlockedReason = null,
  pendingMoveSystemId = null,
  onMoveSystemHere,
  onCancelMoveSystem,
}) => {
  const {
    data: { options, userPermissions, systems },
  } = useMapState();

  const items: MenuItem[] = useMemo(() => {
    const allowPaste = checkPermissions(userPermissions, options.allowed_paste_for);
    const movingSystemName = pendingMoveSystemId
      ? (systems.find(x => x.id === pendingMoveSystemId)?.name ?? pendingMoveSystemId)
      : null;

    return [
      ...(pendingMoveSystemId != null
        ? [
            {
              // Named, not just "Move System here": with the destination menu
              // open it has to be obvious *which* system is about to move.
              label: `Move ${movingSystemName} here`,
              icon: PrimeIcons.ARROWS_H,
              command: onMoveSystemHere,
            },
            {
              label: 'Cancel Move',
              icon: PrimeIcons.TIMES,
              command: onCancelMoveSystem,
            },
            { separator: true },
          ]
        : []),
      ...(addSystemBlockedReason != null
        ? [
            {
              // Shown rather than removed: a menu item that silently disappears
              // reads as a bug, and the reason tells the user how to get it back.
              command: undefined,
              template: () => (
                <MenuItemWithInfo
                  infoTitle={addSystemBlockedReason}
                  infoClass={clsx(PrimeIcons.QUESTION_CIRCLE, 'text-stone-500 mr-[12px]')}
                  tooltipWrapperClassName="flex"
                >
                  <WdMenuItem disabled icon={PrimeIcons.PLUS}>
                    Add System
                  </WdMenuItem>
                </MenuItemWithInfo>
              ),
            },
          ]
        : [
            {
              label: 'Add System',
              icon: PrimeIcons.PLUS,
              command: onAddSystem,
            },
          ]),
      ...(pasteSystemsAndConnections != null
        ? [
            {
              icon: 'pi pi-clipboard',
              disabled: !allowPaste,
              command: onPasteSystemsAnsConnections,
              template: () => {
                if (allowPaste) {
                  return (
                    <WdMenuItem icon="pi pi-clipboard">
                      Paste
                    </WdMenuItem>
                  );
                }

                return (
                  <MenuItemWithInfo
                    infoTitle="Action is blocked because you don’t have permission to Paste."
                    infoClass={clsx(PrimeIcons.QUESTION_CIRCLE, 'text-stone-500 mr-[12px]')}
                    tooltipWrapperClassName="flex"
                  >
                    <WdMenuItem disabled icon="pi pi-clipboard">
                      Paste
                    </WdMenuItem>
                  </MenuItemWithInfo>
                );
              },
            },
          ]
        : []),
    ];
  }, [
    userPermissions,
    options,
    systems,
    onAddSystem,
    pasteSystemsAndConnections,
    onPasteSystemsAnsConnections,
    addSystemBlockedReason,
    pendingMoveSystemId,
    onMoveSystemHere,
    onCancelMoveSystem,
  ]);

  return (
    <>
      <ContextMenu model={items} ref={contextMenuRef} breakpoint="767px" />
    </>
  );
};
