import { describe, expect, it } from 'vitest';
import { Status } from '../enums/status';
import {
  getGeneratedProductFileName,
  getSequenceGenerationErrors,
  getSequenceGenerationFailureSummary,
  getSequenceGenerationStatus,
  isValidSequenceId,
} from './sequence-generation';

describe('sequence-generation utilities', () => {
  it('maps generation statuses', () => {
    expect(getSequenceGenerationStatus('pending')).toEqual(Status.Pending);
    expect(getSequenceGenerationStatus('incomplete')).toEqual(Status.Incomplete);
    expect(getSequenceGenerationStatus('success')).toEqual(Status.Complete);
    expect(getSequenceGenerationStatus('failed')).toEqual(Status.Failed);
    expect(getSequenceGenerationStatus(null)).toBeNull();
  });

  it('summarizes missing expansion by activity type', () => {
    expect(
      getSequenceGenerationFailureSummary({
        diagnostics: [
          { activityType: 'Calibration', code: 'MISSING_EXPANSION', message: 'x', severity: 'error' },
          { activityType: 'Slew', code: 'MISSING_EXPANSION', message: 'y', severity: 'error' },
          { code: 'SIMULATION_PLAN_REVISION_DIFFERS', message: 'z', severity: 'info' },
        ],
        error: { code: 'MISSING_EXPANSION', message: 'x' },
      }),
    ).toEqual('Missing expansion for Calibration, Slew');
  });

  it('falls back to the first error message', () => {
    expect(
      getSequenceGenerationFailureSummary({
        diagnostics: [
          { code: 'SIMULATION_PLAN_REVISION_DIFFERS', message: 'info', severity: 'info' },
          { code: 'EXPANSION_FAILED', message: 'Template failed', severity: 'error' },
        ],
        error: null,
      }),
    ).toEqual('Template failed');
    expect(getSequenceGenerationFailureSummary({ diagnostics: [], error: { code: 'X', message: 'boom' } })).toEqual(
      'boom',
    );
  });

  it('filters errors', () => {
    expect(getSequenceGenerationErrors(null)).toEqual([]);
    expect(
      getSequenceGenerationErrors([
        { code: 'A', message: 'a', severity: 'error' },
        { code: 'B', message: 'b', severity: 'warning' },
      ]),
    ).toEqual([{ code: 'A', message: 'a', severity: 'error' }]);
  });

  it('names generated product files by language', () => {
    expect(getGeneratedProductFileName({ language: 'SeqN', seq_id: 'E17' })).toEqual('E17.seqN.txt');
    expect(getGeneratedProductFileName({ language: 'STOL', seq_id: 'E17' })).toEqual('E17.stol');
    expect(getGeneratedProductFileName({ language: 'Text', seq_id: 'E17' })).toEqual('E17.txt');
  });

  it('validates sequence ids', () => {
    expect(isValidSequenceId('E17_MINI')).toBe(true);
    expect(isValidSequenceId('   ')).toBe(false);
  });
});
