<svelte:options immutable={true} />

<script lang="ts">
  import CloseIcon from '@nasa-jpl/stellar/icons/close.svg?component';
  import UploadIcon from '@nasa-jpl/stellar/icons/upload.svg?component';
  import { plan } from '../stores/plan';
  import { readable } from 'svelte/store';
  import { allResourceTypes, resourceTypesLoading, simulationDatasetId } from '../stores/simulation';
  import { getTimelineSourceCatalog } from '../stores/timelineSourceCatalog';
  import type { User } from '../types/app';
  import type { ResourceType } from '../types/simulation';
  import type { TimelineItemType } from '../types/timeline';
  import type { TimelineSourceRegistry } from '../types/timelineSource';
  import effects from '../utilities/effects';
  import { permissionHandler } from '../utilities/permissionHandler';
  import { featurePermissions } from '../utilities/permissions';
  import { tooltip } from '../utilities/tooltip';
  import ResourceListPrefix from './ResourceListPrefix.svelte';
  import TimelineItemList from './TimelineItemList.svelte';
  import Input from './form/Input.svelte';

  export let user: User | null;

  const uploadPermissionError: string = `You do not have permission to upload resources.`;

  let resourceDataTypes: string[] = [];
  let hasUploadPermission: boolean = false;
  let isUploadVisible: boolean = false;
  let useSelectedSimulation: boolean = false;
  let uploadFiles: FileList | undefined;
  let uploadFileInput: HTMLInputElement;
  let loading: boolean = false;

  // SPIKE 2: with more than one source, browse one source's catalog at a time. Items from a
  // non-default source carry sourceId, which survives the drag/drop JSON payload and "add to row".
  const catalogSources = getTimelineSourceCatalog().sources ?? readable<TimelineSourceRegistry | null>(null);
  let selectedSourceId: string | null = null;
  $: registry = $catalogSources;
  $: if (registry && !registry.sources.find(source => source.id === selectedSourceId)) {
    selectedSourceId = registry.defaultSourceId;
  }
  $: selectedSource = registry?.sources.find(source => source.id === selectedSourceId) ?? null;
  $: items = selectedSource ? selectedSource.resourceTypes : $allResourceTypes;
  $: resourceDataTypes = [...new Set(items.map(t => t.schema.type))];
  $: loading = selectedSource ? !!selectedSource.resourceTypesLoading : $resourceTypesLoading;
  $: if (user !== null && $plan !== null) {
    hasUploadPermission = featurePermissions.externalResources.canCreate(user, $plan);
  }

  function getFilterValueFromItem(item: TimelineItemType) {
    return (item as ResourceType).schema.type;
  }

  function onShowUpload() {
    isUploadVisible = true;
  }

  function onHideUpload() {
    isUploadVisible = false;
  }

  async function onUpload() {
    if (uploadFiles !== undefined) {
      if ($plan && uploadFiles?.length) {
        await effects.uploadExternalDataset(
          $plan,
          uploadFiles,
          user,
          useSelectedSimulation ? $simulationDatasetId : undefined,
        );
      }
      uploadFileInput.value = '';
      uploadFiles = undefined;
    }
  }
</script>

{#if registry && registry.sources.length > 1}
  <div class="resource-source">
    <label class="st-typography-label" for="resource-source-select">Source</label>
    <select id="resource-source-select" class="st-select w-full" bind:value={selectedSourceId}>
      {#each registry.sources as source}
        <option value={source.id}>{source.label}</option>
      {/each}
    </select>
  </div>
{/if}
<TimelineItemList
  {items}
  chartType="line"
  typeName="resource"
  typeNamePlural="Resources"
  filterOptions={resourceDataTypes.map(t => ({ label: t, value: t }))}
  filterName="Data Type"
  {getFilterValueFromItem}
  {loading}
  let:prop={item}
>
  <div slot="header" class="upload-container" hidden={!isUploadVisible}>
    <button class="close-upload" type="button" on:click={onHideUpload}>
      <CloseIcon />
    </button>
    <Input layout="stacked">
      <label class="st-typography-body" for="file">Resource File</label>
      <input
        class="w-full text-xs"
        name="file"
        type="file"
        accept="application/json,.csv,.txt"
        bind:files={uploadFiles}
        bind:this={uploadFileInput}
        use:permissionHandler={{
          hasPermission: hasUploadPermission,
          permissionError: uploadPermissionError,
        }}
      />
    </Input>
    <div class="use-simulation">
      <label class="st-typography-body timeline-item-list-filter-option-label" for="simulation-association">
        Use selected simulation
      </label>
      <input
        bind:checked={useSelectedSimulation}
        class="simulation-checkbox"
        type="checkbox"
        name="simulation-association"
      />
    </div>
    <div class="upload-button-container">
      <button
        class="st-button secondary"
        disabled={!uploadFiles?.length}
        on:click={onUpload}
        use:permissionHandler={{
          hasPermission: hasUploadPermission,
          permissionError: uploadPermissionError,
        }}
      >
        Upload
      </button>
    </div>
  </div>
  <svelte:fragment slot="button">
    <button
      class="st-button secondary"
      on:click={onShowUpload}
      use:permissionHandler={{
        hasPermission: hasUploadPermission,
        permissionError: uploadPermissionError,
      }}
      use:tooltip={{ content: 'Upload Resources' }}
    >
      <UploadIcon />
    </button>
  </svelte:fragment>
  <ResourceListPrefix {item} />
</TimelineItemList>

<style>
  .resource-source {
    align-items: center;
    display: flex;
    gap: 8px;
    padding: 4px 8px 0;
  }

  .upload-container {
    background: var(--st-gray-15);
    border-radius: 5px;
    margin: 5px;
    padding: 8px 11px 8px;
    position: relative;
  }

  .upload-container[hidden] {
    display: none;
  }

  .upload-container {
    display: grid;
    row-gap: 8px;
  }

  .upload-container .use-simulation {
    column-gap: 8px;
    display: grid;
    grid-template-columns: max-content auto;
    justify-content: space-between;
    justify-self: left;
    margin: 0;
    width: 100%;
  }

  .upload-container :global(.upload-button-container) {
    display: flex;
    flex-flow: row-reverse;
  }

  .upload-container :global(.close-upload) {
    background: none;
    border: 0;
    cursor: pointer;
    height: 1.3rem;
    padding: 0;
    position: absolute;
    right: 3px;
    top: 3px;
  }
</style>
