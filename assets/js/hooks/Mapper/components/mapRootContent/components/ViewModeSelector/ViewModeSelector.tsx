import { useCallback, useMemo, useState } from 'react';
import { useMapRootState, ViewMode } from '@/hooks/Mapper/mapRootProvider';
import { OutCommand } from '@/hooks/Mapper/types';

import classes from './ViewModeSelector.module.scss';

interface SearchResult {
  label: string;
  value: number;
}

/**
 * Subscription manager replacing the old all/home toggle.
 *
 * - admin/manager keep a "全局 / 订阅" toggle (global view + unlimited subs).
 * - member/viewer only get the subscription view: type a system name/code to
 *   subscribe (limits: member ≤3, viewer ≤1), remove to unsubscribe.
 */
export const ViewModeSelector = () => {
  const { data, update, outCommand } = useMapRootState();
  const { viewMode, subscribedSystemIds, subscriptionLimit, systems, userPermissions } = data;

  const isGlobalAllowed = userPermissions.admin_map || userPermissions.manage_map;

  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);

  const subscribedNames = useMemo(
    () =>
      subscribedSystemIds.map(id => {
        const s = systems.find(x => x.id === id);
        return { id, name: s?.system_static_info?.solar_system_name ?? s?.name ?? id };
      }),
    [subscribedSystemIds, systems],
  );

  const limitReached = subscriptionLimit != null && subscribedSystemIds.length >= subscriptionLimit;

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

  const handleViewMode = useCallback((mode: ViewMode) => update({ viewMode: mode }), [update]);

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

          {subscribedNames.length > 0 && (
            <div className={classes.SubscriptionChips}>
              {subscribedNames.map(({ id, name }) => (
                <span key={id} className={classes.SubscriptionChip}>
                  {name}
                  <button className={classes.SubscriptionChipRemove} onClick={() => handleRemove(id)} title="取消订阅">
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {subscribedNames.length === 0 && <span className={classes.NoHomeHint}>请订阅至少一个星系</span>}
        </div>
      )}
    </div>
  );
};
