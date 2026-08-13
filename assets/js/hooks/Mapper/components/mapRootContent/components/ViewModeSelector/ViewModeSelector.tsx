import { useCallback, useMemo } from 'react';
import { Dropdown } from 'primereact/dropdown';
import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';
import { ViewMode } from '@/hooks/Mapper/mapRootProvider';
import { STATUSES } from '@/hooks/Mapper/components/map/constants';
import { SolarSystemRawType } from '@/hooks/Mapper/types';

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

  // Build dropdown options from available home systems
  const homeOptions = useMemo(
    () =>
      homeSystems.map(s => ({
        label: s.name || s.system_static_info?.solar_system_name || `System ${s.id}`,
        value: s.id,
      })),
    [homeSystems],
  );

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
            onChange={e => update({ selectedHomeSystemId: e.value })}
            placeholder={homeSystems.length === 0 ? '无 Home 星系' : '选择 Home 星系...'}
            disabled={homeSystems.length === 0}
            className={classes.Dropdown}
            panelClassName={classes.DropdownPanel}
          />
          {homeSystems.length === 0 && (
            <span className={classes.NoHomeHint}>请先设置 Home 星系</span>
          )}
        </div>
      )}
    </div>
  );
};
