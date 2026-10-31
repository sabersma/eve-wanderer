import { JspaceCorporation } from '@/hooks/Mapper/components/mapInterface/widgets/JspaceWidget/types.ts';
import { ZKB_ICON } from '@/hooks/Mapper/icons';

const corporationUrl = (corporationId: number) => `https://zkillboard.com/corporation/${corporationId}/`;
const allianceUrl = (allianceId: number) => `https://zkillboard.com/alliance/${allianceId}/`;

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
  } = corporation;

  // Aliased condition: lets TypeScript narrow both alliance fields below.
  const hasAlliance = allianceId != null && allianceName != null;

  return (
    <div className="flex items-center gap-2 border-b border-stone-800/60 px-2 py-1.5 last:border-b-0">
      <a href={corporationUrl(corporationId)} target="_blank" rel="noreferrer" className="shrink-0">
        <Logo src={corporationIcon} alt={corporationName} size="h-7 w-7" />
      </a>

      <div className="min-w-0 flex-1">
        <a
          href={corporationUrl(corporationId)}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-xs text-stone-100 hover:text-amber-300"
          title={corporationName}
        >
          {corporationName}
        </a>

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
      </div>

      <div className="shrink-0 text-right" title="Days with killmail activity in the lookback window">
        <span className="text-xs text-stone-200">{activeDays}</span>
        <span className="text-[10px] text-stone-500">d</span>
      </div>

      <a
        href={corporationUrl(corporationId)}
        target="_blank"
        rel="noreferrer"
        className="shrink-0"
        title="Open on zKillboard"
      >
        <img src={ZKB_ICON} width="14" height="14" className="external-icon" />
      </a>
    </div>
  );
};
