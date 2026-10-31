import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';
import { getSystemStaticInfo, useLoadSystemStatic } from '@/hooks/Mapper/mapRootProvider/hooks/useLoadSystemStatic';
import {
  MAX_WIDGET_OPACITY,
  MIN_WIDGET_OPACITY,
  closeSelf,
  openMain,
  setAlwaysOnTop,
  setFollowEnabled,
  setWidgetOpacity,
  setWindowTitle,
} from './bridge';
import { useDesktopBridgeState } from './useDesktopBridge';
import { useDesktopActiveSystem } from './useDesktopActiveSystem';
import { getEffectLabel, getSpecialSystemLabel, getSystemClassLabel } from './systemTitle';
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
  const { followEnabled, widgetOpacity, alwaysOnTop } = useDesktopBridgeState();
  const { lastEve, matchedCharacter, systemId } = useDesktopActiveSystem();
  const {
    data: { wormholesData },
  } = useMapRootState();
  const [topNotice, setTopNotice] = useState<string | null>(null);

  // A detached window has no map, so nothing else preloads static system data.
  // The array must be stable: useLoadSystemStatic reloads when `systems` changes,
  // and a fresh literal each render would keep setting state and re-rendering.
  const systemsToLoad = useMemo(() => (systemId ? [systemId] : []), [systemId]);
  useLoadSystemStatic({ systems: systemsToLoad });

  const systemStaticInfo = systemId ? getSystemStaticInfo(Number(systemId)) : undefined;
  const systemName = systemStaticInfo?.solar_system_name ?? null;
  const systemClassLabel = getSystemClassLabel(systemStaticInfo, wormholesData);
  const effectLabel = getEffectLabel(systemStaticInfo?.effect_name);
  const specialSystemLabel = getSpecialSystemLabel(systemStaticInfo);

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
    const columns = [
      WIDGET_LABELS[widget],
      matchedCharacter?.name,
      systemName,
      systemClassLabel,
      effectLabel,
      specialSystemLabel,
    ].filter((column): column is string => !!column);

    void setWindowTitle(`${columns.join(' · ')} · Wanderer`);
  }, [effectLabel, matchedCharacter?.name, specialSystemLabel, systemClassLabel, systemName, widget]);

  // The pin is cached per widget id in config.json, and the window is created
  // with it already applied; `desktop_ready` reports the native state so this
  // toggle starts in the right position.
  const toggleAlwaysOnTop = useCallback(() => {
    void setAlwaysOnTop(!alwaysOnTop);
  }, [alwaysOnTop]);

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

  // The window keeps its native title bar; dragging by the content bar is still
  // a convenience. `deep` makes every non-interactive part draggable; buttons,
  // labels and inputs keep their normal clicks (Tauri's drag.js checks for
  // that). Zoom is controlled from the main map bar (or Ctrl+= / Ctrl+- /
  // Ctrl+0 here); transparency stays adjustable in place because it was
  // explicitly requested for the detached windows.
  const transparency = Math.round((MAX_WIDGET_OPACITY - widgetOpacity) * 100);

  return (
    <div
      data-tauri-drag-region="deep"
      className="flex h-8 shrink-0 items-center gap-2 border-b border-stone-800 bg-stone-900/90 px-2 text-xs text-stone-300"
    >
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

      <label
        className="flex shrink-0 cursor-pointer items-center gap-1 select-none"
        title={`窗口透明度 ${transparency}%（0%–70%，整个窗口含标题栏一起变化，仅 Windows 生效）`}
      >
        <span>透明</span>
        <input
          type="range"
          className="h-1 w-12 cursor-pointer accent-stone-400"
          min={0}
          max={Math.round((MAX_WIDGET_OPACITY - MIN_WIDGET_OPACITY) * 100)}
          step={5}
          value={transparency}
          onChange={event => setWidgetOpacity(MAX_WIDGET_OPACITY - Number(event.target.value) / 100)}
        />
      </label>

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
