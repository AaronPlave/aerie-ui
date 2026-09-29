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
   * SPIKE 2: which source this provider serves; what resource layers bind to (ResourceRef.sourceId).
   * Stable for the life of a view. Distinct from `key`: the plan's simulation source keeps its
   * sourceId across re-simulation while its key (the dataset it currently reads) changes.
   */
  readonly sourceId: TimelineSourceId;
  /**
   * `range` is part of the contract so a future provider can do bounded/viewport queries.
   * Every provider in the spike ignores it and fetches the whole profile.
   */
  subscribeResource(name: string, range?: TimeRange): TimelineResourceSubscription;
}

export type TimelineSourceId = string;

/**
 * SPIKE 2: one independent source of resources a timeline can draw from.
 * `provider` is null while the source is not ready (e.g. no simulation yet); `resourceTypes` is the
 * source's own catalog, whose entries are stamped with `sourceId` unless it is the default source.
 */
export type TimelineSource = {
  id: TimelineSourceId;
  label: string;
  provider: TimelineResourceProvider | null;
  resourceTypes: ResourceType[];
  resourceTypesLoading?: boolean;
};

/**
 * SPIKE 2: every source one timeline can see. Legacy (bare-string) resource layers and
 * unstamped resource records resolve against `defaultSourceId`.
 */
export type TimelineSourceRegistry = {
  defaultSourceId: TimelineSourceId | null;
  sources: TimelineSource[];
};

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
  /** SPIKE 2: source-specific resource catalogs + providers. Supersedes `resourceTypes` when present. */
  sources?: Readable<TimelineSourceRegistry>;
  spans?: Readable<Span[] | null>;
};
