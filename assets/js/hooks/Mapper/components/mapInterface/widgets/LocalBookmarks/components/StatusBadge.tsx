import { BookmarkStatus, SignatureStatus } from '../types';

const BOOKMARK_STATUS_META: Record<BookmarkStatus, { label: string; className: string }> = {
  matched: { label: '已匹配', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' },
  stale: { label: '已过期', className: 'border-red-500/40 bg-red-500/10 text-red-400' },
  suspected: { label: '疑似过期', className: 'border-orange-500/40 bg-orange-500/10 text-orange-300' },
  ambiguous: { label: '歧义', className: 'border-sky-500/40 bg-sky-500/10 text-sky-300' },
  custom: { label: '自定义', className: 'border-stone-600/40 bg-stone-500/10 text-stone-400' },
};

const SIGNATURE_STATUS_META: Record<SignatureStatus, { label: string; className: string }> = {
  matched: { label: '已标记', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' },
  unmatched: { label: '未标记', className: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  ambiguous: { label: '疑似', className: 'border-sky-500/40 bg-sky-500/10 text-sky-300' },
};

const Badge = ({ label, className }: { label: string; className: string }) => (
  <span className={`shrink-0 rounded border px-1 py-0.5 text-[10px] leading-none ${className}`}>{label}</span>
);

export const BookmarkStatusBadge = ({ status }: { status: BookmarkStatus }) => {
  const meta = BOOKMARK_STATUS_META[status];
  return <Badge label={meta.label} className={meta.className} />;
};

export const SignatureStatusBadge = ({ status }: { status: SignatureStatus }) => {
  const meta = SIGNATURE_STATUS_META[status];
  return <Badge label={meta.label} className={meta.className} />;
};
