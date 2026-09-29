<svelte:options immutable={true} />

<!--
  SPIKE (standalone timeline datasets): the plan-free sibling of TimelinePanel.svelte.
  Same Timeline.svelte and view-store wiring, but every input comes from one standalone dataset:
  no $plan, $simulation, $simulationDataset, activity directive, or constraint stores.
-->
<script lang="ts">
  import { keyBy } from 'lodash-es';
  import { createEventDispatcher } from 'svelte';
  import { viewTimeRange } from '../../stores/plan';
  import { yAxesWithScaleDomainsCache } from '../../stores/simulation';
  import {
    timelineInteractionMode,
    timelineLockStatus,
    view,
    viewSetSelectedRow,
    viewUpdateRow,
    viewUpdateTimeline,
  } from '../../stores/views';
  import type { User } from '../../types/app';
  import type { ResourceType, Span, SpanId, SpansMap } from '../../types/simulation';
  import type {
    ActivityOptions,
    Axis,
    MouseDown,
    Row,
    TimeRange,
    Timeline as TimelineType,
  } from '../../types/timeline';
  import type { StandaloneDataset, TimelineResourceProvider } from '../../types/timelineSource';
  import { createSpanUtilityMaps } from '../../utilities/activities';
  import effects from '../../utilities/effects';
  import { createStandaloneTimelineResourceProvider } from '../../utilities/timelineResourceProviders';
  import Panel from '../ui/Panel.svelte';
  import PanelHeaderActions from '../ui/PanelHeaderActions.svelte';
  import Timeline from './Timeline.svelte';
  import TimelineViewControls from './TimelineViewControls.svelte';

  export let maxTimeRange: TimeRange;
  export let resourceTypes: ResourceType[] = [];
  export let selectedSpanId: SpanId | null = null;
  export let spans: Span[] = [];
  export let standaloneDataset: StandaloneDataset;
  export let user: User | null;

  const dispatch = createEventDispatcher<{ selectSpan: SpanId | null }>();

  let decimate = true;
  let interpolateHoverValue = false;
  let limitTooltipToLine = false;
  let showTimelineTooltip = true;
  let timelineId: number = 0;
  let timeline: TimelineType | undefined;
  let timelines: TimelineType[] = [];
  let timelineRef: Timeline;
  let resourceProvider: TimelineResourceProvider;
  let spansMap: SpansMap = {};

  $: resourceProvider = createStandaloneTimelineResourceProvider(standaloneDataset, user);
  $: spansMap = keyBy(spans, 'span_id');
  $: spanUtilityMaps = createSpanUtilityMaps(spans);

  $: timelines = $view?.definition.plan.timelines || [];
  $: timeline = timelines.find(t => t.id === timelineId);

  function onMouseDown(event: CustomEvent<MouseDown>) {
    const { spans: clickedSpans } = event.detail;
    dispatch('selectSpan', clickedSpans?.length ? clickedSpans[0].span_id : null);
  }

  function onToggleActivityComposition(event: CustomEvent<{ composition: ActivityOptions['composition']; row: Row }>) {
    const {
      detail: { row, composition },
    } = event;
    viewUpdateRow(
      'discreteOptions',
      { ...row.discreteOptions, activityOptions: { ...row.discreteOptions.activityOptions, composition } },
      timelineId,
      row.id,
    );
  }

  function editRow(row: Row) {
    // Unlike TimelinePanel, no grid panel toggling: the editor is always shown on this page.
    viewSetSelectedRow(row.id);
  }

  function onDuplicateRow(event: CustomEvent<Row>) {
    if (timeline) {
      const newRow = effects.duplicateTimelineRow(event.detail, timeline, timelines);
      if (newRow) {
        editRow(newRow);
      }
    }
  }

  function onInsertRow(event: CustomEvent<Row>) {
    if (timeline) {
      const newRow = effects.insertTimelineRow(event.detail, timeline, timelines);
      if (newRow) {
        editRow(newRow);
      }
    }
  }

  function onUpdateYAxes(event: CustomEvent<{ axes: Axis[]; id: number }>) {
    const {
      detail: { axes, id },
    } = event;
    $yAxesWithScaleDomainsCache = { ...$yAxesWithScaleDomainsCache, [id]: axes };
  }
</script>

<Panel padBody={false}>
  <svelte:fragment slot="header">
    <div class="st-typography-medium timeline-title">Timeline</div>
    <PanelHeaderActions>
      <div class="header-actions timeline-icon-tray">
        <TimelineViewControls
          {maxTimeRange}
          viewTimeRange={$viewTimeRange}
          {decimate}
          hasUpdateDirectivePermission={false}
          {interpolateHoverValue}
          {limitTooltipToLine}
          {showTimelineTooltip}
          on:toggleDecimation={({ detail }) => (decimate = detail)}
          on:toggleInterpolateHoverValue={({ detail }) => (interpolateHoverValue = detail)}
          on:toggleLimitTooltipToLine={({ detail }) => (limitTooltipToLine = detail)}
          on:toggleTimelineTooltip={({ detail }) => (showTimelineTooltip = detail)}
          on:viewTimeRangeChanged={({ detail }) => timelineRef?.viewTimeRangeChanged(detail)}
        />
      </div>
    </PanelHeaderActions>
  </svelte:fragment>

  <svelte:fragment slot="body">
    <Timeline
      bind:this={timelineRef}
      {decimate}
      {interpolateHoverValue}
      {limitTooltipToLine}
      {showTimelineTooltip}
      activityDirectivesMap={{}}
      initialSpansLoading={false}
      {maxTimeRange}
      planEndTimeDoy=""
      plan={null}
      planStartTimeYmd={standaloneDataset.start_time}
      {resourceProvider}
      {resourceTypes}
      showTimeDisplay
      {timeline}
      timelineInteractionMode={$timelineInteractionMode}
      {selectedSpanId}
      {spanUtilityMaps}
      {spansMap}
      {spans}
      timelineLockStatus={$timelineLockStatus}
      {user}
      viewTimeRange={$viewTimeRange}
      on:mouseDown={onMouseDown}
      on:jumpToSpan={({ detail }) => dispatch('selectSpan', detail)}
      on:toggleActivityComposition={onToggleActivityComposition}
      on:toggleRowExpansion={({ detail: { expanded, rowId } }) =>
        viewUpdateRow('expanded', expanded, timelineId, rowId)}
      on:updateRowHeight={({ detail: { newHeight, rowId, wasAutoAdjusted } }) =>
        viewUpdateRow('height', newHeight, timelineId, rowId, wasAutoAdjusted)}
      on:updateRows={({ detail: rows }) => viewUpdateTimeline('rows', rows, timelineId)}
      on:updateVerticalGuides={({ detail }) => viewUpdateTimeline('verticalGuides', detail, timelineId)}
      on:viewTimeRangeChanged={({ detail }) => ($viewTimeRange = detail)}
      on:editRow={({ detail }) => editRow(detail)}
      on:deleteRow={({ detail }) => effects.deleteTimelineRow(detail, timeline?.rows ?? [], timelineId)}
      on:duplicateRow={onDuplicateRow}
      on:insertRow={onInsertRow}
      on:updateYAxes={onUpdateYAxes}
    />
  </svelte:fragment>
</Panel>

<style>
  .timeline-title {
    padding: 0px 4px;
    user-select: none;
  }

  .header-actions {
    align-items: center;
    display: flex;
    gap: 4px;
    justify-content: center;
  }
</style>
