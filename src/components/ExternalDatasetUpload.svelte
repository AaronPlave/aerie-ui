<svelte:options immutable={true} />

<!-- Upload of an external profile dataset (a plan_dataset). Shown under Sources > External Datasets. -->
<script lang="ts">
  import CloseIcon from '@nasa-jpl/stellar/icons/close.svg?component';
  import { createEventDispatcher } from 'svelte';
  import { plan } from '../stores/plan';
  import { simulationDatasetId } from '../stores/simulation';
  import type { User } from '../types/app';
  import effects from '../utilities/effects';
  import { permissionHandler } from '../utilities/permissionHandler';
  import { featurePermissions } from '../utilities/permissions';
  import Input from './form/Input.svelte';

  export let user: User | null;

  const dispatch = createEventDispatcher<{ close: void }>();
  const uploadPermissionError: string = `You do not have permission to upload resources.`;

  let hasUploadPermission: boolean = false;
  let useSelectedSimulation: boolean = false;
  let uploadFiles: FileList | undefined;
  let uploadFileInput: HTMLInputElement;

  $: if (user !== null && $plan !== null) {
    hasUploadPermission = featurePermissions.externalResources.canCreate(user, $plan);
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

<div class="upload-container">
  <button class="close-upload" type="button" aria-label="Close upload" on:click={() => dispatch('close')}>
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

<style>
  .upload-container {
    background: var(--st-gray-15);
    border-radius: 5px;
    display: grid;
    margin: 5px;
    padding: 8px 11px 8px;
    position: relative;
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

  .upload-button-container {
    display: flex;
    flex-flow: row-reverse;
  }

  .close-upload {
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
