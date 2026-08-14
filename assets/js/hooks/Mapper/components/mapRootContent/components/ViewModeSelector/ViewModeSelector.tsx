import { useCallback, useMemo } from 'react';
import { Dropdown } from 'primereact/dropdown';
import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';
import { ViewMode } from '@/hooks/Mapper/mapRootProvider';
import { STATUSES } from '@/hooks/Mapper/components/map/constants';
import { SolarSystemRawType, Commands } from '@/hooks/Mapper/types';
import { emitMapEvent } from '@/hooks/Mapper/events';

import classes from './ViewModeSelector.module.scss';

const VIEW_MODE_OPTIONS = [
  { label: '全部', value: 'all' as ViewMode },
  { label: '按 Home', value: 'home' as ViewMode },
];

export const ViewModeSelector = () => {
  const { data, update } = useMapRootState();
  const { viewMode, selectedHomeSystemId, systems } = data;

  // Collect all systems with status === home
  const homeSystems = useMemo<SolarSystemRawType[]>(
    () => systems.filter(s => s.status === STATUSES.home),
    [systems],
  );

  // Build dropdown options: show alias + solar-system name (e.g. "别名 (J144038)")
  const homeOptions = useMemo(
    () =>
      homeSystems.map(s => {
        const solarSystemName = s.system_static_info?.solar_system_name;
        const alias = s.name;
        const label =
          alias && solarSystemName && alias !== solarSystemName
            ? `${alias} (${solarSystemName})`
            : solarSystemName || alias || `System ${s.id}`;

        return { label, value: s.id };
      }),
    [homeSystems],
  );

  const centerToHome = useCallback((systemId: string | null | undefined) => {
    if (!systemId) return;
    emitMapEvent({ name: Commands.centerSystem, data: systemId });
  }, []);

  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      update({
        viewMode: mode,
        // Reset selected home if switching to 'all'
        ...(mode === 'all' ? { selectedHomeSystemId: null } : {}),
      });
    },
    [update],
  );

  const handleHomeChange = useCallback(
    (systemId: string | null) => {
      update({ selectedHomeSystemId: systemId });
      centerToHome(systemId);
    },
    [update, centerToHome],
  );

  return (
    <div className={classes.ViewModeSelector}>
      <div className={classes.ToggleGroup}>
        {VIEW_MODE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            className={`${classes.ToggleButton} ${viewMode === opt.value ? classes.ToggleButtonActive : ''}`}
            onClick={() => handleViewModeChange(opt.value)}
            title={opt.label}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {viewMode === 'home' && (
        <div className={classes.HomeDropdown}>
          <Dropdown
            value={selectedHomeSystemId}
            options={homeOptions}
            onChange={e => handleHomeChange(e.value)}
            placeholder={homeSystems.length === 0 ? '无 Home 星系' : '选择 Home 星系...'}
            disabled={homeSystems.length === 0}
            className={classes.Dropdown}
            panelClassName={classes.DropdownPanel}
          />
          <button
            className={classes.CenterButton}
            onClick={() => centerToHome(selectedHomeSystemId)}
            disabled={!selectedHomeSystemId}
            title="重置视角到 Home 星系"
          >
            <i className="pi pi-bullseye" />
          </button>
          {homeSystems.length === 0 && (
            <span className={classes.NoHomeHint}>请先设置 Home 星系</span>
          )}
        </div>
      )}
    </div>
  );
};
