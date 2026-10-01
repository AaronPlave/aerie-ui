import type { ResourceValue } from '../types/simulation';

/*
 * Viewport-driven reads of an imported source resource (gateway POST /sources/query). The timeline asks for
 * "enough of this resource to draw this viewport", never for the whole resource.
 *
 * The API speaks integer microseconds since the Unix epoch; the timeline speaks milliseconds.
 */

export const VALUE = 0;
export const NULL = 1;
export const GAP = 2;

/** Samples of one resource in time order (API times, microseconds). */
export type SourceSeries = {
  k?: number[];
  s?: (string | null)[];
  t: number[];
  v?: (number | null)[];
};

export type SourceQueryResult = {
  after: SourceSeries | null;
  approximate: boolean;
  before: SourceSeries | null;
  bucketWidth: number | null;
  error?: string;
  next: number | null;
  representation: 'raw' | 'summary';
  resource: string;
  series: SourceSeries;
};

export type SourceQuery = {
  end: number;
  fidelity: 'display' | 'exact';
  pointBudget: number;
  start: number;
};

export type TimeWindow = { end: number; start: number };

/** A response held for drawing: what it covers (ms) and how finely. */
export type LoadedWindow = TimeWindow & {
  /** Every sample in the window is present (nothing was reduced away). */
  complete: boolean;
  /** Milliseconds of window per point of budget: smaller is finer. */
  resolution: number;
  result: SourceQueryResult;
};

export const VIEWPORT_POLICY = {
  /** Points of budget per pixel of the requested (overscanned) window. */
  budgetPerPixel: 2,
  maxBudget: 8000,
  /** Fraction of the visible width requested on each side, so small pans need no request. */
  overscan: 0.5,
  /** A held window still serves the viewport while its resolution is within this factor of what is needed. */
  resolutionSlack: 2,
};

const MICROS_PER_MS = 1000;

export function toMicros(ms: number): number {
  return Math.round(ms * MICROS_PER_MS);
}

/** The window and budget to request for a visible window `pixels` wide. */
export function planViewportQuery(visible: TimeWindow, pixels: number, policy = VIEWPORT_POLICY): SourceQuery {
  const width = visible.end - visible.start;
  const pad = width * policy.overscan;
  const pointBudget = Math.max(
    2,
    Math.min(policy.maxBudget, Math.round(Math.max(1, pixels) * (1 + 2 * policy.overscan) * policy.budgetPerPixel)),
  );
  const start = toMicros(visible.start - pad);
  const end = Math.max(start + 1, toMicros(visible.end + pad));
  return { end, fidelity: 'display', pointBudget, start };
}

export function toLoadedWindow(query: SourceQuery, result: SourceQueryResult): LoadedWindow {
  return {
    complete: !result.approximate && result.representation === 'raw',
    end: query.end / MICROS_PER_MS,
    resolution: (query.end - query.start) / MICROS_PER_MS / query.pointBudget,
    result,
    start: query.start / MICROS_PER_MS,
  };
}

/** Whether a held window can draw `visible` at `pixels` without a new request. */
export function coversViewport(loaded: LoadedWindow, visible: TimeWindow, pixels: number, policy = VIEWPORT_POLICY) {
  if (loaded.start > visible.start || loaded.end < visible.end) {
    return false;
  }
  if (loaded.complete) {
    return true;
  }
  const needed = (visible.end - visible.start) / Math.max(1, pixels) / policy.budgetPerPixel;
  return loaded.resolution <= needed * policy.resolutionSlack;
}

function append(target: Required<Pick<SourceSeries, 't'>> & SourceSeries, source: SourceSeries, from = 0, to?: number) {
  const end = to ?? source.t.length;
  for (let i = from; i < end; i++) {
    target.t.push(source.t[i]);
    target.v?.push(source.v ? source.v[i] : null);
    target.s?.push(source.s ? source.s[i] : null);
    target.k!.push(source.k ? source.k[i] : VALUE);
  }
}

/**
 * One series from a coarse overview and a finer detail window: overview samples outside the detail's reach,
 * the detail's boundary samples, and the detail's samples. Every element is a real sample, so the result is a
 * time-ordered subset of the resource, and the overview fills whatever the detail does not cover.
 */
export function composeSeries(
  overview: SourceQueryResult | null,
  detail: SourceQueryResult | null,
  numeric: boolean,
): SourceSeries {
  const out: SourceSeries & { k: number[] } = numeric ? { k: [], t: [], v: [] } : { k: [], s: [], t: [] };
  if (!detail) {
    if (overview) {
      append(out, overview.series);
    }
    return out;
  }
  const detailParts = [detail.before, detail.series, detail.after].filter(
    (p): p is SourceSeries => !!p && p.t.length > 0,
  );
  const first = detailParts[0]?.t[0];
  const last = detailParts.length ? detailParts[detailParts.length - 1].t.at(-1)! : undefined;
  const coarse = overview?.series;
  if (coarse && first !== undefined) {
    append(out, coarse, 0, lowerBound(coarse.t, first));
  }
  detailParts.forEach(part => append(out, part));
  if (coarse && last !== undefined) {
    append(out, coarse, upperBound(coarse.t, last));
  } else if (coarse && first === undefined) {
    append(out, coarse);
  }
  return out;
}

function lowerBound(xs: number[], x: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function upperBound(xs: number[], x: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Timeline values for a series, in the shape sampleProfiles produces:
 *  - linear numeric resources: one point per sample, a line between them;
 *  - step (constant) and discrete resources: each sample holds until the next one, drawn as a (start, end) pair,
 *    and the last holds until `holdUntil` (ms);
 *  - a valid null has y = null; a gap also has is_gap.
 */
export function seriesToValues(
  series: SourceSeries,
  { holdUntil, interpolation, numeric }: { holdUntil: number; interpolation: 'linear' | 'constant'; numeric: boolean },
): ResourceValue[] {
  const values: ResourceValue[] = [];
  const n = series.t.length;
  const yAt = (i: number) => {
    const kind = series.k ? series.k[i] : VALUE;
    if (kind !== VALUE) {
      return null;
    }
    return numeric ? (series.v?.[i] ?? null) : (series.s?.[i] ?? null);
  };
  const gapAt = (i: number) => (series.k ? series.k[i] === GAP : false);
  for (let i = 0; i < n; i++) {
    const x = series.t[i] / MICROS_PER_MS;
    const y = yAt(i);
    const is_gap = gapAt(i);
    if (numeric && interpolation === 'linear' && !is_gap) {
      values.push({ x, y });
      continue;
    }
    const nextX = i + 1 < n ? series.t[i + 1] / MICROS_PER_MS : Math.max(x, holdUntil);
    values.push({ is_gap, x, y });
    values.push({ is_gap, x: nextX, y });
  }
  return values;
}
