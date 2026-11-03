import { ReactNode, useMemo, useState } from 'react';
import { PrimeIcons } from 'primereact/api';
import { Widget } from '@/hooks/Mapper/components/mapInterface/components';
import { getSystemStaticInfo, useLoadSystemStatic } from '@/hooks/Mapper/mapRootProvider/hooks/useLoadSystemStatic';
import { useDesktopActiveSystem } from '@/hooks/Mapper/desktop/useDesktopActiveSystem';
import { getEffectLabel } from '@/hooks/Mapper/desktop/systemTitle';
import { isWormholeSpace } from '@/hooks/Mapper/components/map/helpers/isWormholeSpace';
import { LayoutEventBlocker, TooltipPosition, WdImgButton } from '@/hooks/Mapper/components/ui-kit';
import { JSPACE_ICON } from '@/hooks/Mapper/icons';
import { useJspaceCorporations } from './hooks/useJspaceCorporations';
import { JspaceCorporationRow } from './components/JspaceCorporationRow';
import { JspaceCorporation, JspaceCorporationsResponse, JspaceSystem } from './types';

const VISIBLE_CORPORATIONS = 3;

const CenteredHint = ({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'error' }) => (
  <div className="flex h-full w-full items-center justify-center px-2">
    <span className={`select-none text-center text-sm ${tone === 'error' ? 'text-red-400' : 'text-stone-400/80'}`}>
      {children}
    </span>
  </div>
);

const classLabel = (value?: string) => {
  const name = value?.trim();
  if (!name) {
    return null;
  }
  // "c4" -> "C4"; the special drifter systems use words, not class ids.
  return /^c\d+$/i.test(name) ? name.toUpperCase() : name.charAt(0).toUpperCase() + name.slice(1);
};

const staticLabel = (value?: string) => {
  const parts = (value ?? '')
    .split('/')
    .map(part => part.trim().toUpperCase())
    .filter(Boolean);

  return parts.length > 0 ? parts.join('/') : null;
};

const JspaceHeader = ({
  system,
  fallbackName,
  onRefresh,
}: {
  system?: JspaceSystem;
  fallbackName?: string;
  onRefresh: () => void;
}) => {
  const systemClass = classLabel(system?.class);
  const statics = staticLabel(system?.static);

  // The dataset occasionally stores "Pulsar, Shattere"; the shattered flag is
  // already its own badge, so only the effect name matters here.
  const effectName = system?.effect?.split(',')[0]?.trim();
  const effect = effectName && effectName.toLowerCase() !== 'shattered' ? getEffectLabel(effectName) : null;
  const systemName = system?.name ?? fallbackName;
  const link = systemName ? `https://jspace.20mm.cn/search/${encodeURIComponent(systemName.toLowerCase())}` : null;

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
      <span className="shrink-0 text-stone-400">J-Space</span>
      {systemName && (
        <span className="shrink-0 font-medium text-stone-100" title={systemName}>
          {systemName}
        </span>
      )}
      {system?.name_zh && (
        <span className="shrink-0 text-[10px] text-stone-500" title={system.name_zh}>
          {system.name_zh}
        </span>
      )}

      <span className="flex shrink-0 flex-wrap items-center gap-1 text-[10px]">
        {systemClass && <span className="rounded bg-stone-800/80 px-1 py-0.5 text-stone-200">{systemClass}</span>}
        {statics && <span className="text-stone-400">{statics}</span>}
        {effect && <span className="rounded bg-indigo-500/10 px-1 py-0.5 text-indigo-300">{effect}</span>}
        {system?.shattered && (
          <span className="rounded bg-fuchsia-500/10 px-1 py-0.5 text-fuchsia-300">破碎洞</span>
        )}
      </span>

      {/* Keep the link and refresh in the left-to-right flow: on a narrow
          window they wrap onto the next line instead of being pushed off the
          right edge by a `ml-auto`/`justify-between` layout. */}
      <LayoutEventBlocker className="flex shrink-0 items-center gap-1">
        {link && (
          <a href={link} rel="noreferrer" target="_blank" title="Open in J-Space Helper">
            <img src={JSPACE_ICON} width="14" height="14" className="external-icon" />
          </a>
        )}
        <WdImgButton
          className={PrimeIcons.REFRESH}
          onClick={onRefresh}
          tooltip={{ content: 'Refresh', position: TooltipPosition.top }}
        />
      </LayoutEventBlocker>
    </div>
  );
};

const JspaceCorporationList = ({
  corporations,
  lookbackDays,
}: {
  corporations: JspaceCorporation[];
  lookbackDays: number;
}) => {
  const [expanded, setExpanded] = useState(false);
  const canExpand = corporations.length > VISIBLE_CORPORATIONS;
  const visible = expanded ? corporations : corporations.slice(0, VISIBLE_CORPORATIONS);

  return (
    <>
      <div className="flex shrink-0 items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wide text-stone-500">
        <span>Top {corporations.length} by active days</span>
        <span>{lookbackDays}d</span>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-auto">
        {visible.map(corporation => (
          <JspaceCorporationRow key={corporation.corporation_id} corporation={corporation} />
        ))}
      </div>

      {canExpand && (
        <button
          type="button"
          className="shrink-0 border-t border-stone-800/60 px-2 py-1 text-[10px] text-stone-400 hover:bg-stone-800/40 hover:text-stone-100"
          onClick={() => setExpanded(value => !value)}
        >
          {expanded ? `Show top ${VISIBLE_CORPORATIONS}` : `Show all ${corporations.length}`}
        </button>
      )}
    </>
  );
};

type JspaceContentProps = {
  systemId?: string;
  knownNonWormhole: boolean;
  current: JspaceCorporationsResponse | null;
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

const JspaceContent = ({ systemId, knownNonWormhole, current, isLoading, error, reload }: JspaceContentProps) => {
  if (!systemId) {
    return <CenteredHint>System is not selected</CenteredHint>;
  }

  if (knownNonWormhole || current?.reason === 'not_jspace') {
    return (
      <CenteredHint>
        J-Space Helper only covers wormhole space.
        <br />
        This system is not in J-space.
      </CenteredHint>
    );
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

  // No cached answer for this system yet: either the request is in flight or
  // the reload has not started (first render after a system switch).
  if (!current?.system) {
    return <CenteredHint>Loading J-Space data...</CenteredHint>;
  }

  const system = current.system;
  const corporations = current.corporations ?? [];

  return (
    <div className={`flex h-full w-full flex-col ${isLoading ? 'opacity-60' : ''}`}>
      {corporations.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-2">
          <span className="select-none text-center text-sm text-stone-400/80">
            No corporation activity in the last {current.lookback_days ?? 60} days
          </span>
        </div>
      ) : (
        <JspaceCorporationList
          key={system.id}
          corporations={corporations}
          lookbackDays={current.lookback_days ?? 60}
        />
      )}
    </div>
  );
};

export const JspaceWidget = () => {
  const { systemId } = useDesktopActiveSystem();

  // Detached desktop windows have no map, so nothing else preloads static data.
  const systemsToLoad = useMemo(() => (systemId ? [systemId] : []), [systemId]);
  useLoadSystemStatic({ systems: systemsToLoad });

  const systemStaticInfo = systemId ? getSystemStaticInfo(Number(systemId)) : undefined;
  const systemName = systemStaticInfo?.solar_system_name;

  const knownNonWormhole =
    systemStaticInfo?.system_class != null && !isWormholeSpace(Number(systemStaticInfo.system_class));

  // Skip the round trip only when static data already says this is not
  // J-space. If static data has not loaded yet, let the server decide.
  const { data, isLoading, error, reload } = useJspaceCorporations({
    systemId,
    enabled: !!systemId && !knownNonWormhole,
  });

  // Ignore an answer that belongs to a previously selected system: the reload
  // for the new system runs in an effect, one render later.
  const current =
    data?.system && systemId && Number(data.system.id) === Number(systemId) ? data : null;

  return (
    <Widget
      label={
        <JspaceHeader
          system={current?.system}
          fallbackName={systemName}
          onRefresh={() => void reload()}
        />
      }
    >
      <JspaceContent
        systemId={systemId}
        knownNonWormhole={knownNonWormhole}
        current={current}
        isLoading={isLoading}
        error={error}
        reload={reload}
      />
    </Widget>
  );
};
