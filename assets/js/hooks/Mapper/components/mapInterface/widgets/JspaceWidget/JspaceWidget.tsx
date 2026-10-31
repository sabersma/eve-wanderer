import { ReactNode, useMemo } from 'react';
import { PrimeIcons } from 'primereact/api';
import { Widget } from '@/hooks/Mapper/components/mapInterface/components';
import { getSystemStaticInfo, useLoadSystemStatic } from '@/hooks/Mapper/mapRootProvider/hooks/useLoadSystemStatic';
import { useDesktopActiveSystem } from '@/hooks/Mapper/desktop/useDesktopActiveSystem';
import { isWormholeSpace } from '@/hooks/Mapper/components/map/helpers/isWormholeSpace';
import { LayoutEventBlocker, TooltipPosition, WdImgButton } from '@/hooks/Mapper/components/ui-kit';
import { JSPACE_ICON } from '@/hooks/Mapper/icons';
import { useJspaceCorporations } from './hooks/useJspaceCorporations';
import { JspaceCorporationRow } from './components/JspaceCorporationRow';

const CenteredHint = ({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'error' }) => (
  <div className="flex h-full w-full items-center justify-center px-2">
    <span className={`select-none text-center text-sm ${tone === 'error' ? 'text-red-400' : 'text-stone-400/80'}`}>
      {children}
    </span>
  </div>
);

type JspaceContentProps = ReturnType<typeof useJspaceCorporations> & {
  systemId?: string;
  knownNonWormhole: boolean;
};

const JspaceContent = ({ systemId, knownNonWormhole, data, isLoading, error, reload }: JspaceContentProps) => {
  if (!systemId) {
    return <CenteredHint>System is not selected</CenteredHint>;
  }

  // Ignore an answer that belongs to a previously selected system: the reload
  // for the new system runs in an effect, one render later.
  const current = data?.system && Number(data.system.id) === Number(systemId) ? data : null;

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
  if (!current) {
    return <CenteredHint>Loading J-Space data...</CenteredHint>;
  }

  const corporations = current?.corporations ?? [];

  if (corporations.length === 0) {
    return <CenteredHint>No corporation activity in the last {current?.lookback_days ?? 60} days</CenteredHint>;
  }

  return (
    <div className={`flex h-full w-full flex-col ${isLoading ? 'opacity-60' : ''}`}>
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-stone-500">
        Top {corporations.length} by active days · {current?.lookback_days ?? 60}d
      </div>
      <div className="custom-scrollbar min-h-0 flex-1 overflow-auto">
        {corporations.map(corporation => (
          <JspaceCorporationRow key={corporation.corporation_id} corporation={corporation} />
        ))}
      </div>
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

  return (
    <Widget
      label={
        <div className="flex h-full w-full items-center justify-between gap-1 text-xs">
          <div className="flex min-w-0 items-center gap-1">
            <span className="shrink-0 text-stone-400">J-Space</span>
            {systemName && <span className="truncate text-stone-200">{systemName}</span>}
          </div>

          <LayoutEventBlocker className="flex shrink-0 items-center gap-1">
            {systemName && (
              <a
                href={`https://jspace.20mm.cn/search/${systemName.toLowerCase()}`}
                rel="noreferrer"
                target="_blank"
                title="Open in J-Space Helper"
              >
                <img src={JSPACE_ICON} width="14" height="14" className="external-icon" />
              </a>
            )}
            <WdImgButton
              className={PrimeIcons.REFRESH}
              onClick={() => void reload()}
              tooltip={{ content: 'Refresh', position: TooltipPosition.top }}
            />
          </LayoutEventBlocker>
        </div>
      }
    >
      <JspaceContent
        systemId={systemId}
        knownNonWormhole={knownNonWormhole}
        data={data}
        isLoading={isLoading}
        error={error}
        reload={reload}
      />
    </Widget>
  );
};
