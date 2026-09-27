import { Status } from '../enums/status';
import type {
  GeneratedProductSlim,
  SequenceGenerationDiagnostic,
  SequenceGenerationSlim,
  SequenceGenerationStatus,
} from '../types/sequence-generation';

export function getSequenceGenerationStatus(status: SequenceGenerationStatus | undefined | null): Status | null {
  switch (status) {
    case 'pending':
      return Status.Pending;
    case 'incomplete':
      return Status.Incomplete;
    case 'success':
      return Status.Complete;
    case 'failed':
      return Status.Failed;
    default:
      return null;
  }
}

export function getSequenceGenerationErrors(
  diagnostics: SequenceGenerationDiagnostic[] | null | undefined,
): SequenceGenerationDiagnostic[] {
  return (diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error');
}

/** A short, one-line description of why a generation failed. */
export function getSequenceGenerationFailureSummary(generation: Pick<SequenceGenerationSlim, 'diagnostics' | 'error'>) {
  const errors = getSequenceGenerationErrors(generation.diagnostics);
  const missingTypes = errors
    .filter(diagnostic => diagnostic.code === 'MISSING_EXPANSION' && diagnostic.activityType)
    .map(diagnostic => diagnostic.activityType as string);
  if (missingTypes.length > 0) {
    return `Missing expansion for ${missingTypes.join(', ')}`;
  }
  return errors[0]?.message ?? generation.error?.message ?? 'Generation failed';
}

export function getSequenceGenerationActivityCount(generation: SequenceGenerationSlim): number | null {
  return generation.coverage?.activities ?? null;
}

/** Suggested file name for a generated product, e.g. "E17_MINI.seqN.txt". */
export function getGeneratedProductFileName(product: Pick<GeneratedProductSlim, 'language' | 'seq_id'>): string {
  switch (product.language) {
    case 'SeqN':
      return `${product.seq_id}.seqN.txt`;
    case 'STOL':
      return `${product.seq_id}.stol`;
    default:
      return `${product.seq_id}.txt`;
  }
}

/** Is a sequence ID acceptable for generation? */
export function isValidSequenceId(sequenceId: string): boolean {
  return sequenceId.trim().length > 0;
}
