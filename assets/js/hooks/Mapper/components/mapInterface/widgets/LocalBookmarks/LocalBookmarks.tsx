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
import { BookmarkStatus, ComparisonCounts, SignatureStatus } from './types';

type Tab = 'signatures' | 'bookmarks';

type StatusFilter = { tab: 'signatures'; status: SignatureStatus } | { tab: 'bookmarks'; status: BookmarkStatus };

const SIGNATURE_FILTER_COUNTS: Record<SignatureStatus, keyof ComparisonCounts> = {
  matched: 'signaturesMatched',
  unmatched: 'signaturesUnmatched',
  ambiguous: 'signaturesAmbiguous',
};

const BOOKMARK_FILTER_COUNTS: Record<BookmarkStatus, keyof ComparisonCounts> = {
  matched: 'bookmarksMatched',
  stale: 'bookmarksStale',
  suspected: 'bookmarksSuspected',
  ambiguous: 'bookmarksAmbiguous',
  custom: 'bookmarksCustom',
};

const countForFilter = (filter: StatusFilter, counts: ComparisonCounts) =>
  filter.tab === 'signatures'
    ? counts[SIGNATURE_FILTER_COUNTS[filter.status]]
    : counts[BOOKMARK_FILTER_COUNTS[filter.status]];

const FilterChip = ({
  active,
  className,
  onClick,
  children,
}: {
  active: boolean;
  className: string;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    aria-pressed={active}
    title={active ? '取消筛选' : '只看这一类'}
    className={`shrink-0 rounded px-0.5 transition-colors hover:bg-stone-800 ${className} ${
      active ? 'bg-stone-700/70 ring-1 ring-stone-500/60' : ''
    }`}
    onClick={onClick}
  >
    {children}
  </button>
);

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
  const [statusFilter, setStatusFilter] = useState<StatusFilter | null>(null);

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

  const isSignatureFilter = (status: SignatureStatus) =>
    statusFilter !== null && statusFilter.tab === 'signatures' && statusFilter.status === status;

  const isBookmarkFilter = (status: BookmarkStatus) =>
    statusFilter !== null && statusFilter.tab === 'bookmarks' && statusFilter.status === status;

  const toggleFilter = useCallback((next: StatusFilter) => {
    setStatusFilter(current => (current && current.tab === next.tab && current.status === next.status ? null : next));
    setTab(next.tab);
  }, []);

  // Status chips with a zero count are not rendered (e.g. after a new paste or
  // a signature refresh); drop the filter with them so the list cannot stay
  // filtered by an invisible status.
  const activeFilterCount = statusFilter ? countForFilter(statusFilter, counts) : null;
  useEffect(() => {
    if (statusFilter && activeFilterCount === 0) {
      setStatusFilter(null);
    }
  }, [activeFilterCount, statusFilter]);

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
          <FilterChip
            active={isSignatureFilter('matched')}
            className="text-emerald-400"
            onClick={() => toggleFilter({ tab: 'signatures', status: 'matched' })}
          >
            已标记 {counts.signaturesMatched}
          </FilterChip>
          <FilterChip
            active={isSignatureFilter('unmatched')}
            className="text-amber-300"
            onClick={() => toggleFilter({ tab: 'signatures', status: 'unmatched' })}
          >
            未标记 {counts.signaturesUnmatched}
          </FilterChip>
          {counts.signaturesAmbiguous > 0 && (
            <FilterChip
              active={isSignatureFilter('ambiguous')}
              className="text-sky-300"
              onClick={() => toggleFilter({ tab: 'signatures', status: 'ambiguous' })}
            >
              疑似 {counts.signaturesAmbiguous}
            </FilterChip>
          )}
          {counts.bookmarksStale > 0 && (
            <FilterChip
              active={isBookmarkFilter('stale')}
              className="text-red-400"
              onClick={() => toggleFilter({ tab: 'bookmarks', status: 'stale' })}
            >
              过期 {counts.bookmarksStale}
            </FilterChip>
          )}
          {counts.bookmarksSuspected > 0 && (
            <FilterChip
              active={isBookmarkFilter('suspected')}
              className="text-orange-300"
              onClick={() => toggleFilter({ tab: 'bookmarks', status: 'suspected' })}
            >
              疑似过期 {counts.bookmarksSuspected}
            </FilterChip>
          )}
          {counts.bookmarksAmbiguous > 0 && (
            <FilterChip
              active={isBookmarkFilter('ambiguous')}
              className="text-sky-300"
              onClick={() => toggleFilter({ tab: 'bookmarks', status: 'ambiguous' })}
            >
              歧义 {counts.bookmarksAmbiguous}
            </FilterChip>
          )}
          {counts.bookmarksCustom > 0 && (
            <FilterChip
              active={isBookmarkFilter('custom')}
              className="text-stone-500"
              onClick={() => toggleFilter({ tab: 'bookmarks', status: 'custom' })}
            >
              自定义 {counts.bookmarksCustom}
            </FilterChip>
          )}

          <button type="button" className="ml-auto text-stone-500 hover:text-red-300" onClick={handleClear}>
            清空
          </button>
        </div>

        <div className="flex items-center gap-3 border-b border-stone-800 px-2 py-1 text-[11px]">
          <button
            type="button"
            className={tab === 'signatures' ? 'text-white' : 'text-stone-500 hover:text-stone-200'}
            onClick={() => {
              setTab('signatures');
              setStatusFilter(null);
            }}
          >
            信号 {counts.signatures}
          </button>
          <button
            type="button"
            className={tab === 'bookmarks' ? 'text-white' : 'text-stone-500 hover:text-stone-200'}
            onClick={() => {
              setTab('bookmarks');
              setStatusFilter(null);
            }}
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
          <SignatureCompareList
            items={comparison.signatures}
            onlyDiff={onlyDiff}
            isLoading={isLoading}
            statusFilter={statusFilter?.tab === 'signatures' ? statusFilter.status : null}
          />
        ) : (
          <BookmarkCompareList
            items={comparison.bookmarks}
            onlyDiff={onlyDiff}
            statusFilter={statusFilter?.tab === 'bookmarks' ? statusFilter.status : null}
          />
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
