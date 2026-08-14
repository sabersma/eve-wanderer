import { MenuItem } from 'primereact/menuitem';
import { PrimeIcons } from 'primereact/api';
import { useCallback, useRef } from 'react';
import { SolarSystemRawType } from '@/hooks/Mapper/types';
import { getSystemById } from '@/hooks/Mapper/helpers';
import clsx from 'clsx';
import { SOLAR_SYSTEM_CLASS_IDS } from '@/hooks/Mapper/components/map/constants.ts';
import { GRADIENT_MENU_ACTIVE_CLASSES } from '@/hooks/Mapper/constants.ts';
import { LabelsManager } from '@/hooks/Mapper/utils/labelsManager.ts';
import { getSystemStaticInfo } from '@/hooks/Mapper/mapRootProvider/hooks/useLoadSystemStatic';

export const getLabels = (labels: string | null) => (labels ? (labels ?? '').split(',') : []);
export const updateLabels = (labels: string | null, label: string) => {
  const parsedLabels = new Set(getLabels(labels));

  if (parsedLabels.has(label)) {
    parsedLabels.delete(label);
  } else {
    parsedLabels.add(label);
  }

  return [...parsedLabels].join(',');
};

/**
 * 根据星系类型生成标签建议的 code 前缀：
 * C1~C6 -> 1~6，C13 -> 13，HS -> 7，LS -> 8，null -> 9，
 * 三神裔 -> 三神，流浪洞 -> 流浪，席拉 -> 席拉
 */
const getSystemClassCode = (systemClass: number | undefined): string | null => {
  if (systemClass == null) {
    return null;
  }

  if ([1, 2, 3, 4, 5, 6, 7, 8, 9, 13].includes(systemClass)) {
    return String(systemClass);
  }

  if (systemClass === SOLAR_SYSTEM_CLASS_IDS.pochven) {
    return '三神';
  }

  if (
    [
      SOLAR_SYSTEM_CLASS_IDS.sentinel,
      SOLAR_SYSTEM_CLASS_IDS.barbican,
      SOLAR_SYSTEM_CLASS_IDS.vidette,
      SOLAR_SYSTEM_CLASS_IDS.conflux,
      SOLAR_SYSTEM_CLASS_IDS.redoubt,
    ].includes(systemClass)
  ) {
    return '流浪';
  }

  if (systemClass === SOLAR_SYSTEM_CLASS_IDS.thera) {
    return '席拉';
  }

  return null;
};

export const useLabelsMenu = (
  systems: SolarSystemRawType[],
  systemId: string | undefined,
  onSystemLabels: (val: string) => void,
  onCustomLabelDialog: () => void,
): (() => MenuItem[]) => {
  const ref = useRef({ onSystemLabels, systemId, systems, onCustomLabelDialog });
  ref.current = { onSystemLabels, systemId, systems, onCustomLabelDialog };

  return useCallback(() => {
    const { onSystemLabels, systemId, systems, onCustomLabelDialog } = ref.current;
    const system = systemId ? getSystemById(systems, systemId) : undefined;
    const labels = new LabelsManager(system?.labels ?? '');

    if (!system) {
      return [
        {
          label: 'Labels',
          icon: PrimeIcons.BOLT,
          items: [],
        },
      ];
    }

    // 根据当前星系类型生成 custom label 建议（如 C1 -> 1B/1C/1D/K1B/K1C/K1D）
    const staticInfo = systemId ? getSystemStaticInfo(systemId) : undefined;
    const code = getSystemClassCode(staticInfo?.system_class);
    const suggestions = code
      ? [`${code}B`, `${code}C`, `${code}D`, `K${code}`, `K${code}B`, `K${code}C`, `K${code}D`]
      : [];

    return [
      {
        label: 'Labels',
        icon: PrimeIcons.BOOKMARK,
        className: clsx({ [GRADIENT_MENU_ACTIVE_CLASSES]: labels.customLabel.length > 0 }),
        items: [
          ...(labels.customLabel.length > 0
            ? [
                {
                  label: 'Clear custom label',
                  icon: 'pi pi-trash',
                  command: () => {
                    labels.updateCustomLabel('');
                    onSystemLabels(labels.toString());
                  },
                },
              ]
            : []),
          {
            label: 'Custom label',
            icon: 'pi pi-language',
            command: onCustomLabelDialog,
          },
          ...(suggestions.length > 0
            ? [
                { separator: true },
                ...suggestions.map(value => ({
                  label: value,
                  icon: PrimeIcons.BOOKMARK,
                  command: () => {
                    labels.updateCustomLabel(value);
                    onSystemLabels(labels.toString());
                  },
                  className: clsx({ [GRADIENT_MENU_ACTIVE_CLASSES]: labels.customLabel === value }),
                })),
              ]
            : []),
        ],
      },
    ];
  }, []);
};
