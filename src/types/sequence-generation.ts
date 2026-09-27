/**
 * First-class sequence Generations. A Generation is one immutable attempt to generate sequence products from one
 * resolved set of inputs; a retry always creates a new Generation.
 */

export type SequenceGenerationStatus = 'pending' | 'incomplete' | 'success' | 'failed';

export type SequenceGenerationSelection =
  | { ids: number[]; type: 'activity-directives' }
  | { ids: number[]; type: 'simulated-activities' }
  | { filterId: number; timeRangeEnd?: string | null; timeRangeStart?: string | null; type: 'filter' };

export type GenerateSequenceRequest = {
  metadata?: Record<string, unknown>;
  planId: number;
  selection: SequenceGenerationSelection;
  sequenceId: string;
  simulationDatasetId?: number | null;
};

export type SequenceGenerationDiagnostic = {
  activityType?: string;
  code: string;
  details?: Record<string, unknown>;
  directiveIds?: number[];
  message: string;
  severity: 'error' | 'warning' | 'info';
  sourceActivityIds?: number[];
  templateId?: number;
};

export type GenerateSequenceResponse = {
  diagnostics: SequenceGenerationDiagnostic[];
  generatedProductIds: number[];
  generationId: number;
  status: SequenceGenerationStatus;
};

export type SequenceGenerationCoverage = {
  activities: number;
  activityTypes: string[];
  expandable: number;
  missing: number;
  missingActivityTypes: string[];
};

export type SequenceGenerationTemplateSnapshot = {
  activityType: string;
  definition?: string;
  definitionHash: string;
  language: string;
  name: string;
  parcelId: number | null;
  templateId: number;
};

export type SequenceGenerationSourceSnapshot = {
  activities?: {
    activityType: string;
    directiveId: number | null;
    id: number;
    startOffset: string;
    startTime: string;
  }[];
  activityCount?: number;
  identifiers: { datasetId: number | null; planId: number; simulationDatasetId: number; simulationId: number };
  provenance: 'complete' | 'partial';
  revisions: {
    currentPlanRevision: number;
    datasetRevision: number | null;
    modelRevision: number;
    planRevision: number;
    simulationRevision: number;
    simulationTemplateRevision: number | null;
  };
  selection: {
    filter?: { filter: unknown; id: number; modelId: number; name: string | null };
    requestedDirectiveIds?: number[];
    type: SequenceGenerationSelection['type'];
  };
  sourceType: string;
  time: {
    planStartTime: string;
    selectionTimeRange: { end: string; start: string } | null;
    simulationEndTime: string;
    simulationStartTime: string;
  };
  unavailable: string[];
};

export type SequenceGenerationExpansionSnapshot = {
  coverage: SequenceGenerationCoverage;
  generator: { builder: string | null; expansion: string; name: string; version: string };
  language: string | null;
  model: { id: number; mission: string; name: string; revision: number; version: string };
  parcels: {
    channelDictionary: { id: number; mission: string; version: string } | null;
    commandDictionary: { id: number; mission: string; version: string } | null;
    name: string;
    parcelId: number;
    sequenceAdaptation: { contentHash: string; id: number; name: string } | null;
  }[];
  templates: SequenceGenerationTemplateSnapshot[];
};

export type GenerateSequencePreflightResponse = {
  diagnostics: SequenceGenerationDiagnostic[];
  expansion: SequenceGenerationExpansionSnapshot | null;
  ok: boolean;
  source: SequenceGenerationSourceSnapshot | null;
};

export type GeneratedProductSourceBlock = {
  activityType: string;
  directiveId: number | null;
  expansion: string;
  index: number;
  sourceActivityId: number;
  startOffset: string;
  startTime: string;
  templateHash: string;
  templateId: number;
};

export type GeneratedProductSlim = {
  created_at: string;
  generation_id: number;
  id: number;
  language: string;
  output_hash: string;
  product_key: string;
  seq_id: string;
};

export type GeneratedProduct = GeneratedProductSlim & {
  metadata: Record<string, unknown>;
  rendered_output: string;
  source_blocks: GeneratedProductSourceBlock[];
};

export type SequenceGeneration = {
  completed_at: string | null;
  diagnostics: SequenceGenerationDiagnostic[];
  error: { code: string; message: string } | null;
  expansion_snapshot: SequenceGenerationExpansionSnapshot | null;
  id: number;
  plan_id: number;
  products: GeneratedProductSlim[];
  request_snapshot: GenerateSequenceRequest;
  requested_at: string;
  requested_by: string | null;
  requested_seq_id: string;
  simulation_dataset_id: number | null;
  source_snapshot: SequenceGenerationSourceSnapshot | null;
  status: SequenceGenerationStatus;
};

/** The subset of a Generation shown in generation history lists. */
export type SequenceGenerationSlim = Omit<SequenceGeneration, 'expansion_snapshot' | 'source_snapshot'> & {
  coverage: SequenceGenerationCoverage | null;
};
