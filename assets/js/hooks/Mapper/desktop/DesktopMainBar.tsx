import { openServerSettings, openWidget } from './bridge';
import { DesktopWidget } from './types';

const WIDGETS: { id: DesktopWidget; label: string }[] = [
  { id: 'signatures', label: '信号' },
  { id: 'jspace', label: 'J空间' },
  { id: 'bookmarks', label: '位标' },
  { id: 'kills', label: 'KM' },
  { id: 'characters', label: '成员' },
];

/**
 * Entry point for the detached windows. Native window chrome stays out of the
 * map area, so this small floating bar is the only desktop-only control added
 * to the main map.
 */
export function DesktopMainBar() {
  return (
    <div className="absolute top-2 right-16 z-50 flex items-center gap-1.5 rounded border border-stone-700/80 bg-stone-900/90 px-2 py-1 text-xs text-stone-300 shadow-lg">
      <button
        type="button"
        className="rounded border border-stone-700 px-1.5 py-0.5 text-stone-400 hover:border-stone-500 hover:text-white"
        onClick={() => window.location.assign('/desktop')}
      >
        地图
      </button>
      <button
        type="button"
        className="rounded border border-stone-700 px-1.5 py-0.5 text-stone-400 hover:border-stone-500 hover:text-white"
        title="修改服务器地址"
        onClick={() => void openServerSettings()}
      >
        服务器
      </button>
      <span className="select-none text-stone-500">独立窗口</span>
      {WIDGETS.map(item => (
        <button
          key={item.id}
          type="button"
          className="rounded border border-stone-700 px-1.5 py-0.5 text-stone-300 hover:border-stone-500 hover:text-white"
          onClick={() => void openWidget(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
