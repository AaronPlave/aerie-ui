<svelte:options immutable={true} />

<script lang="ts">
  import ChevronDownIcon from '@nasa-jpl/stellar/icons/chevron_down.svg?component';
  import CloseIcon from '@nasa-jpl/stellar/icons/close.svg?component';
  import DuplicateIcon from '@nasa-jpl/stellar/icons/duplicate.svg?component';
  import FilterIcon from '@nasa-jpl/stellar/icons/filter.svg?component';
  import { createEventDispatcher } from 'svelte';
  import { readable } from 'svelte/store';
  import TimelineLineLayerIcon from '../../../../assets/timeline-line-layer.svg?component';
  import TimelineXRangeLayerIcon from '../../../../assets/timeline-x-range-layer.svg?component';
  import { ViewDiscreteLayerColorPresets, ViewLineLayerColorPresets } from '../../../../constants/view';
  import { externalResourceNames, resourceTypes as modelResourceTypes } from '../../../../stores/simulation';
  import { getTimelineSourceCatalog } from '../../../../stores/timelineSourceCatalog';
  import type { SelectedDropdownOptionValue } from '../../../../types/dropdown';
  import type { RadioButtonId } from '../../../../types/radio-buttons';
  import type { TimelineSourceRegistry } from '../../../../types/timelineSource';
  import type {
    ActivityLayer,
    ActivityLayerFilter,
    Axis,
    ChartType,
    ExternalEventLayer,
    ExternalEventLayerFilter,
    Layer,
    ResourceLayerFilter,
  } from '../../../../types/timeline';
  import { isActivityLayer, isExternalEventLayer, isLineLayer, isXRangeLayer } from '../../../../utilities/timeline';
  import {
    getResourceFilterName,
    getSource,
    isDefaultSource,
    resolveActivityLayerSourceId,
    resolveResourceRef,
    toActivityLayerSourceId,
    toResourceLayerFilter,
  } from '../../../../utilities/timelineSources';
  import { tooltip } from '../../../../utilities/tooltip';
  import ColorPresetsPicker from '../../../form/ColorPresetsPicker.svelte';
  import ColorSchemePicker from '../../../form/ColorSchemePicker.svelte';
  import RadioButton from '../../../ui/RadioButtons/RadioButton.svelte';
  import RadioButtons from '../../../ui/RadioButtons/RadioButtons.svelte';
  import SearchableDropdown from '../../../ui/SearchableDropdown.svelte';
  import TimelineEditorLayerSettings from '../TimelineEditorLayerSettings.svelte';
  import ActivityFilterBuilder from './ActivityFilterBuilder.svelte';
  import ExternalEventFilterBuilder from './ExternalEventFilterBuilder.svelte';

  // SPIKE: a non-plan page can supply its own resource catalog; the plan page falls back to the model's.
  const catalog = getTimelineSourceCatalog();
  const resourceTypes = catalog.resourceTypes ?? modelResourceTypes;
  // SPIKE 2: with a source registry, a resource layer is edited as (source, resource).
  const catalogSources = catalog.sources ?? readable<TimelineSourceRegistry | null>(null);

  const emptySpanUtilityMaps = { directiveIdToSpanIdMap: {}, spanIdToChildIdsMap: {}, spanIdToDirectiveIdMap: {} };

  export let layer: Layer;
  export let yAxes: Axis[] = [];

  let activityFilterMenu: ActivityFilterBuilder;
  let color: string = '';
  let colorPresets: string[] = [];
  let externalEventFilterMenu: ExternalEventFilterBuilder;
  let isColorScheme: boolean = false;
  let name: string = '';
  let pickedSourceId: string | null = null;
  let pickedForLayerId: number | null = null;

  const dispatch = createEventDispatcher<{
    activitySourceChange: { filter: ActivityLayerFilter | undefined; sourceId: string | undefined };
    colorChange: { color: string };
    duplicate: void;
    filterChange: { filter: ResourceLayerFilter | ExternalEventLayerFilter };
    remove: void;
    updateChartType: ChartType;
    updateLayer: { property: string; value: string | number | boolean | object | null };
    visibilityChange: void;
  }>();

  $: {
    if (isActivityLayer(layer)) {
      color = layer.activityColor;
      colorPresets = ViewDiscreteLayerColorPresets;
      isColorScheme = false;
    } else if (isLineLayer(layer)) {
      color = layer.lineColor;
      colorPresets = ViewLineLayerColorPresets;
      isColorScheme = false;
    } else if (isXRangeLayer(layer)) {
      color = layer.colorScheme;
      isColorScheme = true;
    } else if (isExternalEventLayer(layer)) {
      color = layer.externalEventColor;
      colorPresets = ViewDiscreteLayerColorPresets;
      isColorScheme = false;
    }
  }

  $: name = getLayerName(layer);

  $: registry = $catalogSources;
  $: defaultSourceId = registry?.defaultSourceId ?? null;
  $: resourceRef = resolveResourceRef(layer.filter.resource, defaultSourceId);
  $: if (pickedForLayerId !== layer.id) {
    // A different layer is being edited: forget the source picked for the previous one.
    pickedForLayerId = layer.id;
    pickedSourceId = null;
  }
  $: selectedSourceId = pickedSourceId ?? resourceRef?.sourceId ?? defaultSourceId;
  $: sourceOptions = getSourceOptions(registry, selectedSourceId);
  $: resourceNames = registry
    ? (registry.sources.find(source => source.id === selectedSourceId)?.resourceTypes ?? [])
        .map(type => type.name)
        .sort()
    : $resourceTypes
        .map(type => type.name)
        .concat($externalResourceNames)
        .sort();

  function getSourceOptions(registry: TimelineSourceRegistry | null, selectedSourceId: string | null) {
    const options = (registry?.sources ?? []).map(source => ({ label: source.label, value: source.id }));
    if (selectedSourceId && !options.find(option => option.value === selectedSourceId)) {
      // The layer points at a source this page does not have; keep it visible rather than rebinding.
      options.push({ label: `${selectedSourceId} (unavailable)`, value: selectedSourceId });
    }
    return options;
  }

  // SPIKE 3: activity layers bind to a source at the layer level; the filter itself is unchanged.
  $: activitySourceId = isActivityLayer(layer) ? resolveActivityLayerSourceId(layer, defaultSourceId) : null;
  $: activitySourceOptions = getActivitySourceOptions(registry, activitySourceId);
  $: activitySource = getSource(registry, activitySourceId);
  // null = use the plan/global stores exactly as before; otherwise the source's own catalog.
  $: activitySourceCatalog =
    registry && !isDefaultSource(activitySourceId, defaultSourceId)
      ? (activitySource?.intervals ?? { intervalTypes: [], spanUtilityMaps: emptySpanUtilityMaps, spans: [] })
      : null;

  function getActivitySourceOptions(registry: TimelineSourceRegistry | null, selectedSourceId: string | null) {
    const options = (registry?.sources ?? [])
      .filter(source => source.hasDirectives || source.intervals !== undefined)
      .map(source => ({ label: source.label, value: source.id }));
    if (selectedSourceId && !options.find(option => option.value === selectedSourceId)) {
      options.push({ label: `${selectedSourceId} (unavailable)`, value: selectedSourceId });
    }
    return options;
  }

  function onActivitySourceChange(event: Event) {
    if (!isActivityLayer(layer)) {
      return;
    }
    const sourceId = (event.currentTarget as HTMLSelectElement).value;
    const newSource = getSource(registry, sourceId);
    const typeNames = new Set((newSource?.intervals?.intervalTypes ?? []).map(type => type.name));
    // Type selections only mean something within one source's catalog: drop those the new source does
    // not declare instead of silently carrying them over. Rule-based filters (dynamic/other) are kept.
    // Exception: if that would drop *every* selected type, keep them. The filter model has no "match
    // nothing", and an emptied static_types means "all types", which would silently widen the layer.
    const filter = layer.filter.activity;
    const keptTypes = (filter?.static_types ?? []).filter(type => typeNames.has(type));
    const prunedFilter: ActivityLayerFilter | undefined = filter
      ? {
          ...filter,
          static_types: keptTypes.length || !filter.static_types?.length ? keptTypes : filter.static_types,
          type_subfilters: Object.fromEntries(
            Object.entries(filter.type_subfilters ?? {}).filter(([type]) => typeNames.has(type)),
          ),
        }
      : filter;
    dispatch('activitySourceChange', {
      filter: prunedFilter,
      sourceId: toActivityLayerSourceId(sourceId, defaultSourceId),
    });
  }

  function onSourceChange(event: Event) {
    const sourceId = (event.currentTarget as HTMLSelectElement).value;
    pickedSourceId = sourceId;
    const currentName = resourceRef?.name ?? '';
    const newSource = registry?.sources.find(source => source.id === sourceId);
    const keepName = !!newSource?.resourceTypes.find(type => type.name === currentName);
    dispatch('filterChange', { filter: toResourceLayerFilter(keepName ? currentName : '', sourceId, defaultSourceId) });
  }

  function onResourceChange(values: SelectedDropdownOptionValue[]) {
    const resourceName = values.length && values[0] !== null ? `${values[0]}` : '';
    dispatch('filterChange', {
      filter: registry ? toResourceLayerFilter(resourceName, selectedSourceId, defaultSourceId) : resourceName,
    });
  }

  function getLayerName(layer: Layer) {
    if (isActivityLayer(layer)) {
      name = layer.name;
    } else if (isLineLayer(layer)) {
      name = layer.name || getResourceFilterName(layer.filter.resource) || 'Line Layer';
    } else if (isXRangeLayer(layer)) {
      name = layer.name || getResourceFilterName(layer.filter.resource) || 'X-Range Layer';
    } else if (isExternalEventLayer(layer)) {
      name = layer.name || 'Events Layer';
    }
    return name;
  }

  function toggleActivityFilterMenu() {
    activityFilterMenu.toggle();
  }

  function toggleExternalEventFilterMenu() {
    externalEventFilterMenu.toggle();
  }

  function getActivityLayerFilterCount(layer: ActivityLayer) {
    return (
      (layer.filter.activity?.static_types?.length ?? 0) +
      (layer.filter.activity?.dynamic_type_filters?.length ?? 0) +
      (layer.filter.activity?.other_filters?.length ?? 0) +
      (layer.filter.activity?.type_subfilters ? Object.keys(layer.filter.activity?.type_subfilters).length : 0)
    );
  }

  function getExternalEventLayerFilterCount(layer: ExternalEventLayer) {
    return (
      (layer.filter.externalEvent?.static_types?.length ?? 0) +
      (layer.filter.externalEvent?.dynamic_type_filters?.length ?? 0) +
      (layer.filter.externalEvent?.other_filters?.length ?? 0) +
      (layer.filter.externalEvent?.type_subfilters
        ? Object.keys(layer.filter.externalEvent?.type_subfilters).length
        : 0)
    );
  }

  function onUpdateChartType(event: CustomEvent<{ id: RadioButtonId }>) {
    dispatch('updateChartType', event.detail.id as ChartType);
  }
</script>

<div class="timeline-layer-editor">
  <div class="left">
    <div class="color">
      {#if isColorScheme}
        <ColorSchemePicker
          layout="compact"
          value={color}
          on:input={({ detail: { value } }) => dispatch('colorChange', { color: value })}
        />
      {:else}
        <ColorPresetsPicker
          value={color}
          presetColors={colorPresets}
          on:input={({ detail: { value } }) => dispatch('colorChange', { color: value })}
        />
      {/if}
    </div>
    {#if isActivityLayer(layer)}
      {@const filterCount = getActivityLayerFilterCount(layer)}
      {#if activitySourceOptions.length > 1}
        <!-- SPIKE 3: the layer's source slot; the filter builder then works against that source's catalog. -->
        <select
          aria-label="Activity source"
          class="st-select layer-source"
          value={activitySourceId}
          on:change={onActivitySourceChange}
          use:tooltip={{ content: 'Source', placement: 'top' }}
        >
          {#each activitySourceOptions as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      {/if}
      <ActivityFilterBuilder
        layerName={layer.name}
        sourceCatalog={activitySourceCatalog}
        filter={layer.filter.activity}
        on:filterChange
        on:rename={({ detail: { name: newName } }) => dispatch('updateLayer', { property: 'name', value: newName })}
        bind:this={activityFilterMenu}
      >
        <button
          aria-label="Toggle activity filter builder modal"
          slot="trigger"
          on:click|stopPropagation={toggleActivityFilterMenu}
          class="st-button icon w-full"
          style:position="relative"
          use:tooltip={{
            content: `Filter Activities${filterCount > 0 ? ` (${filterCount} applied)` : ''}`,
            placement: 'top',
          }}
        >
          <div class="layer-name st-select">
            <div class="layer-name-text">
              {name || 'Activity Layer'}
            </div>
            <div class="layer-name-badge">
              {#if filterCount > 0}
                <div>{filterCount}</div>
              {/if}
              <FilterIcon />
            </div>
          </div>
        </button>
      </ActivityFilterBuilder>
    {:else if isLineLayer(layer) || isXRangeLayer(layer)}
      {#if sourceOptions.length > 1}
        <!-- SPIKE 2: explicit source control; only shown when the timeline has more than one source. -->
        <select
          aria-label="Resource source"
          class="st-select layer-source"
          value={selectedSourceId}
          on:change={onSourceChange}
          use:tooltip={{ content: 'Source', placement: 'top' }}
        >
          {#each sourceOptions as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      {/if}
      <SearchableDropdown
        maxListHeight="400px"
        selectedOptionLabel={layer.name}
        selectTooltip={resourceRef?.name || 'Select Resource'}
        showPlaceholderOption={false}
        className="w-full"
        placeholder="Select Resource"
        searchPlaceholder="Filter resources"
        selectedOptionValues={resourceRef?.name ? [resourceRef.name] : []}
        options={resourceNames.map(resourceName => ({ display: resourceName, value: resourceName }))}
        on:change={({ detail: values }) => onResourceChange(values)}
      >
        <ChevronDownIcon slot="icon" />
      </SearchableDropdown>
    {:else if isExternalEventLayer(layer)}
      {@const filterCount = getExternalEventLayerFilterCount(layer)}
      <ExternalEventFilterBuilder
        layerName={layer.name}
        filter={layer.filter.externalEvent}
        on:filterChange
        on:rename={({ detail: { name: newName } }) => dispatch('updateLayer', { property: 'name', value: newName })}
        bind:this={externalEventFilterMenu}
      >
        <button
          aria-label="Toggle external event filter builder modal"
          slot="trigger"
          on:click|stopPropagation={toggleExternalEventFilterMenu}
          class="st-button icon w-full"
          style:position="relative"
          use:tooltip={{
            content: `Filter External Events${filterCount > 0 ? ` (${filterCount} applied)` : ''}`,
            placement: 'top',
          }}
        >
          <div class="layer-name st-select">
            <div class="layer-name-text">
              {name || 'External Event Layer'}
            </div>
            <div class="layer-name-badge">
              {#if filterCount > 0}
                <div>{filterCount}</div>
              {/if}
              <FilterIcon />
            </div>
          </div></button
        >
      </ExternalEventFilterBuilder>
    {/if}
  </div>
  <div class="actions">
    {#if isLineLayer(layer) || isXRangeLayer(layer)}
      <RadioButtons selectedButtonId={layer.chartType} on:select-radio-button={onUpdateChartType}>
        <RadioButton use={[[tooltip, { content: 'Line', placement: 'top' }]]} id="line">
          <TimelineLineLayerIcon />
        </RadioButton>
        <RadioButton use={[[tooltip, { content: 'X-Range', placement: 'top' }]]} id="x-range">
          <TimelineXRangeLayerIcon />
        </RadioButton>
      </RadioButtons>
    {/if}
    {#if !isActivityLayer(layer) && !isExternalEventLayer(layer)}
      <TimelineEditorLayerSettings
        {layer}
        on:input={event => dispatch('updateLayer', { property: event.detail.name, value: event.detail.value })}
        on:delete={() => dispatch('remove')}
        {yAxes}
      />
    {/if}
    <button
      on:click|stopPropagation={() => dispatch('duplicate')}
      use:tooltip={{ content: 'Duplicate', placement: 'top' }}
      class="st-button icon"
    >
      <DuplicateIcon />
    </button>
    <button
      on:click|stopPropagation={() => dispatch('remove')}
      use:tooltip={{ content: 'Delete', placement: 'top' }}
      class="st-button icon"
    >
      <CloseIcon />
    </button>
  </div>
</div>

<style>
  .timeline-layer-editor {
    align-items: center;
    display: flex;
    gap: 8px;
    justify-content: space-between;
    padding: 4px 0px;
  }

  .left,
  .actions {
    align-items: center;
    display: flex;
    gap: 8px;
  }

  :global(.actions > .st-button) {
    color: var(--st-gray-50);
  }

  .left {
    flex: 1;
  }

  .layer-source {
    max-width: 45%;
  }

  .actions {
    display: flex;
    gap: 4px;
  }

  .color {
    display: flex;
    height: min-content;
  }

  .layer-name {
    align-items: center;
    display: flex;
    flex: 1;
    gap: 4px;
    justify-content: space-between;
    overflow: hidden;
    padding: 0px 4px;
  }

  .layer-name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .layer-name-badge {
    align-items: center;
    display: flex;
    gap: 4px;
  }

  .layer-name-badge > div {
    background: var(--st-gray-15);
    border-radius: 2px;
    min-width: 16px;
    padding: 0px 4px;
  }
</style>
