export type JspaceActivityLevel = 'high' | 'medium' | 'low' | 'none';

export type JspaceHourWindow = {
  start: number;
  end: number;
};

export type JspaceCorporation = {
  corporation_id: number;
  corporation_name: string;
  corporation_icon?: string;
  alliance_id?: number;
  alliance_name?: string;
  alliance_icon?: string;
  active_days: number;
  kb_count: number;
  last_active_days?: number;
  activity_level?: JspaceActivityLevel;
  /** Inferred UTC offset of the corporation's main active timezone. */
  timezone_offset?: number;
  /** Inferred peak activity window, inclusive, in UTC hours. */
  active_window_utc?: JspaceHourWindow;
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
