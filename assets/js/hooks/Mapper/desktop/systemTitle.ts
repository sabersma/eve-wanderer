import { WORMHOLES_ADDITIONAL_INFO } from '@/hooks/Mapper/components/map/constants';
import { SolarSystemStaticInfoRaw, WormholeDataRaw } from '@/hooks/Mapper/types';

/**
 * Chinese shorthand for the six wormhole system effects. EVE players use these
 * names far more than the English ones ("护盾" instead of "Pulsar"), and the
 * native title bar has no room for both.
 */
const EFFECT_LABELS: Record<string, string> = {
  'Black Hole': '黑洞',
  Pulsar: '护盾',
  Magnetar: '磁星',
  'Cataclysmic Variable': '遥修',
  'Wolf-Rayet Star': '小武器',
  'Red Giant': '红巨星',
};

// Statics are shown as the destination class code after the system class:
// C4 with static C3 and C5 becomes "C4-35". K-space statics get their initial.
const STATIC_CLASS_CODES: Record<number, string> = {
  7: 'H',
  8: 'L',
  9: 'N',
  12: 'T',
  13: '13',
  14: 'D',
  15: 'D',
  16: 'D',
  17: 'D',
  18: 'D',
};

const staticClassCode = (dest: string): { code: string; order: number } | null => {
  const info = WORMHOLES_ADDITIONAL_INFO[dest];
  if (!info) {
    return null;
  }

  const classId = info.wormholeClassID;
  if (classId >= 1 && classId <= 6) {
    return { code: String(classId), order: classId };
  }

  const code = STATIC_CLASS_CODES[classId] ?? info.shortName;
  return code ? { code, order: classId } : null;
};

export const getSystemClassLabel = (
  info: Pick<SolarSystemStaticInfoRaw, 'class_title' | 'statics'> | undefined,
  wormholesData: Record<string, WormholeDataRaw> | undefined,
) => {
  const classTitle = info?.class_title?.trim();
  if (!classTitle) {
    return null;
  }

  const statics = (info?.statics ?? [])
    .map(name => wormholesData?.[name])
    .filter((wormhole): wormhole is WormholeDataRaw => !!wormhole)
    .flatMap(wormhole => wormhole.dest ?? [])
    .map(staticClassCode)
    .filter((item): item is { code: string; order: number } => !!item)
    .sort((left, right) => left.order - right.order);

  const codes: string[] = [];
  for (const { code } of statics) {
    if (!codes.includes(code)) {
      codes.push(code);
    }
  }

  return codes.length > 0 ? `${classTitle}-${codes.join('')}` : classTitle;
};

export const getEffectLabel = (effectName: string | null | undefined) => {
  const name = effectName?.trim();
  if (!name) {
    return null;
  }
  return EFFECT_LABELS[name] ?? name;
};

/** Shattered, drifter and Thera systems get their own trailing column. */
export const getSpecialSystemLabel = (
  info: Pick<SolarSystemStaticInfoRaw, 'is_shattered' | 'system_class'> | undefined,
) => {
  if (!info) {
    return null;
  }
  if (info.is_shattered || info.system_class === 13) {
    return '破碎洞';
  }
  if (info.system_class >= 14 && info.system_class <= 18) {
    return '流浪洞';
  }
  if (info.system_class === 12) {
    return '席拉洞';
  }
  return null;
};
