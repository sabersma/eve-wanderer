import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSystemStaticInfo, useLoadSystemStatic } from '@/hooks/Mapper/mapRootProvider/hooks/useLoadSystemStatic';
import { closeSelf, openMain, setAlwaysOnTop, setFollowEnabled, setWindowTitle } from './bridge';
import { useDesktopBridgeState } from './useDesktopBridge';
import { useDesktopActiveSystem } from './useDesktopActiveSystem';
import { DesktopWidget } from './types';

type DesktopWidgetBarProps = {
  widget: DesktopWidget;
  /** Switch this window to another widget instead of opening a new window. */
  onSwitch: (widget: DesktopWidget) => void;
};

const WIDGET_LABELS: Record<DesktopWidget, string> = {
  signatures: '信号',
  jspace: 'J空间',
  bookmarks: '位标',
  kills: 'KM',
  characters: '成员',
};

// Always-on-top is a no-op outside Windows: GTK on Wayland (WSLg included)
// has no keep-above, so during WSL development the toggle would look broken.
const ALWAYS_ON_TOP_UNSUPPORTED =
  typeof navigator !== 'undefined' && /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);

export function DesktopWidgetBar({ widget, onSwitch }: DesktopWidgetBarProps) {
  const { followEnabled } = useDesktopBridgeState();
  const { lastEve, matchedCharacter, systemId } = useDesktopActiveSystem();
  const [alwaysOnTop, setAlwaysOnTopState] = useState(false);
  const [topNotice, setTopNotice] = useState<string | null>(null);

  // A detached window has no map, so nothing else preloads static system data.
  // The array must be stable: useLoadSystemStatic reloads when `systems` changes,
  // and a fresh literal each render would keep setting state and re-rendering.
  const systemsToLoad = useMemo(() => (systemId ? [systemId] : []), [systemId]);
  useLoadSystemStatic({ systems: systemsToLoad });

  const systemName = systemId ? (getSystemStaticInfo(Number(systemId))?.solar_system_name ?? null) : null;

  useEffect(() => {
    void setAlwaysOnTop(alwaysOnTop);
  }, [alwaysOnTop, setAlwaysOnTop]);

  useEffect(() => {
    if (!alwaysOnTop || !ALWAYS_ON_TOP_UNSUPPORTED) {
      setTopNotice(null);
      return undefined;
    }

    setTopNotice('已请求置顶；WSL/Linux 下不生效，Windows 上可用');
    const timer = window.setTimeout(() => setTopNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [alwaysOnTop]);

  useEffect(() => {
    const character = matchedCharacter?.name ? ` · ${matchedCharacter.name}` : '';
    const target = systemName ? ` · ${systemName}` : '';
    void setWindowTitle(`${WIDGET_LABELS[widget]}${character}${target} · Wanderer`);
  }, [matchedCharacter?.name, systemName, widget]);

  const toggleAlwaysOnTop = useCallback(() => setAlwaysOnTopState(value => !value), []);

  const status = (() => {
    if (!followEnabled) {
      return systemId ? `跟随已关闭 · ${systemName ?? systemId}` : '跟随已关闭';
    }
    if (lastEve == null) {
      // No EVE activation yet: the system may come from the main map fallback.
      return systemId ? `主图选择 · ${systemName ?? systemId}` : '等待 EVE 客户端';
    }
    if (!matchedCharacter) {
      return `未匹配角色：${lastEve.title}`;
    }
    if (!matchedCharacter.location?.solar_system_id) {
      return systemId
        ? `${matchedCharacter.name}：位置未知 · 主图选择 ${systemName ?? systemId}`
        : `${matchedCharacter.name}：位置未知`;
    }
    return `${matchedCharacter.name} · ${systemName ?? systemId}`;
  })();

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-stone-800 bg-stone-900/90 px-2 text-xs text-stone-300">
      <span className="shrink-0 font-medium text-stone-100">{WIDGET_LABELS[widget]}</span>
      <span className="min-w-0 flex-1 truncate" title={topNotice ?? status}>
        {topNotice ? <span className="text-amber-300">{topNotice}</span> : followEnabled ? status : '跟随已关闭'}
      </span>

      <label className="flex shrink-0 cursor-pointer items-center gap-1 select-none">
        <input
          type="checkbox"
          className="checkbox checkbox-xs"
          checked={followEnabled}
          onChange={event => setFollowEnabled(event.target.checked)}
        />
        跟随
      </label>

      <button
        type="button"
        className={`rounded border px-1.5 py-0.5 ${
          alwaysOnTop ? 'border-amber-500/60 text-amber-200' : 'border-stone-700 text-stone-400 hover:text-stone-100'
        }`}
        title={ALWAYS_ON_TOP_UNSUPPORTED ? '窗口置顶（WSL/Linux 下不生效）' : '窗口置顶'}
        onClick={toggleAlwaysOnTop}
      >
        置顶
      </button>

      <div className="flex shrink-0 items-center gap-1">
        <button type="button" className="hover:text-white" onClick={() => void openMain()}>
          主图
        </button>
        {(['signatures', 'jspace', 'bookmarks', 'kills', 'characters'] as DesktopWidget[]).map(item => (
          <button
            key={item}
            type="button"
            title={item === widget ? undefined : '在此窗口显示'}
            className={item === widget ? 'text-white' : 'text-stone-500 hover:text-stone-200'}
            onClick={() => onSwitch(item)}
          >
            {WIDGET_LABELS[item]}
          </button>
        ))}
        <button type="button" className="ml-1 text-stone-500 hover:text-red-300" onClick={() => void closeSelf()}>
          ×
        </button>
      </div>
    </div>
  );
}
