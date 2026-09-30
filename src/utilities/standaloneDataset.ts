// SPIKE (standalone timeline datasets): helpers for /datasets/[id].
import type { ActivityType } from '../types/activity';
import type { ValueSchema } from '../types/schema';
import type { ResourceType, Span } from '../types/simulation';
import type { Tag } from '../types/tags';
import type { StandaloneDataset } from '../types/timelineSource';
import type { View } from '../types/view';
import { applyViewMigrations, generateDefaultView } from './view';

/**
 * SPIKE 1c: optional richer declarations for interval types, supplied by the source rather than a
 * mission model. Deliberately not called a mission model.
 */
export type IntervalTypeDescriptor = {
  computedAttributes?: ValueSchema;
  description?: string;
  name: string;
  parameters?: Record<string, ValueSchema>;
  subsystem?: string;
};

/**
 * Interval catalog: one entry per distinct span.type. With no descriptors this is the minimal
 * catalog (name only). Descriptors, when present, enrich matching types.
 * Shaped as ActivityType only because the existing filter/list/form UI consumes ActivityType.
 */
export function getIntervalTypesFromSpans(
  spans: Span[] | null,
  descriptors: IntervalTypeDescriptor[] = [],
): ActivityType[] {
  const descriptorsByName = new Map(descriptors.map(d => [d.name, d]));
  // ActivityType.subsystem_tag is a ui tags-table row (numeric id, owner, created_at), so a plain
  // subsystem string has to be wrapped in a synthetic Tag. Negative ids avoid colliding with real tags.
  const subsystemNames = Array.from(new Set(descriptors.map(d => d.subsystem).filter(Boolean) as string[])).sort();
  const subsystemTags = new Map<string, Tag>(
    subsystemNames.map((name, i) => [name, { color: null, created_at: '', id: -(i + 1), name, owner: null }]),
  );
  const names = Array.from(new Set((spans ?? []).map(span => span.type))).sort();
  return names.map(name => {
    const descriptor = descriptorsByName.get(name);
    return {
      computed_attributes_value_schema: descriptor?.computedAttributes ?? { items: {}, type: 'struct' },
      description: descriptor?.description,
      name,
      parameters: Object.fromEntries(
        Object.entries(descriptor?.parameters ?? {}).map(([parameterName, schema], order) => [
          parameterName,
          { order, schema },
        ]),
      ),
      required_parameters: [],
      subsystem_tag: descriptor?.subsystem ? (subsystemTags.get(descriptor.subsystem) ?? null) : null,
    };
  });
}

/**
 * SPIKE 3e: a source-side catalog inferred from normalized span data, not from a mission model:
 * each type's parameters are the union of its spans' `attributes.arguments` keys, typed by value.
 * (Type-level metadata such as a subsystem *tag* cannot be inferred from per-span values.)
 */
export function inferIntervalTypeDescriptors(spans: Span[] | null): IntervalTypeDescriptor[] {
  const byType = new Map<string, Record<string, ValueSchema>>();
  (spans ?? []).forEach(span => {
    const parameters = byType.get(span.type) ?? {};
    Object.entries(span.attributes?.arguments ?? {}).forEach(([name, value]) => {
      if (parameters[name]) {
        return;
      }
      if (typeof value === 'string') {
        parameters[name] = { type: 'string' };
      } else if (typeof value === 'boolean') {
        parameters[name] = { type: 'boolean' };
      } else if (typeof value === 'number') {
        parameters[name] = Number.isInteger(value) ? { type: 'int' } : { type: 'real' };
      }
    });
    byType.set(span.type, parameters);
  });
  return Array.from(byType.entries()).map(([name, parameters]) => ({ name, parameters }));
}

/** Demo descriptors for deployment/spike/standalone_dataset_fixture.sql (enable with ?intervalDescriptors=demo). */
export const demoIntervalTypeDescriptors: IntervalTypeDescriptor[] = [
  {
    description: 'Science observation',
    name: 'OBSERVE',
    parameters: { instrument: { type: 'string' }, target: { type: 'string' } },
    subsystem: 'Science',
  },
  {
    description: 'Downlink pass',
    name: 'DOWNLINK',
    parameters: { rate: { type: 'real' }, station: { type: 'string' } },
    subsystem: 'Telecom',
  },
  {
    computedAttributes: { items: { slewAngle: { type: 'real' } }, type: 'struct' },
    description: 'Attitude slew',
    name: 'SLEW',
    parameters: { from: { type: 'string' }, to: { type: 'string' } },
    subsystem: 'GNC',
  },
];

/**
 * The timeline editor/stores operate on a whole View whose timelines live under definition.plan.
 * A standalone page has no ui.view row, so it synthesizes one (id -1) and keeps it in localStorage.
 */
export function createDefaultStandaloneView(standaloneDataset: StandaloneDataset, resourceTypes: ResourceType[]): View {
  const view = generateDefaultView(resourceTypes.slice(0, 1));
  return { ...view, id: -1, name: `Standalone dataset: ${standaloneDataset.name}`, owner: null };
}

function getStorageKey(standaloneDatasetId: number): string {
  return `plandev.spike.standaloneDataset.${standaloneDatasetId}.view`;
}

export async function loadStandaloneView(standaloneDatasetId: number): Promise<View | null> {
  try {
    const raw = localStorage.getItem(getStorageKey(standaloneDatasetId));
    if (!raw) {
      return null;
    }
    const { migratedView } = await applyViewMigrations(JSON.parse(raw) as View);
    return migratedView ?? null;
  } catch {
    return null;
  }
}

export function saveStandaloneView(standaloneDatasetId: number, view: View): boolean {
  try {
    localStorage.setItem(getStorageKey(standaloneDatasetId), JSON.stringify(view));
    return true;
  } catch {
    return false;
  }
}

export function clearStandaloneView(standaloneDatasetId: number): void {
  try {
    localStorage.removeItem(getStorageKey(standaloneDatasetId));
  } catch {
    // Storage unavailable; nothing to clear.
  }
}
