<svelte:options immutable={true} />

<!--
  The Sources tab: data available to this plan's analysis, grouped by where it comes from. Adding an item
  creates a layer bound to that item's source through the same path as the Plan catalog lists.
-->
<script lang="ts">
  import UploadIcon from '@nasa-jpl/stellar/icons/upload.svg?component';
  import { timelineSources } from '../../stores/timelineSources';
  import { view, viewAddFilterToRow } from '../../stores/views';
  import type { User } from '../../types/app';
  import type { Layer, Row, TimelineItemMetadata } from '../../types/timeline';
  import type { SourceBrowserAction, SourceBrowserNode, TimelineSourceRegistry } from '../../types/timelineSource';
  import { filterSourceBrowserNodes, getSource } from '../../utilities/timelineSources';
  import { tooltip } from '../../utilities/tooltip';
  import ExternalDatasetUpload from '../ExternalDatasetUpload.svelte';
  import SourceBrowserTree from './SourceBrowserTree.svelte';

  export let user: User | null;

  const GROUP_ORDER = ['Plan', 'External Datasets', 'External Events'];
  const EMPTY_GROUP_MESSAGES: Record<string, string> = {
    'External Datasets': 'No external datasets are attached to this plan',
  };

  let expanded: Record<string, boolean> = {};
  let filterText: string = '';
  let isUploadVisible: boolean = false;

  $: rows = $view?.definition.plan.timelines[0]?.rows ?? [];
  $: nodes = filterSourceBrowserNodes(getBrowserNodes($timelineSources), filterText);

  function getBrowserNodes(registry: TimelineSourceRegistry): SourceBrowserNode[] {
    return GROUP_ORDER.map(group => {
      const sources = registry.sources.filter(source => source.group === group);
      // A group holding a single source of the same name shows that source's contents directly.
      const children: SourceBrowserNode[] =
        sources.length === 1 && sources[0].label === group
          ? sources[0].browserNodes
          : sources.map(source => ({
              children: source.browserNodes,
              emptyMessage: source.resources ? 'No resources' : 'No data',
              id: `source:${source.id}`,
              kind: 'source',
              label: source.label,
              tooltip: source.description,
            }));
      return {
        badge: sources.length === 1 ? sources[0].description : `${sources.length}`,
        children,
        emptyMessage: registry.loading ? 'Loading…' : (EMPTY_GROUP_MESSAGES[group] ?? 'Nothing available'),
        id: `group:${group}`,
        kind: 'group',
        label: group,
      };
    });
  }

  function getMetadata(action: SourceBrowserAction): TimelineItemMetadata {
    return {
      sourceId: action.sourceId,
      sourceLabel: action.sourceId ? getSource($timelineSources, action.sourceId)?.label : undefined,
    };
  }

  function onAdd({
    detail: { action, layer, row },
  }: CustomEvent<{ action: SourceBrowserAction; layer?: Layer; row?: Row }>) {
    viewAddFilterToRow([action.item], action.typeName, getMetadata(action), row?.id, layer);
  }

  function onDragStart({ detail: { action, event } }: CustomEvent<{ action: SourceBrowserAction; event: DragEvent }>) {
    if (event.dataTransfer) {
      const payload = { items: [action.item], metadata: getMetadata(action), type: action.typeName };
      event.dataTransfer.setData('text/plain', JSON.stringify(payload));
      event.dataTransfer.dropEffect = 'link';
      event.dataTransfer.effectAllowed = 'link';
    }
  }

  function onToggle({ detail: { id, open } }: CustomEvent<{ id: string; open: boolean }>) {
    expanded = { ...expanded, [id]: !open };
  }
</script>

<div class="source-browser">
  <div class="source-browser-filters">
    <input
      bind:value={filterText}
      class="st-input"
      name="search"
      autocomplete="off"
      placeholder="Filter sources"
      aria-label="Filter sources"
    />
    <button
      class="st-button secondary"
      aria-label="Upload External Dataset"
      on:click={() => (isUploadVisible = !isUploadVisible)}
      use:tooltip={{ content: 'Upload External Dataset' }}
    >
      <UploadIcon />
    </button>
  </div>
  {#if isUploadVisible}
    <ExternalDatasetUpload {user} on:close={() => (isUploadVisible = false)} />
  {/if}
  <div class="source-browser-tree" role="tree" aria-label="Sources">
    <SourceBrowserTree
      {expanded}
      forceExpanded={!!filterText.trim()}
      {nodes}
      {rows}
      on:add={onAdd}
      on:dragstart={onDragStart}
      on:toggle={onToggle}
    />
  </div>
</div>

<style>
  .source-browser {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .source-browser-filters {
    align-items: center;
    display: flex;
    gap: 8px;
    padding: 8px;
  }

  .source-browser-filters .st-input {
    flex: 1;
  }

  .source-browser-tree {
    flex: 1;
    overflow: auto;
    padding-bottom: 8px;
  }
</style>
