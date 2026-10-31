import { SignatureComparison, SignatureStatus } from '../types';
import { SignatureStatusBadge } from './StatusBadge';

const ROW_TONE: Record<SignatureComparison['status'], string> = {
  matched: 'border-l-emerald-500/60',
  unmatched: 'border-l-amber-400/70',
  ambiguous: 'border-l-sky-400/60',
};

const signatureLabel = ({ name, group }: SignatureComparison['signature']) => {
  if (name && name !== 'Unknown') {
    return name;
  }
  return group ?? '';
};

export const SignatureCompareList = ({
  items,
  onlyDiff,
  isLoading,
  statusFilter,
}: {
  items: SignatureComparison[];
  onlyDiff: boolean;
  isLoading?: boolean;
  statusFilter?: SignatureStatus | null;
}) => {
  const visible = items.filter(item => {
    if (statusFilter && item.status !== statusFilter) {
      return false;
    }
    return !onlyDiff || item.status !== 'matched';
  });

  if (visible.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center px-2">
        <span className="select-none text-center text-sm text-stone-400/80">
          {isLoading ? 'Loading signatures...' : statusFilter ? '没有匹配项' : onlyDiff ? '没有差异' : '没有信号'}
        </span>
      </div>
    );
  }

  return (
    <div className="custom-scrollbar min-h-0 flex-1 overflow-auto">
      {visible.map(({ signature, status, matchedBookmarks, ambiguousBookmarks }) => (
        <div
          key={signature.eve_id}
          className={`border-b border-l-2 border-stone-800/60 px-2 py-1.5 last:border-b-0 ${ROW_TONE[status]}`}
        >
          <div className="flex items-center gap-2">
            <span className="shrink-0 font-mono text-xs text-stone-100">{signature.eve_id}</span>
            <SignatureStatusBadge status={status} />
            <span className="min-w-0 flex-1 truncate text-[11px] text-stone-400" title={signatureLabel(signature)}>
              {signatureLabel(signature)}
            </span>
          </div>

          {matchedBookmarks.length > 0 && (
            <div
              className="mt-0.5 truncate pl-1 text-[10px] text-stone-500"
              title={matchedBookmarks.map(item => item.bookmark.name).join('\n')}
            >
              → {matchedBookmarks.map(item => item.bookmark.name).join(' / ')}
            </div>
          )}

          {status === 'ambiguous' && ambiguousBookmarks.length > 0 && (
            <div
              className="mt-0.5 truncate pl-1 text-[10px] text-sky-400/80"
              title={ambiguousBookmarks.map(item => item.bookmark.name).join('\n')}
            >
              可能对应: {ambiguousBookmarks.map(item => item.bookmark.name).join(' / ')}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
