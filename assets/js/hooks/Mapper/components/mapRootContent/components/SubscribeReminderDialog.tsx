import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';
import { Dialog } from 'primereact/dialog';
import { useEffect, useState } from 'react';
import { WdButton } from '@/hooks/Mapper/components/ui-kit';

/**
 * Reminder shown to normal (non admin/manager) users when they enter the map
 * before subscribing to any system. Points them to the top-right subscription
 * input (usually the mother-hole system id).
 */
export const SubscribeReminderDialog = () => {
  const {
    data: { userPermissions, subscribedSystemIds },
  } = useMapRootState();

  const [dismissed, setDismissed] = useState(false);

  const isGlobalAllowed = !!(userPermissions.admin_map || userPermissions.manage_map);
  const permissionsLoaded = Object.keys(userPermissions ?? {}).length > 0;
  const hasSubscription = subscribedSystemIds.length > 0;

  // Reset the dismissal whenever the subscription list changes so the reminder
  // can show again if the user unsubscribes everything.
  useEffect(() => {
    setDismissed(false);
  }, [subscribedSystemIds.length]);

  const visible = permissionsLoaded && !isGlobalAllowed && !hasSubscription && !dismissed;

  return (
    <Dialog
      header={
        <div className="dialog-header">
          <span className="pointer-events-none">订阅提醒</span>
        </div>
      }
      draggable={false}
      resizable={false}
      closable={false}
      visible={visible}
      onHide={() => setDismissed(true)}
      className="w-[460px] text-text-color"
      footer={
        <div className="flex items-center justify-end">
          <WdButton onClick={() => setDismissed(true)} size="small" label="知道了" />
        </div>
      }
    >
      <div className="w-full flex flex-col gap-2 text-stone-300 text-[14px]">
        <span>进入地图前，请先在右上角订阅星系（通常为母洞星系编号）。</span>
        <span className="text-stone-500 text-[13px]">订阅后即可查看对应星系及其路径。</span>
      </div>
    </Dialog>
  );
};
