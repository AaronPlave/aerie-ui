import type { Readable } from 'svelte/store';
import type { TimelineResourceState } from '../stores/timelineResourceStatus';
import type { ActivityType } from './activity';
import type { User } from './app';
import type { ExternalEventType } from './external-event';
import type { Plan } from './plan';
import type { ResourceType, SimulationDataset } from './simulation';
import type { ExternalEventSourceScope, TimelineItemType } from './timeline';

/**
 * A timeline source is the analysis-facing adapter over one existing domain object (the plan's simulation,
 * one plan_dataset, the plan's external events). It does not replace those objects; it only normalizes how
 * the timeline and the Sources browser consume them.
 *
 * Three identities are kept apart:
 * - the source id, which a view layer stores and which stays stable ("plan", "external-dataset:12");
 * - the concrete object behind it (the plan's simulation role, plan_dataset (plan, 12), ...);
 * - the data revision currently served (`revisionKey`, e.g. the selected simulation dataset).
 */
export type TimelineSourceId = string;

export type TimelineSourceKind = 'plan' | 'externalDataset' | 'externalEvents';

export type TimelineResourceSubscription = {
  store: Readable<TimelineResourceState>;
  unsubscribe: () => void;
};

export type TimelineResourceSubscriptionContext = {
  plan: Plan;
  simulationDataset: SimulationDataset | null;
  user: User | null;
};

export type TimelineResourceCapability = {
  catalog: ResourceType[];
  loading: boolean;
  /** Identifies the data revision served; resource requests restart when it changes. Null when there is no data. */
  revisionKey: string | null;
  subscribe: (name: string, context: TimelineResourceSubscriptionContext) => TimelineResourceSubscription;
  /** Message to show for layers bound to this source while it has no data (e.g. not simulated yet). */
  unavailableReason?: string;
};

/**
 * Interval (activity/span) data. Only the Plan source has it today, and it is rendered through the existing
 * directive + span path, so this capability carries the catalogs rather than the data.
 */
export type TimelineIntervalCapability = {
  /** Types that can be filtered on (for the Plan, the model's activity types). */
  catalog: ActivityType[];
  hasDirectives: boolean;
  loading: boolean;
  /** Interval types present in the current data, with instance counts. */
  present: { count: number; name: string }[];
};

/** External events keep their own domain structure; the browser renders it through `browserNodes`. */
export type TimelineEventCapability = {
  catalog: ExternalEventType[];
  loading: boolean;
};

export type TimelineSource = {
  browserNodes: SourceBrowserNode[];
  description?: string;
  events?: TimelineEventCapability;
  /** User-facing grouping in the Sources browser ("Plan", "External Datasets", ...). */
  group: string;
  id: TimelineSourceId;
  intervals?: TimelineIntervalCapability;
  kind: TimelineSourceKind;
  label: string;
  resources?: TimelineResourceCapability;
};

export type TimelineSourceRegistry = {
  /** True while the lists that sources are built from are still loading, so a missing source is not yet an error. */
  loading: boolean;
  sources: TimelineSource[];
};

/**
 * What adding a Sources browser item does. These map onto the existing timeline item types, so dropping and
 * "add to row" reuse the existing layer creation paths; `sourceId` is what makes the new layer source-bound.
 */
export type SourceBrowserAction = {
  /** External events only: the external source(s) the browser node represents, carried into the layer filter. */
  externalSources?: ExternalEventSourceScope[];
  item: TimelineItemType;
  sourceId: TimelineSourceId | null;
  typeName: 'activity' | 'resource' | 'externalEvent';
};

/** A normalized node that source adapters produce and the browser renders without knowing the domain. */
export type SourceBrowserNode = {
  action?: SourceBrowserAction;
  badge?: string;
  children?: SourceBrowserNode[];
  /** Shown instead of children when there are none. */
  emptyMessage?: string;
  id: string;
  kind: 'source' | 'group' | 'item';
  label: string;
  tags?: string[];
  tooltip?: string;
};
