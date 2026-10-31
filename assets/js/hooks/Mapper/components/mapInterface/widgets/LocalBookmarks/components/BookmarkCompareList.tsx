import { BookmarkComparison, BookmarkMatchKind, BookmarkStatus } from '../types';
import { BookmarkStatusBadge } from './StatusBadge';

const ROW_TONE: Record<BookmarkComparison['status'], string> = {
  matched: 'border-l-emerald-500/60',
  stale: 'border-l-red-500/70',
  suspected: 'border-l-orange-400/70',
  ambiguous: 'border-l-sky-400/60',
  custom: 'border-l-stone-600/60',
};

const EVIDENCE_LABEL: Record<BookmarkMatchKind, string> = {
  full: '完整ID',
  letters: '字母',
  site: '站点名',
  digits: '数字',
};

const matchedLabel = ({ matched }: BookmarkComparison) => {
  if (!matched) {
    return null;
  }
  return matched.name && matched.name !== 'Unknown' ? `${matched.eve_id} ${matched.name}` : matched.eve_id;
};

const candidatesLabel = ({ candidates }: BookmarkComparison) =>
  (candidates ?? []).map(candidate => candidate.eve_id).join(' / ');

export const BookmarkCompareList = ({
  items,
  onlyDiff,
  statusFilter,
}: {
  items: BookmarkComparison[];
  onlyDiff: boolean;
  statusFilter?: BookmarkStatus | null;
}) => {
  const visible = items.filter(item => {
    if (statusFilter && item.status !== statusFilter) {
      return false;
    }
    return !onlyDiff || (item.status !== 'matched' && item.status !== 'custom');
  });

  if (visible.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center px-2">
        <span className="select-none text-center text-sm text-stone-400/80">
          {statusFilter ? '没有匹配项' : onlyDiff ? '没有差异' : '没有位标'}
        </span>
      </div>
    );
  }

  return (
    <div className="custom-scrollbar min-h-0 flex-1 overflow-auto">
      {visible.map((item, index) => {
        const { bookmark, status, evidence } = item;
        const matched = matchedLabel(item);
        const candidates = candidatesLabel(item);

        return (
          <div
            key={`${bookmark.key}:${index}`}
            className={`border-b border-l-2 border-stone-800/60 px-2 py-1.5 last:border-b-0 ${ROW_TONE[status]}`}
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-stone-100" title={bookmark.name}>
                {bookmark.name}
              </span>
              <BookmarkStatusBadge status={status} />
            </div>

            <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[10px] text-stone-500">
              <span className="min-w-0 flex-1 truncate" title={bookmark.folderPath ?? bookmark.folder}>
                {bookmark.folder ?? bookmark.folderPath ?? ''}
              </span>

              <span className="shrink-0 text-right">
                {status === 'matched' && matched && <span className="text-emerald-400/80">→ {matched}</span>}
                {status === 'ambiguous' && candidates && <span className="text-sky-400/80">匹配 {candidates}</span>}
                {(status === 'stale' || status === 'suspected') && evidence && (
                  <span>
                    {EVIDENCE_LABEL[evidence.kind]} {evidence.token}
                  </span>
                )}
                {status === 'custom' && '未识别为信号'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
