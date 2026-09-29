// SPIKE (standalone timeline datasets): provisional types for decoupling timeline rendering from
// where its data comes from. Deliberately minimal; see SPIKE_FINDINGS.md in the plandev repo.
import type { Readable } from 'svelte/store';
import type { TimelineResourceState } from '../stores/timelineResourceStatus';
import type { ActivityType } from './activity';
import type { ResourceType, Span } from './simulation';
import type { TimeRange } from './timeline';

export type TimelineResourceSubscription = {
  store: Readable<TimelineResourceState>;
  unsubscribe: () => void;
};

/**
 * What a timeline row needs in order to draw resource layers: "give me the resource called X".
 * Rows no longer decide which dataset, simulation, or plan_dataset a resource lives in.
 */
export interface TimelineResourceProvider {
  /**
   * Identity of the data behind this provider (e.g. the active simulation's dataset).
   * When it changes, rows drop their subscriptions and re-request every resource.
   */
  readonly key: string;
  /**
   * `range` is part of the contract so a future provider can do bounded/viewport queries.
   * Every provider in the spike ignores it and fetches the whole profile.
   */
  subscribeResource(name: string, range?: TimeRange): TimelineResourceSubscription;
}

/**
 * Standalone metadata record (merlin.standalone_dataset). Spike terminology.
 */
export type StandaloneDataset = {
  dataset_id: number;
  end_time: string;
  id: number;
  name: string;
  start_time: string;
};

/**
 * Catalog a non-plan page can hand to timeline editor components that otherwise read the
 * plan's mission-model stores. Missing fields fall back to the existing global stores.
 */
export type TimelineSourceCatalog = {
  /** Interval (span) types. Shaped as ActivityType because that's what the filter UI consumes. */
  intervalTypes?: Readable<ActivityType[]>;
  maxTimeRange?: Readable<TimeRange>;
  resourceTypes?: Readable<ResourceType[]>;
  spans?: Readable<Span[] | null>;
};
