import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { PrimeIcons } from 'primereact/api';
import { Widget } from '@/hooks/Mapper/components/mapInterface/components';
import { getSystemStaticInfo, useLoadSystemStatic } from '@/hooks/Mapper/mapRootProvider/hooks/useLoadSystemStatic';
import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';
import { useDesktopActiveSystem } from '@/hooks/Mapper/desktop/useDesktopActiveSystem';
import { LayoutEventBlocker } from '@/hooks/Mapper/components/ui-kit';
import { parseBookmarks } from './helpers/parseBookmarks';
import { compareBookmarks } from './helpers/matchBookmarks';
import { useComparedSignatures } from './hooks/useComparedSignatures';
import { useLocalBookmarks } from './hooks/useLocalBookmarks';
import { PasteBox } from './components/PasteBox';
import { SignatureCompareList } from './components/SignatureCompareList';
import { BookmarkCompareList } from './components/BookmarkCompareList';

type Tab = 'signatures' | 'bookmarks';

const Hint = ({ children }: { children: ReactNode }) => (
  <div className="flex h-full w-full items-center justify-center px-3">
    <span className="select-none text-center text-sm leading-relaxed text-stone-400/80">{children}</span>
  </div>
);

export const LocalBookmarks = () => {
  const {
    data: { systems },
  } = useMapRootState();
  const { systemId } = useDesktopActiveSystem();

  // Detached desktop windows have no map, so nothing else preloads static data.
  const systemsToLoad = useMemo(() => (systemId ? [systemId] : []), [systemId]);
  useLoadSystemStatic({ systems: systemsToLoad });

  const systemStaticInfo = systemId ? getSystemStaticInfo(Number(systemId)) : undefined;
  const systemName = systemStaticInfo?.solar_system_name;
  const isSystemOnMap = !!systemId && systems.some(system => system.id === String(systemId));

  const { text, save, clear } = useLocalBookmarks(systemId);
  const { signatures, isLoading, error, reload } = useComparedSignatures(isSystemOnMap ? systemId : undefined);

  const parsedBookmarks = useMemo(() => parseBookmarks(text), [text]);
  const comparison = useMemo(() => compareBookmarks(signatures, parsedBookmarks), [signatures, parsedBookmarks]);

  const [tab, setTab] = useState<Tab>('signatures');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [editing, setEditing] = useState(false);

  // A new system must show that system's own paste, not the previous editor.
  useEffect(() => {
    setEditing(false);
  }, [systemId]);

  const handleSave = useCallback(
    (value: string) => {
      save(value);
      setEditing(false);
    },
    [save],
  );

  const handleClear = useCallback(() => {
    clear();
    setEditing(false);
  }, [clear]);

  const { counts } = comparison;

  const body = (() => {
    if (!systemId) {
      return <Hint>System is not selected</Hint>;
    }

    if (!isSystemOnMap) {
      return <Hint>该星系不在当前地图中，无法读取本地信号。</Hint>;
    }

    if (isLoading && signatures.length === 0) {
      return <Hint>Loading signatures...</Hint>;
    }

    if (error) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-2">
          <span className="select-none text-center text-sm text-red-400">{error}</span>
          <button type="button" className="text-xs text-stone-400 hover:text-stone-100" onClick={() => void reload()}>
            Retry
          </button>
        </div>
      );
    }

    if (signatures.length === 0) {
      return <Hint>该星系还没有记录信号。请先在「信号」窗口扫描或导入信号。</Hint>;
    }

    if (!text || editing) {
      return (
        <PasteBox
          key={systemId}
          initialValue={text}
          hasExisting={!!text}
          onSave={handleSave}
          onCancel={editing ? () => setEditing(false) : undefined}
        />
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-stone-800 px-2 py-1 text-[10px] text-stone-400">
          <span>信号 {counts.signatures}</span>
          <span className="text-emerald-400">已标记 {counts.signaturesMatched}</span>
          <span className="text-amber-300">未标记 {counts.signaturesUnmatched}</span>
          {counts.signaturesAmbiguous > 0 && <span className="text-sky-300">疑似 {counts.signaturesAmbiguous}</span>}
          {counts.bookmarksStale > 0 && <span className="text-red-400">过期 {counts.bookmarksStale}</span>}
          {counts.bookmarksSuspected > 0 && (
            <span className="text-orange-300">疑似过期 {counts.bookmarksSuspected}</span>
          )}
          {counts.bookmarksAmbiguous > 0 && <span className="text-sky-300">歧义 {counts.bookmarksAmbiguous}</span>}
          {counts.bookmarksCustom > 0 && <span className="text-stone-500">自定义 {counts.bookmarksCustom}</span>}

          <button type="button" className="ml-auto text-stone-500 hover:text-red-300" onClick={handleClear}>
            清空
          </button>
        </div>

        <div className="flex items-center gap-3 border-b border-stone-800 px-2 py-1 text-[11px]">
          <button
            type="button"
            className={tab === 'signatures' ? 'text-white' : 'text-stone-500 hover:text-stone-200'}
            onClick={() => setTab('signatures')}
          >
            信号 {counts.signatures}
          </button>
          <button
            type="button"
            className={tab === 'bookmarks' ? 'text-white' : 'text-stone-500 hover:text-stone-200'}
            onClick={() => setTab('bookmarks')}
          >
            位标 {counts.bookmarks}
          </button>

          <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1 select-none text-stone-400">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={onlyDiff}
              onChange={event => setOnlyDiff(event.target.checked)}
            />
            只看差异
          </label>

          <button
            type="button"
            className="shrink-0 text-stone-500 hover:text-stone-200"
            onClick={() => setEditing(true)}
          >
            重新粘贴
          </button>
        </div>

        {tab === 'signatures' ? (
          <SignatureCompareList items={comparison.signatures} onlyDiff={onlyDiff} isLoading={isLoading} />
        ) : (
          <BookmarkCompareList items={comparison.bookmarks} onlyDiff={onlyDiff} />
        )}
      </div>
    );
  })();

  return (
    <Widget
      label={
        <div className="flex h-full w-full items-center justify-between gap-1 text-xs">
          <div className="flex min-w-0 items-center gap-1">
            <span className="shrink-0 text-stone-400">本地位标</span>
            {systemName && <span className="truncate text-stone-200">{systemName}</span>}
          </div>

          <LayoutEventBlocker className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="text-stone-400 hover:text-white disabled:opacity-40"
              title="粘贴当前星系的位标"
              disabled={!isSystemOnMap}
              onClick={() => setEditing(true)}
            >
              粘贴
            </button>
            <button
              type="button"
              className="text-stone-400 hover:text-white disabled:opacity-40"
              title="刷新信号列表"
              disabled={!isSystemOnMap}
              onClick={() => void reload()}
            >
              <i className={PrimeIcons.REFRESH} />
            </button>
          </LayoutEventBlocker>
        </div>
      }
    >
      {body}
    </Widget>
  );
};
