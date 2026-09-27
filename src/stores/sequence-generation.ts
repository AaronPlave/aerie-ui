import { derived, writable, type Readable, type Writable } from 'svelte/store';
import type { SequenceGenerationSlim } from '../types/sequence-generation';
import gql from '../utilities/gql';
import { planId } from './plan';
import { gqlSubscribable } from './subscribable';

/* Subscriptions. */

/** Generation history of the current plan, newest first. */
export const sequenceGenerations = gqlSubscribable<SequenceGenerationSlim[]>(
  gql.SUB_SEQUENCE_GENERATIONS,
  { planId },
  [],
);

/* Writeable. */

export const generatingSequence: Writable<boolean> = writable(false);

/* Derived. */

export const latestSequenceGeneration: Readable<SequenceGenerationSlim | null> = derived(
  sequenceGenerations,
  $sequenceGenerations => $sequenceGenerations[0] ?? null,
);

export function resetSequenceGenerationStores(): void {
  generatingSequence.set(false);
}
