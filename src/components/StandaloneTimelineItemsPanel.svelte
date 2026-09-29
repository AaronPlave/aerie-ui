<svelte:options immutable={true} />

<!--
  SPIKE (standalone timeline datasets): TimelineItemsPanel without the plan.
  ResourceList/ActivityList read $allResourceTypes / $planModelActivityTypes and plan permissions for
  upload/create; here the catalog is passed in and upload/create are simply absent.
-->
<script lang="ts">
  import DirectiveAndSpanIcon from '../assets/timeline-directive-and-span.svg?component';
  import TimelineLineLayerIcon from '../assets/timeline-line-layer.svg?component';
  import type { ActivityType } from '../types/activity';
  import type { ResourceType } from '../types/simulation';
  import type { TimelineItemType } from '../types/timeline';
  import ResourceListPrefix from './ResourceListPrefix.svelte';
  import TimelineItemList from './TimelineItemList.svelte';
  import Panel from './ui/Panel.svelte';
  import Tab from './ui/Tabs/Tab.svelte';
  import TabPanel from './ui/Tabs/TabPanel.svelte';
  import Tabs from './ui/Tabs/Tabs.svelte';

  export let intervalTypes: ActivityType[] = [];
  export let resourceTypes: ResourceType[] = [];

  $: resourceDataTypes = [...new Set(resourceTypes.map(t => t.schema.type))];
  $: subsystems = [
    ...new Map(
      intervalTypes.filter(t => t.subsystem_tag).map(t => [t.subsystem_tag?.id, t.subsystem_tag] as const),
    ).values(),
  ];

  function getResourceFilterValue(item: TimelineItemType) {
    return (item as ResourceType).schema.type;
  }

  function getIntervalFilterValue(item: TimelineItemType) {
    return (item as ActivityType).subsystem_tag?.id ?? '';
  }
</script>

<Panel padBody={false}>
  <svelte:fragment slot="header">
    <div class="st-typography-medium">Dataset Contents</div>
  </svelte:fragment>

  <svelte:fragment slot="body">
    <Tabs class="timeline-items-tabs" tabListClassName="timeline-items-tabs-list">
      <svelte:fragment slot="tab-list">
        <Tab class="timeline-items-tab text-xs"><TimelineLineLayerIcon /> Resources</Tab>
        <Tab class="timeline-items-tab text-xs"><DirectiveAndSpanIcon /> Intervals</Tab>
      </svelte:fragment>
      <TabPanel>
        <TimelineItemList
          items={resourceTypes}
          chartType="line"
          typeName="resource"
          typeNamePlural="Resources"
          filterOptions={resourceDataTypes.map(t => ({ label: t, value: t }))}
          filterName="Data Type"
          getFilterValueFromItem={getResourceFilterValue}
          let:prop={item}
        >
          <ResourceListPrefix {item} />
        </TimelineItemList>
      </TabPanel>
      <TabPanel>
        <TimelineItemList
          items={intervalTypes}
          chartType="activity"
          typeName="activity"
          typeNamePlural="Activities"
          filterOptions={subsystems.map(s => ({ color: s?.color || '', label: s?.name ?? '', value: s?.id ?? '' }))}
          filterName="Subsystem"
          getFilterValueFromItem={getIntervalFilterValue}
          hasCreatePermission={false}
        />
      </TabPanel>
    </Tabs>
  </svelte:fragment>
</Panel>
