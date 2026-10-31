export type JspaceCorporation = {
  corporation_id: number;
  corporation_name: string;
  corporation_icon?: string;
  alliance_id?: number;
  alliance_name?: string;
  alliance_icon?: string;
  active_days: number;
  kb_count: number;
};

export type JspaceSystem = {
  id: number;
  name: string;
  name_zh?: string;
  class?: string;
  static?: string;
  effect?: string;
  shattered: boolean;
};

export type JspaceCorporationsResponse = {
  system?: JspaceSystem;
  reason?: 'not_jspace' | 'no_data' | string;
  lookback_days?: number;
  corporations?: JspaceCorporation[];
  error?: string;
};
