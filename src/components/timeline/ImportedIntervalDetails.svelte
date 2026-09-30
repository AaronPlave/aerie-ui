<svelte:options immutable={true} />

<!--
  SPIKE 3: minimal read-only details for a span from a non-default timeline source. Deliberately not
  ActivitySpanForm: that form reads the plan's model types, simulation dataset and directive links.
  A neutral interval-details component like this is the seam for a future generic one.
-->
<script lang="ts">
  import { plugins } from '../../stores/plugins';
  import type { Span } from '../../types/simulation';
  import type { TimelineSourceRegistry } from '../../types/timelineSource';
  import { formatDate } from '../../utilities/time';
  import { getSource, getSpanParent } from '../../utilities/timelineSources';

  export let span: Span;
  export let timelineSources: TimelineSourceRegistry | null = null;

  $: source = getSource(timelineSources, span.sourceId);
  $: parent = getSpanParent(span, timelineSources);
  $: children = (source?.intervals?.spanUtilityMaps.spanIdToChildIdsMap[span.span_id] ?? [])
    .map(id => source?.intervals?.spansMap[id])
    .filter((child): child is Span => !!child);
  $: rows = [
    ['Source', source?.label ?? span.sourceId ?? ''],
    ['Bound to', source?.binding ?? ''],
    ['Type', span.type],
    ['Span ID', `${span.span_id} (within ${span.sourceId})`],
    ['Start', formatDate(new Date(span.startMs), $plugins.time.primary.format)],
    ['End', formatDate(new Date(span.endMs), $plugins.time.primary.format)],
    ['Duration', span.duration ?? ''],
    ['Parent', parent ? `${parent.type} (${parent.span_id})` : span.parent_id === null ? 'None' : `${span.parent_id}`],
    ['Children', children.map(child => `${child.type} (${child.span_id})`).join(', ') || 'None'],
  ];
</script>

<div class="imported-interval" data-testid="imported-interval-details">
  <div class="st-typography-medium title">Imported Interval (read-only)</div>
  <dl>
    {#each rows as [label, value]}
      <dt class="st-typography-label">{label}</dt>
      <dd>{value}</dd>
    {/each}
  </dl>
  <div class="st-typography-label">Attributes</div>
  <pre>{JSON.stringify(span.attributes, null, 2)}</pre>
</div>

<style>
  .imported-interval {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
  }

  dl {
    display: grid;
    gap: 4px 12px;
    grid-template-columns: max-content 1fr;
    margin: 0;
  }

  dd {
    margin: 0;
    word-break: break-word;
  }

  pre {
    background: var(--st-gray-10);
    font-size: 11px;
    margin: 0;
    overflow: auto;
    padding: 8px;
  }
</style>
