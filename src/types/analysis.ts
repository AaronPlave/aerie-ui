import type { ActivityType } from './activity';
import type { UserId } from './app';
import type { SourceResource } from './importedSource';
import type { ValueSchema } from './schema';
import type { TimeRange } from './timeline';
import type { TimelineSourceId } from './timelineSource';
import type { ViewDefinition } from './view';

/** What an analysis source reads: an imported revision, or a simulation dataset of any plan. */
export type AnalysisSourceTarget =
  | { kind: 'imported'; revisionId: number }
  | { kind: 'simulation'; simulationDatasetId: number };

/**
 * A source an analysis composes. The analysis references it and never copies its data. `id` is what the analysis's
 * timeline layers bind to; it stays the same if the binding is later pointed at another revision.
 */
export type AnalysisSourceBinding = AnalysisSourceTarget & { id: TimelineSourceId; label?: string };

export type AnalysisDefinition = {
  sources: AnalysisSourceBinding[];
  /** The time window last shown, so reopening the analysis returns to it. */
  timeRange?: TimeRange;
  version: 1;
  /** The existing view definition shape; an analysis uses its timeline, not its plan tables or grid. */
  view: ViewDefinition;
};

export type Analysis = {
  created_at: string;
  definition: AnalysisDefinition;
  id: number;
  name: string;
  owner: UserId;
  updated_at: string;
};

export type AnalysisSlim = Omit<Analysis, 'definition'>;

/** One activity in an analysis. Activity ids are only unique within their source, so the source is part of it. */
export type AnalysisActivityRef = {
  activityId: number;
  sourceId: TimelineSourceId;
};

/** merlin.analysis_activity: activities of every kind of source, in the one shape the activity table reads. */
export type AnalysisActivityRow = {
  activity_id: number;
  category: string | null;
  end_time: string;
  name: string;
  source_kind: 'revision' | 'simulation';
  source_ref: number;
  start_time: string;
  type: string;
};

export type AnalysisActivityType = {
  category: string | null;
  count: number;
  first_start: string | null;
  last_end: string | null;
  /** Each parameter name seen on the type, with the JSON type of its values. */
  parameters: Record<string, 'array' | 'boolean' | 'number' | 'object' | 'string'>;
  type: string;
};

/** An imported revision, as an analysis needs to know it. */
export type AnalysisSourceRevision = {
  activity_types: AnalysisActivityType[];
  coverage_end: string | null;
  coverage_start: string | null;
  id: number;
  resources: SourceResource[];
  source: { id: number; name: string; source_type: string };
  status: 'pending' | 'incomplete' | 'success' | 'failed';
};

/** A simulation dataset of any plan, as an analysis needs to know it. */
export type AnalysisSimulationDataset = {
  dataset: { profiles: { name: string; type: { schema: ValueSchema } }[] } | null;
  dataset_id: number;
  id: number;
  simulation: {
    plan: {
      id: number;
      /** The types the plan's model declares, with their parameters, for filters. */
      mission_model: { activity_types: ActivityType[] } | null;
      name: string;
    } | null;
  } | null;
  simulation_end_time: string | null;
  simulation_start_time: string | null;
  status: string;
};

/** What can be added to an analysis: every imported revision, and every plan's simulation datasets. */
export type AnalysisSourceOptions = {
  plans: {
    id: number;
    name: string;
    simulations: {
      simulation_datasets: {
        id: number;
        simulation_end_time: string | null;
        simulation_start_time: string | null;
        status: string;
      }[];
    }[];
  }[];
  revisions: {
    activity_types_aggregate: { aggregate: { sum: { count: number | null } | null } | null };
    coverage_end: string | null;
    coverage_start: string | null;
    id: number;
    resources_aggregate: { aggregate: { count: number } | null };
    source: { id: number; name: string; source_type: string };
    status: AnalysisSourceRevision['status'];
  }[];
};

/** merlin.source_activity: one imported activity with everything the product recorded about it. */
export type SourceActivity = {
  attributes: Record<string, unknown>;
  category: string | null;
  end_time: string;
  id: number;
  metadata: Record<string, unknown>;
  name: string;
  parameters: Record<string, unknown>;
  revision_id: number;
  source_key: string;
  start_time: string;
  type: string;
};
