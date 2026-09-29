<svelte:options immutable={true} />

<!--
  SPIKE (standalone timeline datasets): view one merlin.dataset on the real timeline with no Plan,
  mission model, or simulation dataset. See SPIKE_FINDINGS.md in the plandev repo.
-->
<script lang="ts">
  import { page } from '$app/stores';
  import { keyBy } from 'lodash-es';
  import { onDestroy, onMount } from 'svelte';
  import { derived, writable } from 'svelte/store';
  import Nav from '../../../components/app/Nav.svelte';
  import PageTitle from '../../../components/app/PageTitle.svelte';
  import ActivitySpanForm from '../../../components/activity/ActivitySpanForm.svelte';
  import StandaloneTimelineItemsPanel from '../../../components/StandaloneTimelineItemsPanel.svelte';
  import TimelineEditorPanel from '../../../components/timeline/form/TimelineEditorPanel.svelte';
  import StandaloneDatasetTimelinePanel from '../../../components/timeline/StandaloneDatasetTimelinePanel.svelte';
  import CssGrid from '../../../components/ui/CssGrid.svelte';
  import CssGridGutter from '../../../components/ui/CssGridGutter.svelte';
  import Panel from '../../../components/ui/Panel.svelte';
  import { viewTimeRange } from '../../../stores/plan';
  import { plugins } from '../../../stores/plugins';
  import { setTimelineSourceCatalog } from '../../../stores/timelineSourceCatalog';
  import { getUserStore } from '../../../stores/user';
  import {
    initializeView,
    resetOriginalView,
    resetView,
    selectedRowId,
    view,
    viewIsModified,
    viewSetSelectedTimeline,
  } from '../../../stores/views';
  import type { Span, SpanId } from '../../../types/simulation';
  import type { TimeRange } from '../../../types/timeline';
  import { createSpanUtilityMaps } from '../../../utilities/activities';
  import {
    clearStandaloneView,
    createDefaultStandaloneView,
    demoIntervalTypeDescriptors,
    getIntervalTypesFromSpans,
    loadStandaloneView,
    saveStandaloneView,
  } from '../../../utilities/standaloneDataset';
  import { formatDate } from '../../../utilities/time';
  import type { PageData } from './$types';

  export let data: PageData;

  const user = getUserStore();

  const { initialSpans, resourceTypes, standaloneDataset } = data;
  const maxTimeRange: TimeRange = {
    end: new Date(standaloneDataset.end_time).getTime(),
    start: new Date(standaloneDataset.start_time).getTime(),
  };

  const resourceTypesStore = writable(resourceTypes);
  const spansStore = writable<Span[] | null>(initialSpans);
  // Spike 1b: no descriptors (types known only by span.type). Spike 1c: ?intervalDescriptors=demo.
  const intervalDescriptors =
    $page.url.searchParams.get('intervalDescriptors') === 'demo' ? demoIntervalTypeDescriptors : [];
  const intervalTypesStore = derived(spansStore, spans => getIntervalTypesFromSpans(spans, intervalDescriptors));
  const spansMap = keyBy(initialSpans, 'span_id');
  const spanUtilityMaps = createSpanUtilityMaps(initialSpans);

  // Editor components that normally read mission-model / plan stores read this instead.
  setTimelineSourceCatalog({
    intervalTypes: intervalTypesStore,
    maxTimeRange: writable(maxTimeRange),
    resourceTypes: resourceTypesStore,
    spans: spansStore,
  });

  let selectedSpanId: SpanId | null = null;
  let saveMessage = '';

  $: selectedSpan = selectedSpanId !== null ? (initialSpans.find(s => s.span_id === selectedSpanId) ?? null) : null;
  $: coverage = `${formatDate(new Date(maxTimeRange.start), $plugins.time.primary.format)} – ${formatDate(
    new Date(maxTimeRange.end),
    $plugins.time.primary.format,
  )}`;

  onMount(async () => {
    viewTimeRange.set(maxTimeRange);
    const savedView = await loadStandaloneView(standaloneDataset.id);
    initializeView(savedView ?? createDefaultStandaloneView(standaloneDataset, resourceTypes));
    viewSetSelectedTimeline(0);
    saveMessage = savedView ? 'Loaded saved configuration' : 'Default configuration';
  });

  onDestroy(() => {
    // The view/time stores are global singletons shared with the plan page.
    view.set(null);
    selectedRowId.set(null);
    viewTimeRange.set({ end: 0, start: 0 });
  });

  function onSave() {
    if ($view && saveStandaloneView(standaloneDataset.id, $view)) {
      resetOriginalView();
      saveMessage = `Saved locally at ${new Date().toLocaleTimeString()}`;
    } else {
      saveMessage = 'Unable to save (browser storage unavailable)';
    }
  }

  function onResetToDefault() {
    clearStandaloneView(standaloneDataset.id);
    initializeView(createDefaultStandaloneView(standaloneDataset, resourceTypes));
    viewSetSelectedTimeline(0);
    saveMessage = 'Reset to default configuration';
  }
</script>

<PageTitle title={standaloneDataset.name} subTitle="Standalone Dataset (spike)" />

<CssGrid rows="var(--nav-header-height) calc(100vh - var(--nav-header-height))">
  <Nav>
    <div class="dataset-title" slot="title">
      <span class="st-typography-medium dataset-name">{standaloneDataset.name}</span>
      <span class="st-typography-body coverage" data-testid="standalone-coverage">{coverage}</span>
    </div>
    <div class="dataset-actions" slot="right">
      <span class="st-typography-label save-message">{saveMessage}</span>
      <button class="st-button secondary" disabled={!$viewIsModified} on:click={resetView}>Revert</button>
      <button class="st-button secondary" on:click={onResetToDefault}>Reset to Default</button>
      <button class="st-button" disabled={!$viewIsModified} on:click={onSave}>Save View</button>
    </div>
  </Nav>

  <!-- Timeline/list/editor components assume a view exists (e.g. timelines[0].rows). -->
  {#if $view}
    <CssGrid columns="280px 3px 1fr 3px 420px">
      <StandaloneTimelineItemsPanel intervalTypes={$intervalTypesStore} {resourceTypes} />
      <CssGridGutter track={1} type="column" />
      <StandaloneDatasetTimelinePanel
        {maxTimeRange}
        {resourceTypes}
        {selectedSpanId}
        spans={initialSpans}
        {standaloneDataset}
        user={$user}
        on:selectSpan={({ detail }) => (selectedSpanId = detail)}
      />
      <CssGridGutter track={3} type="column" />
      <div class="right-column">
        <div class="right-column-editor"><TimelineEditorPanel gridSection="RightTop" /></div>
        <div class="right-column-details">
          <Panel>
            <svelte:fragment slot="header">
              <div class="st-typography-medium">Selected Interval</div>
            </svelte:fragment>
            <svelte:fragment slot="body">
              {#if selectedSpan}
                <dl class="span-details" data-testid="standalone-span-details">
                  <dt>Type</dt>
                  <dd>{selectedSpan.type}</dd>
                  <dt>Span ID</dt>
                  <dd>{selectedSpan.span_id}</dd>
                  <dt>Parent</dt>
                  <dd>{selectedSpan.parent_id ?? '—'}</dd>
                  <dt>Start</dt>
                  <dd>{formatDate(new Date(selectedSpan.startMs), $plugins.time.primary.format)}</dd>
                  <dt>End</dt>
                  <dd>{formatDate(new Date(selectedSpan.endMs), $plugins.time.primary.format)}</dd>
                  <dt>Duration</dt>
                  <dd>{selectedSpan.duration}</dd>
                </dl>
                <div class="st-typography-label">Attributes</div>
                <pre class="attributes">{JSON.stringify(selectedSpan.attributes, null, 2)}</pre>
                <!-- The plan page's span form, fed interval types instead of model activity types. -->
                <div class="st-typography-label">ActivitySpanForm (reused)</div>
                <ActivitySpanForm
                  activityTypes={$intervalTypesStore}
                  span={selectedSpan}
                  {spansMap}
                  {spanUtilityMaps}
                  user={$user}
                />
              {:else}
                <div class="st-typography-label empty">Click an interval on the timeline</div>
              {/if}
            </svelte:fragment>
          </Panel>
        </div>
      </div>
    </CssGrid>
  {/if}
</CssGrid>

<style>
  .dataset-title {
    align-items: baseline;
    color: var(--st-gray-10);
    display: flex;
    gap: 12px;
  }

  .dataset-name {
    color: var(--st-gray-10);
  }

  .coverage {
    color: var(--st-gray-40);
  }

  .dataset-actions {
    align-items: center;
    display: flex;
    gap: 8px;
  }

  .save-message {
    color: var(--st-gray-40);
  }

  .dataset-actions button {
    white-space: nowrap;
  }

  .right-column {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .right-column-editor {
    border-bottom: 1px solid var(--st-gray-20);
    flex: 3 1 0;
    min-height: 0;
    overflow: auto;
  }

  .right-column-details {
    flex: 2 1 0;
    min-height: 0;
    overflow: auto;
  }

  .span-details {
    display: grid;
    gap: 4px 12px;
    grid-template-columns: max-content auto;
    margin: 0 0 8px;
  }

  .span-details dt {
    color: var(--st-gray-60);
  }

  .span-details dd {
    margin: 0;
  }

  .attributes {
    background: var(--st-gray-10);
    border-radius: 4px;
    font-size: 11px;
    padding: 8px;
    white-space: pre-wrap;
  }

  .empty {
    color: var(--st-gray-50);
  }
</style>
