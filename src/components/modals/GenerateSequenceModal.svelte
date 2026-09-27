<svelte:options immutable={true} />

<script lang="ts">
  import { debounce } from 'lodash-es';
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { Status } from '../../enums/status';
  import { activityDirectivesMap } from '../../stores/activities';
  import { generatingSequence } from '../../stores/sequence-generation';
  import { sequenceFilters } from '../../stores/sequencing';
  import { simulationDatasetLatest, simulationStatus } from '../../stores/simulation';
  import type { ActivityDirective } from '../../types/activity';
  import type { User } from '../../types/app';
  import type { Plan } from '../../types/plan';
  import type {
    GenerateSequencePreflightResponse,
    GenerateSequenceRequest,
    GenerateSequenceResponse,
    SequenceGenerationSelection,
  } from '../../types/sequence-generation';
  import effects from '../../utilities/effects';
  import { featurePermissions } from '../../utilities/permissions';
  import { getSequenceGenerationErrors, isValidSequenceId } from '../../utilities/sequence-generation';
  import StatusBadge from '../ui/StatusBadge.svelte';
  import Modal from './Modal.svelte';
  import ModalContent from './ModalContent.svelte';
  import ModalFooter from './ModalFooter.svelte';
  import ModalHeader from './ModalHeader.svelte';

  export let height: number = 620;
  /** Activity directives preselected by the caller, e.g. from the activity table. */
  export let initialDirectiveIds: number[] = [];
  /** A previous request to prefill, e.g. when retrying a generation. */
  export let initialRequest: GenerateSequenceRequest | null = null;
  export let plan: Plan;
  export let user: User | null;
  export let width: number = 520;

  const dispatch = createEventDispatcher<{
    close: void;
    generated: GenerateSequenceResponse;
  }>();

  type SelectionMode = 'activities' | 'filter';

  let sequenceId: string = initialRequest?.sequenceId ?? '';
  let selectionMode: SelectionMode = initialRequest?.selection.type === 'filter' ? 'filter' : 'activities';
  let selectedDirectiveIds: Set<number> = new Set(
    initialRequest?.selection.type === 'activity-directives' ? initialRequest.selection.ids : initialDirectiveIds,
  );
  let selectedFilterId: number | null =
    initialRequest?.selection.type === 'filter' ? initialRequest.selection.filterId : null;
  let activitySearch: string = '';
  let preflight: GenerateSequencePreflightResponse | null = null;
  let preflightLoading: boolean = false;
  let preflightAbortController: AbortController | null = null;
  let lastPreflightKey: string | null = null;

  $: hasGeneratePermission = featurePermissions.sequenceGeneration.canGenerate(user, plan, plan.model);
  $: simulationDatasetId = $simulationDatasetLatest?.id ?? null;
  $: simulationComplete = $simulationDatasetLatest?.status === 'success';
  $: activityDirectives = Object.values($activityDirectivesMap ?? {}).sort(
    (a, b) => a.start_time_ms - b.start_time_ms || a.id - b.id,
  ) as ActivityDirective[];
  $: filteredActivityDirectives = activitySearch
    ? activityDirectives.filter(directive =>
        `${directive.id} ${directive.name} ${directive.type}`.toLowerCase().includes(activitySearch.toLowerCase()),
      )
    : activityDirectives;
  $: selection = getSelection(selectionMode, selectedDirectiveIds, selectedFilterId);
  $: request =
    selection !== null
      ? ({
          metadata: initialRequest?.metadata ?? {},
          planId: plan.id,
          selection,
          sequenceId: sequenceId.trim(),
          simulationDatasetId,
        } as GenerateSequenceRequest)
      : null;
  // The preflight does not depend on the sequence ID, so typing one does not re-run it.
  $: preflightRequest =
    selection !== null
      ? ({ planId: plan.id, selection, sequenceId: 'PREFLIGHT', simulationDatasetId } as GenerateSequenceRequest)
      : null;
  $: runPreflight(preflightRequest, JSON.stringify([preflightRequest, hasGeneratePermission]), hasGeneratePermission);
  $: preflightErrors = getSequenceGenerationErrors(preflight?.diagnostics);
  $: preflightInfo = (preflight?.diagnostics ?? []).filter(diagnostic => diagnostic.severity !== 'error');
  $: coverage = preflight?.expansion?.coverage ?? null;
  $: blockedReason = !hasGeneratePermission
    ? 'You do not have permission to generate sequences for this plan'
    : simulationDatasetId === null
      ? 'A completed simulation is required'
      : !simulationComplete
        ? 'The latest simulation is not complete'
        : selection === null
          ? selectionMode === 'filter'
            ? 'Select a sequence filter'
            : 'Select at least one activity'
          : !isValidSequenceId(sequenceId)
            ? 'Enter a sequence ID'
            : preflightLoading || preflight === null
              ? 'Checking...'
              : !preflight.ok
                ? 'Resolve the problems above to generate'
                : '';

  onDestroy(() => preflightAbortController?.abort());

  function getSelection(
    mode: SelectionMode,
    directiveIds: Set<number>,
    filterId: number | null,
  ): SequenceGenerationSelection | null {
    if (mode === 'filter') {
      return filterId !== null ? { filterId, type: 'filter' } : null;
    }
    return directiveIds.size > 0 ? { ids: [...directiveIds].sort((a, b) => a - b), type: 'activity-directives' } : null;
  }

  const debouncedPreflight = debounce(async (preflightRequest: GenerateSequenceRequest) => {
    preflightAbortController?.abort();
    preflightAbortController = new AbortController();
    const { signal } = preflightAbortController;
    const result = await effects.generateSequencePreflight(preflightRequest, plan, user, signal);
    if (!signal.aborted) {
      preflight = result;
      preflightLoading = false;
    }
  }, 300);

  function runPreflight(preflightRequest: GenerateSequenceRequest | null, key: string, canPreflight: boolean) {
    if (key === lastPreflightKey) {
      return;
    }
    lastPreflightKey = key;
    preflight = null;
    preflightAbortController?.abort();
    if (preflightRequest === null || preflightRequest.simulationDatasetId === null || !canPreflight) {
      preflightLoading = false;
      debouncedPreflight.cancel();
      return;
    }
    preflightLoading = true;
    debouncedPreflight(preflightRequest);
  }

  function toggleDirective(id: number) {
    const next = new Set(selectedDirectiveIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selectedDirectiveIds = next;
  }

  async function onGenerate() {
    if (request === null || blockedReason !== '') {
      return;
    }
    const result = await effects.generateSequence(request, plan, user);
    if (result !== null) {
      dispatch('generated', result);
    }
  }
</script>

<Modal {height} {width} on:close>
  <ModalHeader on:close>Generate Sequence</ModalHeader>
  <ModalContent>
    <div class="generate-sequence flex flex-col gap-3" data-testid="generate-sequence-modal">
      <section>
        <div class="section-title">Source</div>
        {#if $simulationDatasetLatest}
          <div class="flex items-center gap-2" data-testid="generate-sequence-source">
            <StatusBadge
              status={simulationComplete
                ? Status.Complete
                : $simulationDatasetLatest.status === 'failed'
                  ? Status.Failed
                  : Status.Incomplete}
            />
            Simulation #{$simulationDatasetLatest.id}
            <span class="muted">{simulationComplete ? 'complete' : $simulationDatasetLatest.status}</span>
          </div>
          {#if simulationComplete && $simulationStatus === Status.Modified}
            <div class="muted note">The plan has changed since this simulation was run.</div>
          {/if}
        {:else}
          <div class="muted" data-testid="generate-sequence-source">No simulation. Simulate the plan first.</div>
        {/if}
      </section>

      <section>
        <div class="section-title">Activities</div>
        <div class="flex gap-4">
          <label class="flex items-center gap-1">
            <input type="radio" bind:group={selectionMode} value="activities" name="selection-mode" />
            Selected activities
          </label>
          <label class="flex items-center gap-1">
            <input type="radio" bind:group={selectionMode} value="filter" name="selection-mode" />
            Existing sequence filter
          </label>
        </div>
        {#if selectionMode === 'activities'}
          <div class="muted note">{selectedDirectiveIds.size} selected</div>
          <input
            class="st-input w-full"
            placeholder="Search activities..."
            aria-label="Search activities"
            bind:value={activitySearch}
          />
          <div class="activity-list" data-testid="generate-sequence-activities">
            {#each filteredActivityDirectives as directive (directive.id)}
              <label class="activity-row">
                <input
                  type="checkbox"
                  checked={selectedDirectiveIds.has(directive.id)}
                  on:change={() => toggleDirective(directive.id)}
                />
                <span class="activity-name">{directive.name}</span>
                <span class="muted">{directive.type} · #{directive.id}</span>
              </label>
            {:else}
              <div class="muted note">No activities</div>
            {/each}
          </div>
        {:else}
          <select class="st-select w-full" name="sequence-filter" bind:value={selectedFilterId}>
            <option value={null}>Select a sequence filter</option>
            {#each $sequenceFilters as sequenceFilter (sequenceFilter.id)}
              <option value={sequenceFilter.id}>{sequenceFilter.name}</option>
            {/each}
          </select>
        {/if}
      </section>

      <section>
        <label class="section-title" for="generate-sequence-id">Sequence ID</label>
        <input
          id="generate-sequence-id"
          class="st-input w-full"
          name="sequence-id"
          autocomplete="off"
          placeholder="e.g. E17_MINI"
          bind:value={sequenceId}
        />
      </section>

      <section data-testid="generate-sequence-preflight">
        <div class="section-title">Expansion coverage</div>
        {#if preflightLoading}
          <div class="muted">Checking...</div>
        {:else if preflight}
          {#if coverage}
            <div class="flex items-center gap-2" data-testid="generate-sequence-coverage">
              <StatusBadge status={coverage.missing === 0 ? Status.Complete : Status.Failed} />
              {coverage.expandable} / {coverage.activities} supported
            </div>
          {/if}
          {#each preflightErrors as diagnostic}
            <div class="diagnostic error" data-testid="generate-sequence-diagnostic">
              {diagnostic.message}
            </div>
          {/each}
          {#each preflightInfo as diagnostic}
            <div class="diagnostic muted">{diagnostic.message}</div>
          {/each}
        {:else}
          <div class="muted">—</div>
        {/if}
      </section>
    </div>
  </ModalContent>
  <ModalFooter>
    {#if blockedReason && !preflightLoading}
      <span class="muted blocked-reason">{blockedReason}</span>
    {/if}
    <button class="st-button secondary" on:click={() => dispatch('close')}>Cancel</button>
    <button
      class="st-button"
      data-testid="generate-sequence-submit"
      disabled={blockedReason !== '' || $generatingSequence}
      on:click={onGenerate}
    >
      {$generatingSequence ? 'Generating...' : 'Generate'}
    </button>
  </ModalFooter>
</Modal>

<style>
  .section-title {
    font-weight: 600;
    margin-bottom: 4px;
  }

  .muted {
    color: var(--st-gray-50);
  }

  .note {
    font-size: 12px;
    margin: 4px 0;
  }

  .activity-list {
    border: 1px solid var(--st-gray-20);
    border-radius: 4px;
    margin-top: 4px;
    max-height: 160px;
    overflow-y: auto;
  }

  .activity-row {
    align-items: center;
    display: flex;
    gap: 6px;
    padding: 2px 6px;
  }

  .activity-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .diagnostic {
    font-size: 12px;
    margin-top: 4px;
  }

  .diagnostic.error {
    color: var(--st-red);
  }

  .blocked-reason {
    flex: 1;
    font-size: 12px;
  }
</style>
