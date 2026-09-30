<svelte:options immutable={true} />

<!--
  Resource types declared by the plan's mission model (Plan catalog). Actual resource data, including profiles
  from external datasets, is browsed under Sources. Layers created here are bound to the Plan's simulation
  (see getUpdatedLayerWithFilters).
-->
<script lang="ts">
  import { resourceTypes, resourceTypesLoading } from '../stores/simulation';
  import type { ResourceType } from '../types/simulation';
  import type { TimelineItemType } from '../types/timeline';
  import ResourceListPrefix from './ResourceListPrefix.svelte';
  import TimelineItemList from './TimelineItemList.svelte';

  let resourceDataTypes: string[] = [];

  $: resourceDataTypes = [...new Set($resourceTypes.map(t => t.schema.type))];

  function getFilterValueFromItem(item: TimelineItemType) {
    return (item as ResourceType).schema.type;
  }
</script>

<TimelineItemList
  items={$resourceTypes}
  chartType="line"
  typeName="resource"
  typeNamePlural="Resources"
  filterOptions={resourceDataTypes.map(t => ({ label: t, value: t }))}
  filterName="Data Type"
  {getFilterValueFromItem}
  loading={$resourceTypesLoading}
  let:prop={item}
>
  <ResourceListPrefix {item} />
</TimelineItemList>
