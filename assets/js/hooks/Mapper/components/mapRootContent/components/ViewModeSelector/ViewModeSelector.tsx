import { useCallback, useMemo, useRef, useState } from 'react';
import { OverlayPanel } from 'primereact/overlaypanel';
import { ConfirmPopup } from 'primereact/confirmpopup';
import { useMapRootState, ViewMode } from '@/hooks/Mapper/mapRootProvider';
import { OutCommand } from '@/hooks/Mapper/types';
import { Commands } from '@/hooks/Mapper/types/mapHandlers.ts';
import { emitMapEvent } from '@/hooks/Mapper/events';

import classes from './ViewModeSelector.module.scss';

interface SearchResult {
  label: string;
  value: number;
}

/**
 * Past this many subscriptions the chips stop fitting across the top bar and
 * would wrap into the map, so they collapse into a dropdown instead.
 */
const SUBSCRIPTION_CHIP_LIMIT = 3;

/**
 * Subscription manager replacing the old all/home toggle.
 *
 * - admin/manager keep a "全局 / 订阅" toggle (global view + unlimited subs).
 * - member/viewer only get the subscription view: type a system name/code to
 *   subscribe, click a chip to focus its system, × to unsubscribe.
 */
export const ViewModeSelector = () => {
  const { data, update, outCommand } = useMapRootState();
  const {
    viewMode,
    subscribedSystemIds,
    subscribedSystems,
    subscriptionLimit,
    systems,
    userPermissions,
    userRemoteSettings,
  } = data;

  const isGlobalAllowed = userPermissions.admin_map || userPermissions.manage_map;

  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pendingUnsubscribe, setPendingUnsubscribe] = useState<{ id: string; target: HTMLElement } | null>(null);
  const subscriptionPanelRef = useRef<OverlayPanel>(null);

  // A subscribed system is not necessarily on the map: subscribing adds it, but
  // that is asynchronous and can fail. When it is absent there is no map record
  // to read a name from, so the server sends the name it resolved for every
  // subscribed id (`subscribedSystems`). Without that fallback the chip would
  // show the raw numeric id (e.g. "30000142") instead of the system's J-code.
  const subscribedNames = useMemo(() => {
    const serverNames = new Map(subscribedSystems.map(x => [x.id, x.name]));

    return subscribedSystemIds.map(id => {
      const s = systems.find(x => x.id === id);

      return {
        id,
        // `name` on a map system is the user's alias when they set one, and the
        // J-code otherwise.
        name: s?.name ?? s?.system_static_info?.solar_system_name ?? serverNames.get(id) ?? id,
      };
    });
  }, [subscribedSystemIds, subscribedSystems, systems]);

  const limitReached = subscriptionLimit != null && subscribedSystemIds.length >= subscriptionLimit;
  const collapsed = subscribedNames.length > SUBSCRIPTION_CHIP_LIMIT;

  const handleSearch = useCallback(
    async (text: string) => {
      setSearchText(text);
      if (!text.trim()) {
        setResults([]);
        return;
      }

      const reply = (await outCommand({
        type: OutCommand.searchSystems,
        data: { text: text.trim() },
      })) as { systems?: SearchResult[] } | undefined;

      setResults((reply?.systems ?? []).slice(0, 20));
    },
    [outCommand],
  );

  const handleAdd = useCallback(
    async (value: number) => {
      const id = value.toString();
      if (subscribedSystemIds.includes(id) || limitReached) return;

      await outCommand({
        type: OutCommand.updateSubscriptions,
        data: { system_ids: [...subscribedSystemIds, id] },
      });

      setSearchText('');
      setResults([]);
    },
    [outCommand, subscribedSystemIds, limitReached],
  );

  const handleRemove = useCallback(
    async (id: string) => {
      await outCommand({
        type: OutCommand.updateSubscriptions,
        data: { system_ids: subscribedSystemIds.filter(x => x !== id) },
      });
    },
    [outCommand, subscribedSystemIds],
  );

  const handleFocus = useCallback((id: string) => {
    emitMapEvent({ name: Commands.centerSystem, data: id });
  }, []);

  // Unsubscribing is cheap to undo but easy to hit by accident — the chips sit
  // next to each other and the × is small — so it asks once before removing.
  const askRemove = useCallback((event: React.MouseEvent<HTMLButtonElement>, id: string) => {
    event.stopPropagation();
    setPendingUnsubscribe({ id, target: event.currentTarget });
  }, []);

  const handleViewMode = useCallback((mode: ViewMode) => update({ viewMode: mode }), [update]);

  // Scope of the subscription view: show every cluster the user can see, or
  // only the ones reachable from a subscription. This is a per-user server
  // setting (`hide_unsubscribed_clusters`), so it is written through the same
  // update_user_settings command the settings dialog uses, and the local copy
  // is updated from the reply rather than optimistically — the map's visibility
  // rule reads the stored value, and a rejected write must not leave the two
  // disagreeing.
  const hideUnsubscribed = userRemoteSettings?.hide_unsubscribed_clusters ?? false;

  const handleScope = useCallback(
    async (hide: boolean) => {
      if (hide === hideUnsubscribed) {
        return;
      }

      const next = { ...userRemoteSettings, hide_unsubscribed_clusters: hide };
      await outCommand({ type: OutCommand.updateUserSettings, data: next });
      update({ userRemoteSettings: next });
    },
    [outCommand, update, userRemoteSettings, hideUnsubscribed],
  );

  const renderChip = ({ id, name }: { id: string; name: string }) => (
    <span key={id} className={classes.SubscriptionChip} onClick={() => handleFocus(id)} title="点击定位到该星系">
      {name}
      <button className={classes.SubscriptionChipRemove} onClick={e => askRemove(e, id)} title="取消订阅">
        ×
      </button>
    </span>
  );

  return (
    <div className={classes.ViewModeSelector}>
      {isGlobalAllowed && (
        <div className={classes.ToggleGroup}>
          <button
            className={`${classes.ToggleButton} ${viewMode === 'all' ? classes.ToggleButtonActive : ''}`}
            onClick={() => handleViewMode('all')}
            title="全局视图"
          >
            全局
          </button>
          <button
            className={`${classes.ToggleButton} ${viewMode === 'home' ? classes.ToggleButtonActive : ''}`}
            onClick={() => handleViewMode('home')}
            title="订阅视图"
          >
            订阅
          </button>
        </div>
      )}

      {/* The scope switch belongs to the subscription view and is offered
          nowhere else: the whole block is gated on viewMode !== 'all', so in
          the global view the control is not rendered and the setting is not
          applied. The map's visibility rule ignores it in the global view for
          the same reason — every system is on screen there anyway. */}
      {viewMode !== 'all' && (
        <div className={classes.ScopeGroup}>
          <span className={classes.ScopeLabel}>非订阅星系族</span>
          <div className={classes.ToggleGroup}>
            <button
              className={`${classes.ToggleButton} ${!hideUnsubscribed ? classes.ToggleButtonActive : ''}`}
              onClick={() => handleScope(false)}
              title="显示所有可见的星系族，包括未订阅的；可以在任意位置添加星系"
            >
              显示
            </button>
            <button
              className={`${classes.ToggleButton} ${hideUnsubscribed ? classes.ToggleButtonActive : ''}`}
              onClick={() => handleScope(true)}
              title="只显示与订阅星系相连的星系族；与订阅断开时连自己的角色也不显示，且不能在订阅族之外添加星系"
            >
              隐藏
            </button>
          </div>
        </div>
      )}

      {viewMode !== 'all' && (
        <div className={classes.HomeDropdown}>
          <div className={classes.SubscriptionInputRow}>
            <input
              className={classes.SubscriptionInput}
              value={searchText}
              onChange={e => handleSearch(e.target.value)}
              placeholder={limitReached ? '已达订阅上限' : '输入星系名/代码订阅，如 J144038'}
              disabled={limitReached}
            />
            {subscriptionLimit != null && (
              <span className={classes.SubscriptionLimit}>
                {subscribedSystemIds.length}/{subscriptionLimit}
              </span>
            )}
          </div>

          {results.length > 0 && (
            <ul className={classes.SubscriptionResults}>
              {results.map(r => (
                <li key={r.value} className={classes.SubscriptionResult} onClick={() => handleAdd(r.value)}>
                  {r.label}
                </li>
              ))}
            </ul>
          )}

          {collapsed ? (
            <>
              <button
                className={classes.SubscriptionCollapsed}
                onClick={e => subscriptionPanelRef.current?.toggle(e)}
                title="展开订阅列表"
              >
                {subscribedNames.length} 个订阅
                <span className={classes.SubscriptionCollapsedCaret}>▾</span>
              </button>

              <OverlayPanel ref={subscriptionPanelRef} className={classes.SubscriptionPanel}>
                <ul className={classes.SubscriptionPanelList}>
                  {subscribedNames.map(({ id, name }) => (
                    <li key={id} className={classes.SubscriptionPanelItem}>
                      <span
                        className={classes.SubscriptionPanelName}
                        onClick={() => {
                          handleFocus(id);
                          subscriptionPanelRef.current?.hide();
                        }}
                      >
                        {name}
                      </span>
                      <button
                        className={classes.SubscriptionChipRemove}
                        onClick={e => askRemove(e, id)}
                        title="取消订阅"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </OverlayPanel>
            </>
          ) : (
            subscribedNames.length > 0 && (
              <div className={classes.SubscriptionChips}>{subscribedNames.map(renderChip)}</div>
            )
          )}

          {subscribedNames.length === 0 && <span className={classes.NoHomeHint}>请订阅至少一个星系</span>}
        </div>
      )}

      <ConfirmPopup
        target={pendingUnsubscribe?.target}
        visible={pendingUnsubscribe != null}
        onHide={() => setPendingUnsubscribe(null)}
        message="取消订阅该星系？"
        icon="pi pi-exclamation-triangle text-orange-400"
        accept={() => {
          if (pendingUnsubscribe != null) {
            handleRemove(pendingUnsubscribe.id);
          }
          setPendingUnsubscribe(null);
        }}
      />
    </div>
  );
};
