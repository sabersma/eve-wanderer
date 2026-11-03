import {
  JspaceActivityLevel,
  JspaceCorporation,
} from '@/hooks/Mapper/components/mapInterface/widgets/JspaceWidget/types.ts';
import { ZKB_ICON } from '@/hooks/Mapper/icons';

const corporationUrl = (corporationId: number) => `https://zkillboard.com/corporation/${corporationId}/`;
const allianceUrl = (allianceId: number) => `https://zkillboard.com/alliance/${allianceId}/`;

const ACTIVITY_META: Record<JspaceActivityLevel, { label: string; className: string; hint: string }> = {
  high: {
    label: '活跃 高',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    hint: 'Recent activity; the current UTC hour is in this corporation’s peak window.',
  },
  medium: {
    label: '活跃 中',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    hint: 'Recent activity; the current UTC hour is one of this corporation’s busiest hours.',
  },
  low: {
    label: '活跃 低',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
    hint: 'Active recently, but the current UTC hour is outside its usual activity window.',
  },
  none: {
    label: '无活动',
    className: 'border-stone-600/40 bg-stone-700/20 text-stone-400',
    hint: 'No killmail activity in this system in the last 14 days.',
  },
};

const formatHour = (hour: number) => `${String(((hour % 24) + 24) % 24).padStart(2, '0')}:00`;

const timezoneLabel = (offset: number) => (offset === 0 ? 'UTC' : `UTC${offset > 0 ? '+' : ''}${offset}`);

/** Converts the inferred UTC peak window into the corporation's local wall clock. */
const localWindowLabel = (offset: number, start: number, end: number) => {
  const localStart = (start + offset + 24) % 24;
  // End is an inclusive hour; display the range as start -> end+1.
  const localEnd = (end + offset + 1 + 48) % 24;
  return `${formatHour(localStart)}–${formatHour(localEnd)}`;
};

const Logo = ({ src, alt, size }: { src?: string; alt: string; size: string }) => {
  if (!src) {
    return (
      <div
        className={`${size} shrink-0 rounded bg-stone-800/80 flex items-center justify-center text-[10px] text-stone-500`}
      >
        {alt.slice(0, 1).toUpperCase()}
      </div>
    );
  }

  return <img src={src} alt={alt} loading="lazy" className={`${size} shrink-0 rounded bg-stone-800/80`} />;
};

export const JspaceCorporationRow = ({ corporation }: { corporation: JspaceCorporation }) => {
  const {
    corporation_id: corporationId,
    corporation_name: corporationName,
    corporation_icon: corporationIcon,
    alliance_id: allianceId,
    alliance_name: allianceName,
    alliance_icon: allianceIcon,
    active_days: activeDays,
    last_active_days: lastActiveDays,
    activity_level: activityLevel,
    timezone_offset: timezoneOffset,
    active_window_utc: activeWindow,
  } = corporation;

  // Aliased condition: lets TypeScript narrow both alliance fields below.
  const hasAlliance = allianceId != null && allianceName != null;

  const activity = activityLevel ? ACTIVITY_META[activityLevel] : null;
  const showTimezone = timezoneOffset != null && activeWindow != null;

  return (
    <div className="flex items-start gap-2 border-b border-stone-800/60 px-2 py-1.5 last:border-b-0">
      <a href={corporationUrl(corporationId)} target="_blank" rel="noreferrer" className="mt-0.5 shrink-0">
        <Logo src={corporationIcon} alt={corporationName} size="h-7 w-7" />
      </a>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <a
            href={corporationUrl(corporationId)}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate text-xs text-stone-100 hover:text-amber-300"
            title={corporationName}
          >
            {corporationName}
          </a>

          <span
            className="shrink-0 rounded bg-stone-800/80 px-1 text-[10px] leading-4 text-stone-300"
            title={`Days with killmail activity in the lookback window${
              lastActiveDays != null ? ` · last active ${lastActiveDays}d ago` : ''
            }`}
          >
            {activeDays}d
          </span>

          <a
            href={corporationUrl(corporationId)}
            target="_blank"
            rel="noreferrer"
            className="ml-auto shrink-0"
            title="Open on zKillboard"
          >
            <img src={ZKB_ICON} width="14" height="14" className="external-icon" />
          </a>
        </div>

        {hasAlliance && (
          <a
            href={allianceUrl(allianceId)}
            target="_blank"
            rel="noreferrer"
            className="flex min-w-0 items-center gap-1 text-[11px] text-stone-400 hover:text-amber-300"
            title={allianceName}
          >
            <Logo src={allianceIcon} alt={allianceName} size="h-3.5 w-3.5" />
            <span className="truncate">{allianceName}</span>
          </a>
        )}

        {(activity || showTimezone) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
            {activity && (
              <span
                className={`shrink-0 rounded border px-1 py-px leading-4 ${activity.className}`}
                title={activity.hint}
              >
                {activity.label}
              </span>
            )}

            {showTimezone && (
              <span
                className="text-stone-500"
                title={`Inferred main active time window: ${formatHour(activeWindow.start)}–${formatHour(
                  (activeWindow.end + 1) % 24,
                )} UTC`}
              >
                {timezoneLabel(timezoneOffset)} · {localWindowLabel(timezoneOffset, activeWindow.start, activeWindow.end)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
