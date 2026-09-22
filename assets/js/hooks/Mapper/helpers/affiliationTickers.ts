/**
 * 军团 / 联盟缩写的统一展示规则：角色名[军团缩写][联盟缩写]
 *
 * NPC 军团的判定：EVE 把 NPC 军团固定分配在 1,000,000–1,999,999 这个 ID 区间
 * （玩家军团从 98,000,000 起），所以用 ID 区间判断即可，后端不需要额外下发标志位。
 */
export const NPC_CORPORATION_LABEL = 'NPC军团';
export const NO_ALLIANCE_LABEL = '无联盟';

const NPC_CORPORATION_ID_MIN = 1_000_000;
const NPC_CORPORATION_ID_MAX = 1_999_999;

export const isNpcCorporationId = (corporationId?: number | null): boolean =>
  corporationId != null && corporationId >= NPC_CORPORATION_ID_MIN && corporationId <= NPC_CORPORATION_ID_MAX;

export type AffiliationSource = {
  corporation_id?: number | null;
  corporation_ticker?: string | null;
  alliance_id?: number | null;
  alliance_ticker?: string | null;
};

/** 军团缩写：NPC 军团不展示自己的 ticker，统一显示为 NPC军团。 */
export const getCorporationTickerText = (corporationId?: number | null, corporationTicker?: string | null): string =>
  isNpcCorporationId(corporationId) ? NPC_CORPORATION_LABEL : (corporationTicker ?? '');

/**
 * 联盟缩写：没有联盟时显示为无联盟。
 * 部分 payload（如连接卡片里的 passage）只带 ticker 不带 id，所以 ticker 优先判定。
 */
export const getAllianceTickerText = (allianceId?: number | null, allianceTicker?: string | null): string => {
  if (allianceTicker) {
    return allianceTicker;
  }

  return allianceId ? '' : NO_ALLIANCE_LABEL;
};

/** 拼接 [军团缩写][联盟缩写]，直接跟在角色名后面使用。 */
export const getAffiliationLabel = (source: AffiliationSource): string => {
  const corporation = getCorporationTickerText(source.corporation_id, source.corporation_ticker);
  const alliance = getAllianceTickerText(source.alliance_id, source.alliance_ticker);

  return `[${corporation}][${alliance}]`;
};
