/**
 * Shape of a stored proposal payload after DB JSON parse.
 *
 * Older rows may have been written with snake_case `type_args` (the on-chain
 * field name); newer rows use `typeArgs`. The normalizer converts both into
 * the camelCase form so client components only have to handle one shape.
 */
export interface ProposalPayload {
  module: string;
  function: string;
  typeArgs: string[];
  args: string[];
}

interface RawProposalPayload {
  module: string;
  function: string;
  typeArgs?: string[];
  type_args?: string[];
  args: string[];
}

/** Normalize a proposal payload read from the DB into the canonical shape. */
export function normalizeProposalPayload(
  raw: RawProposalPayload,
): ProposalPayload {
  return {
    module: raw.module,
    function: raw.function,
    typeArgs: raw.typeArgs ?? raw.type_args ?? [],
    args: raw.args,
  };
}
