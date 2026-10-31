import {
  MAX_WIDGET_OPACITY,
  MIN_WIDGET_OPACITY,
  openServerSettings,
  openWidget,
  setWidgetOpacity,
  zoomIn,
  zoomOut,
  zoomReset,
} from './bridge';
import { useDesktopBridgeState } from './useDesktopBridge';
import { DesktopWidget } from './types';

const WIDGETS: { id: DesktopWidget; label: string }[] = [
  { id: 'signatures', label: '信号' },
  { id: 'jspace', label: 'J空间' },
  { id: 'bookmarks', label: '位标' },
  { id: 'kills', label: 'KM' },
  { id: 'characters', label: '成员' },
];

const buttonClass =
  'rounded border border-stone-700 px-1.5 py-0.5 text-stone-300 hover:border-stone-500 hover:text-white';

/**
 * Entry point for the detached windows. Native window chrome stays out of the
 * map area, so this small floating bar is the only desktop-only control added
 * to the main map.
 *
 * It is also the only place where zoom and widget transparency are shown: the
 * native menu keeps just 「服务器设置…」 and detached windows have no settings
 * UI at all (they zoom with Ctrl+= / Ctrl+- / Ctrl+0).
 */
export function DesktopMainBar() {
  const { widgetOpacity, uiScale } = useDesktopBridgeState();
  const transparency = Math.round((MAX_WIDGET_OPACITY - widgetOpacity) * 100);
  const maxTransparency = Math.round((MAX_WIDGET_OPACITY - MIN_WIDGET_OPACITY) * 100);

  return (
    <div className="absolute top-2 right-16 z-50 flex max-w-[calc(100vw-5rem)] flex-wrap items-center justify-end gap-1.5 rounded border border-stone-700/80 bg-stone-900/90 px-2 py-1 text-xs text-stone-300 shadow-lg">
      <button type="button" className={buttonClass} onClick={() => window.location.assign('/desktop')}>
        地图
      </button>
      <button type="button" className={buttonClass} title="修改服务器地址" onClick={() => void openServerSettings()}>
        服务器
      </button>

      <span className="mx-0.5 h-3 w-px bg-stone-700" />
      <span className="text-stone-500">缩放</span>
      <button type="button" className={buttonClass} title="缩小界面（Ctrl+-）" onClick={() => void zoomOut()}>
        −
      </button>
      <span className="w-9 text-center tabular-nums text-stone-300" title="所有窗口共用同一缩放">
        {Math.round(uiScale * 100)}%
      </span>
      <button type="button" className={buttonClass} title="放大界面（Ctrl+=）" onClick={() => void zoomIn()}>
        +
      </button>
      <button
        type="button"
        className={buttonClass}
        title="重置所有窗口的界面缩放（Ctrl+0）"
        onClick={() => void zoomReset()}
      >
        重置所有窗口缩放
      </button>

      <span className="mx-0.5 h-3 w-px bg-stone-700" />
      <label
        className="flex shrink-0 cursor-pointer items-center gap-1 select-none"
        title={`小窗口整体透明度 ${transparency}%（0%–70%，整个窗口含标题栏一起变化，仅 Windows 生效）`}
      >
        <span>透明</span>
        <input
          type="range"
          className="h-1 w-12 cursor-pointer accent-stone-400"
          min={0}
          max={maxTransparency}
          step={5}
          value={transparency}
          onChange={event => setWidgetOpacity(MAX_WIDGET_OPACITY - Number(event.target.value) / 100)}
        />
        <span className="w-7 text-right tabular-nums">{transparency}%</span>
      </label>

      <span className="mx-0.5 h-3 w-px bg-stone-700" />
      <span className="select-none text-stone-500">独立窗口</span>
      {WIDGETS.map(item => (
        <button key={item.id} type="button" className={buttonClass} onClick={() => void openWidget(item.id)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}
