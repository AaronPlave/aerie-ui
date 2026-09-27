<svelte:options immutable={true} />

<script lang="ts">
  import { Download, SquareCode } from 'lucide-svelte';
  import { createEventDispatcher, onMount } from 'svelte';
  import { selectActivity } from '../../stores/activities';
  import { simulationDatasetLatest } from '../../stores/simulation';
  import type { User } from '../../types/app';
  import type { Plan } from '../../types/plan';
  import type {
    GeneratedProduct,
    SequenceGeneration,
    SequenceGenerationDiagnostic,
  } from '../../types/sequence-generation';
  import effects from '../../utilities/effects';
  import { downloadBlob } from '../../utilities/generic';
  import {
    getGeneratedProductFileName,
    getSequenceGenerationFailureSummary,
    getSequenceGenerationStatus,
  } from '../../utilities/sequence-generation';
  import MonacoEditor from '../ui/MonacoEditor.svelte';
  import StatusBadge from '../ui/StatusBadge.svelte';
  import Modal from './Modal.svelte';
  import ModalContent from './ModalContent.svelte';
  import ModalFooter from './ModalFooter.svelte';
  import ModalHeader from './ModalHeader.svelte';

  export let generationId: number;
  export let height: number = 640;
  export let plan: Plan | null;
  export let user: User | null;
  export let width: number = 760;

  const dispatch = createEventDispatcher<{
    close: void;
    retry: SequenceGeneration;
  }>();

  let generation: SequenceGeneration | null = null;
  let product: GeneratedProduct | null = null;
  let loading: boolean = true;
  let tab: 'output' | 'blocks' | 'provenance' = 'output';

  $: newerSimulationAvailable =
    generation?.source_snapshot != null &&
    $simulationDatasetLatest != null &&
    $simulationDatasetLatest.id > generation.source_snapshot.identifiers.simulationDatasetId;

  onMount(async () => {
    generation = await effects.getSequenceGeneration(generationId, user);
    const firstProduct = generation?.products[0];
    if (firstProduct) {
      product = await effects.getGeneratedProduct(firstProduct.id, user);
    } else {
      tab = 'provenance';
    }
    loading = false;
  });

  function onDownload() {
    if (product) {
      downloadBlob(new Blob([product.rendered_output], { type: 'text/plain' }), getGeneratedProductFileName(product));
    }
  }

  function onOpenInWorkspace() {
    if (generation && product) {
      effects.sendGeneratedProductToWorkspace(generation, product, plan, user);
    }
  }

  function onShowActivity(diagnostic: SequenceGenerationDiagnostic) {
    const directiveId = diagnostic.directiveIds?.[0];
    if (directiveId !== undefined) {
      selectActivity(directiveId, null, true, true);
      dispatch('close');
    }
  }

  function formatTime(time: string | null | undefined): string {
    return time
      ? new Date(time)
          .toISOString()
          .replace('T', ' ')
          .replace(/\.\d+Z$/, 'Z')
      : '—';
  }
</script>

<Modal {height} {width} on:close>
  <ModalHeader on:close>
    {generation?.requested_seq_id ?? 'Sequence'} · Generation {generationId}
  </ModalHeader>
  <ModalContent>
    {#if loading}
      <div class="muted">Loading...</div>
    {:else if generation === null}
      <div class="muted">Generation {generationId} could not be loaded.</div>
    {:else}
      <div class="flex h-full flex-col gap-2" data-testid="sequence-generation-details">
        <div class="flex items-center gap-2">
          <StatusBadge status={getSequenceGenerationStatus(generation.status)} />
          <span class="font-semibold">
            {generation.status === 'success' ? 'Generated' : generation.status === 'failed' ? 'Failed' : 'In progress'}
          </span>
          <span class="muted">{formatTime(generation.completed_at ?? generation.requested_at)}</span>
          {#if generation.requested_by}<span class="muted">by {generation.requested_by}</span>{/if}
        </div>

        {#if generation.source_snapshot}
          <div class="summary">
            Generated from simulation #{generation.source_snapshot.identifiers.simulationDatasetId} · plan revision
            {generation.source_snapshot.revisions.planRevision} · {generation.expansion_snapshot?.coverage.activities ??
              generation.source_snapshot.activities?.length ??
              0} activities
            {#if generation.expansion_snapshot}
              · {generation.expansion_snapshot.templates.length} template type(s)
            {/if}
            {#if newerSimulationAvailable}
              <span class="muted">· Newer simulation available</span>
            {/if}
          </div>
        {/if}

        {#if generation.status === 'failed'}
          <div class="diagnostics" data-testid="sequence-generation-diagnostics">
            <div class="font-semibold">{getSequenceGenerationFailureSummary(generation)}</div>
            {#each generation.diagnostics as diagnostic}
              <div class="diagnostic" class:error={diagnostic.severity === 'error'}>
                <span class="code">{diagnostic.code}</span>
                {diagnostic.message}
                {#if diagnostic.directiveIds?.length}
                  <button class="st-button tertiary show-activity" on:click={() => onShowActivity(diagnostic)}>
                    Show activity
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        <div class="tabs flex gap-2">
          <button
            class="st-button tertiary"
            class:active={tab === 'output'}
            disabled={!product}
            on:click={() => (tab = 'output')}
          >
            Output
          </button>
          <button
            class="st-button tertiary"
            class:active={tab === 'blocks'}
            disabled={!product}
            on:click={() => (tab = 'blocks')}
          >
            Expansion
          </button>
          <button class="st-button tertiary" class:active={tab === 'provenance'} on:click={() => (tab = 'provenance')}>
            Provenance
          </button>
        </div>

        <div class="tab-body">
          {#if tab === 'output' && product}
            <div style:height="100%">
              <MonacoEditor
                automaticLayout={true}
                language="plaintext"
                lineNumbers="on"
                minimap={{ enabled: false }}
                readOnly={true}
                scrollBeyondLastLine={false}
                tabSize={2}
                value={product.rendered_output}
              />
            </div>
          {:else if tab === 'blocks' && product}
            <table class="blocks">
              <thead>
                <tr><th>Activity</th><th>Start</th><th>Template</th><th>Expanded block</th></tr>
              </thead>
              <tbody>
                {#each product.source_blocks as block (block.index)}
                  <tr>
                    <td>
                      {block.activityType}
                      <span class="muted">#{block.directiveId ?? `span ${block.sourceActivityId}`}</span>
                    </td>
                    <td class="muted">{block.startTime}</td>
                    <td class="muted" title={block.templateHash}
                      >{block.templateId} · {block.templateHash.slice(0, 8)}</td
                    >
                    <td><pre>{block.expansion}</pre></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else if tab === 'provenance'}
            <div class="provenance" data-testid="sequence-generation-provenance">
              {#if generation.source_snapshot}
                {@const source = generation.source_snapshot}
                <div class="font-semibold">Source</div>
                <div>
                  Plan {source.identifiers.planId} · revision {source.revisions.planRevision} (now {source.revisions
                    .currentPlanRevision})
                </div>
                <div>
                  Simulation dataset #{source.identifiers.simulationDatasetId} · simulation revision {source.revisions
                    .simulationRevision}
                </div>
                <div>
                  Simulation {formatTime(source.time.simulationStartTime)} – {formatTime(source.time.simulationEndTime)}
                </div>
                <div>
                  Selection: {source.selection.type}
                  {#if source.selection.filter}· filter "{source.selection.filter.name}" (#{source.selection.filter
                      .id}){/if}
                </div>
              {:else}
                <div class="muted">The source could not be resolved.</div>
              {/if}
              {#if generation.expansion_snapshot}
                {@const expansion = generation.expansion_snapshot}
                <div class="mt-2 font-semibold">Expansion environment</div>
                <div>
                  Model {expansion.model.name}
                  {expansion.model.version} (#{expansion.model.id}, revision {expansion.model.revision})
                </div>
                <div>
                  Language {expansion.language ?? '—'} · {expansion.generator.name}
                  {expansion.generator.version}
                </div>
                {#each expansion.parcels as parcel}
                  <div>
                    Parcel {parcel.name} (#{parcel.parcelId})
                    {#if parcel.commandDictionary}· command dictionary {parcel.commandDictionary.mission}
                      {parcel.commandDictionary.version}{/if}
                    {#if parcel.sequenceAdaptation}· adaptation {parcel.sequenceAdaptation.name} ({parcel.sequenceAdaptation.contentHash.slice(
                        0,
                        8,
                      )}){/if}
                  </div>
                {/each}
                <div class="mt-2 font-semibold">Templates</div>
                {#each expansion.templates as template}
                  <div>
                    {template.activityType} → {template.name} (#{template.templateId})
                    <span class="muted" title={template.definitionHash}>{template.definitionHash.slice(0, 12)}</span>
                  </div>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </ModalContent>
  <ModalFooter>
    {#if generation?.status === 'failed'}
      <button class="st-button secondary" on:click={() => generation && dispatch('retry', generation)}>Retry</button>
    {/if}
    {#if product}
      <button class="st-button secondary icon-button" on:click={onOpenInWorkspace}>
        <SquareCode size={16} /> Open in Workspace
      </button>
      <button class="st-button secondary icon-button" on:click={onDownload}><Download size={16} /> Download</button>
    {/if}
    <button class="st-button" on:click={() => dispatch('close')}>Close</button>
  </ModalFooter>
</Modal>

<style>
  .muted {
    color: var(--st-gray-50);
  }

  .summary,
  .provenance,
  .diagnostic {
    font-size: 12px;
  }

  .diagnostic.error .code {
    color: var(--st-red);
  }

  .code {
    font-family: monospace;
    margin-right: 4px;
  }

  .show-activity {
    font-size: 12px;
    height: 20px;
  }

  .tabs .active {
    font-weight: 600;
    text-decoration: underline;
  }

  .tab-body {
    flex: 1;
    min-height: 240px;
    overflow: auto;
  }

  .blocks {
    border-collapse: collapse;
    font-size: 12px;
    width: 100%;
  }

  .blocks th,
  .blocks td {
    border-bottom: 1px solid var(--st-gray-20);
    padding: 4px;
    text-align: left;
    vertical-align: top;
  }

  .blocks pre {
    margin: 0;
    white-space: pre-wrap;
  }

  .icon-button {
    gap: 4px;
  }
</style>
