<svelte:options immutable={true} />

<script lang="ts">
  import { Download, FileCode2, RotateCcw, SquareCode } from 'lucide-svelte';
  import { plan, planReadOnly } from '../../stores/plan';
  import { sequenceGenerations } from '../../stores/sequence-generation';
  import { simulationDatasetLatest } from '../../stores/simulation';
  import type { User } from '../../types/app';
  import type { GenerateSequenceRequest, SequenceGenerationSlim } from '../../types/sequence-generation';
  import type { ViewGridSection } from '../../types/view';
  import effects from '../../utilities/effects';
  import { downloadBlob } from '../../utilities/generic';
  import { showGenerateSequenceModal, showSequenceGenerationModal } from '../../utilities/modal';
  import { permissionHandler } from '../../utilities/permissionHandler';
  import { featurePermissions } from '../../utilities/permissions';
  import {
    getGeneratedProductFileName,
    getSequenceGenerationActivityCount,
    getSequenceGenerationFailureSummary,
    getSequenceGenerationStatus,
  } from '../../utilities/sequence-generation';
  import { tooltip } from '../../utilities/tooltip';
  import GridMenu from '../menus/GridMenu.svelte';
  import Panel from '../ui/Panel.svelte';
  import StatusBadge from '../ui/StatusBadge.svelte';

  export let gridSection: ViewGridSection;
  export let user: User | null;

  const generatePermissionError = 'You do not have permission to generate sequences for this plan';

  let filterText: string = '';

  $: hasGeneratePermission =
    $plan !== null && featurePermissions.sequenceGeneration.canGenerate(user, $plan, $plan.model) && !$planReadOnly;
  $: filteredGenerations = filterText
    ? $sequenceGenerations.filter(generation =>
        `${generation.requested_seq_id} ${generation.id}`.toLowerCase().includes(filterText.toLowerCase()),
      )
    : $sequenceGenerations;

  async function onGenerate(initialRequest: GenerateSequenceRequest | null = null) {
    if ($plan === null) {
      return;
    }
    const result = await showGenerateSequenceModal($plan, user, { initialRequest });
    if (result.confirm && result.value) {
      await onReview(result.value.generationId);
    }
  }

  async function onReview(generationId: number) {
    const result = await showSequenceGenerationModal(generationId, $plan, user);
    if (result.confirm && result.value?.retry) {
      await onGenerate(result.value.retry.request_snapshot);
    }
  }

  function onRetry(generation: SequenceGenerationSlim) {
    // A retry is a new generation from the same request, never a modification of the failed one.
    onGenerate(generation.request_snapshot);
  }

  function onOpenInWorkspace(generation: SequenceGenerationSlim) {
    const product = generation.products[0];
    if (product) {
      effects.sendGeneratedProductToWorkspace(generation, product, $plan, user);
    }
  }

  async function onExport(generation: SequenceGenerationSlim) {
    const product = generation.products[0];
    if (product) {
      const fullProduct = await effects.getGeneratedProduct(product.id, user);
      if (fullProduct) {
        downloadBlob(
          new Blob([fullProduct.rendered_output], { type: 'text/plain' }),
          getGeneratedProductFileName(fullProduct),
        );
      }
    }
  }

  function isNewerSimulationAvailable(generation: SequenceGenerationSlim): boolean {
    return (
      generation.simulation_dataset_id !== null &&
      $simulationDatasetLatest !== null &&
      $simulationDatasetLatest.status === 'success' &&
      $simulationDatasetLatest.id > generation.simulation_dataset_id
    );
  }
</script>

<Panel padBody={false}>
  <svelte:fragment slot="header">
    <GridMenu {gridSection} title="Sequences" />
  </svelte:fragment>

  <svelte:fragment slot="body">
    <div class="sequences-controls flex flex-wrap">
      <input
        bind:value={filterText}
        class="st-input min-w-32 flex-1"
        name="search"
        autocomplete="off"
        placeholder="Filter generations..."
        aria-label="Filter generations"
      />
      <button
        class="st-button"
        data-testid="generate-sequence-button"
        on:click={() => onGenerate()}
        use:permissionHandler={{ hasPermission: hasGeneratePermission, permissionError: generatePermissionError }}
      >
        Generate Sequence
      </button>
    </div>
    <div class="section-label">Recent generations</div>
    <div class="generation-items" data-testid="sequence-generations">
      {#each filteredGenerations as generation (generation.id)}
        <div class="generation" data-testid="sequence-generation" data-generation-id={generation.id}>
          <div class="generation-header">
            <span class="seq-id"><FileCode2 size={14} class="inline" /> {generation.requested_seq_id}</span>
            <span class="muted">Generation {generation.id}</span>
          </div>
          <div class="generation-status">
            <StatusBadge status={getSequenceGenerationStatus(generation.status)} />
            {#if generation.status === 'success'}
              <span>Generated</span>
              {#if getSequenceGenerationActivityCount(generation) !== null}
                <span class="muted">· {getSequenceGenerationActivityCount(generation)} activities</span>
              {/if}
            {:else if generation.status === 'failed'}
              <span>Failed</span>
              <span class="failure-summary" title={getSequenceGenerationFailureSummary(generation)}>
                · {getSequenceGenerationFailureSummary(generation)}
              </span>
            {:else}
              <span>Generating...</span>
            {/if}
          </div>
          <div class="generation-meta muted">
            {#if generation.simulation_dataset_id !== null}Simulation #{generation.simulation_dataset_id}{/if}
            {#if isNewerSimulationAvailable(generation)}· Newer simulation available{/if}
          </div>
          <div class="generation-actions">
            {#if generation.status === 'success'}
              <button class="st-button tertiary" on:click={() => onReview(generation.id)}>Review</button>
              <button
                class="st-button tertiary"
                aria-label={`Open '${generation.requested_seq_id}' in Workspace`}
                on:click={() => onOpenInWorkspace(generation)}
                use:tooltip={{ content: 'Open in Workspace', placement: 'top' }}
              >
                <SquareCode size={14} /> Open in Workspace
              </button>
              <button
                class="st-button tertiary"
                aria-label={`Export '${generation.requested_seq_id}'`}
                on:click={() => onExport(generation)}
              >
                <Download size={14} /> Export
              </button>
            {:else}
              <button class="st-button tertiary" on:click={() => onReview(generation.id)}>Details</button>
              {#if generation.status === 'failed'}
                <button
                  class="st-button tertiary"
                  on:click={() => onRetry(generation)}
                  use:permissionHandler={{
                    hasPermission: hasGeneratePermission,
                    permissionError: generatePermissionError,
                  }}
                >
                  <RotateCcw size={14} /> Retry
                </button>
              {/if}
            {/if}
          </div>
        </div>
      {:else}
        <div class="empty muted">No sequences have been generated for this plan yet.</div>
      {/each}
    </div>
  </svelte:fragment>
</Panel>

<style>
  .sequences-controls {
    align-items: center;
    background: rgba(248, 248, 248, 0.6);
    gap: 8px;
    padding: 8px;
  }

  .section-label {
    color: var(--st-gray-50);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 8px 8px 4px;
    text-transform: uppercase;
  }

  .generation-items {
    overflow-y: auto;
  }

  .generation {
    border-bottom: 1px solid var(--st-gray-20);
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px;
  }

  .generation-header {
    align-items: baseline;
    display: flex;
    gap: 8px;
  }

  .seq-id {
    font-weight: 600;
  }

  .generation-status {
    align-items: center;
    display: flex;
    gap: 4px;
    min-width: 0;
  }

  .failure-summary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .generation-meta {
    font-size: 12px;
  }

  .generation-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .generation-actions .st-button {
    gap: 4px;
  }

  .muted {
    color: var(--st-gray-50);
  }

  .empty {
    padding: 8px;
  }
</style>
