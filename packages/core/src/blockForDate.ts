/**
 * Map a date to a watch start block, with zero RPC.
 *
 * The outline's "binary search the synced headers" needs header-by-number, which
 * `ckb-light-client-js@1.0.3` does not expose (only getTipHeader, getGenesisBlock and
 * getHeader-by-hash). So this estimates the block by linear interpolation between genesis
 * and the current tip — both of which the light client already has — and subtracts a safety
 * margin so the watch starts a little before the date and never misses the first activity.
 *
 * It is an estimate: CKB's block time is only roughly constant, so interpolation can drift
 * over years. The margin trades scan time for safety. An exact mapping would need an
 * upstream header-by-number (or FlyClient sample) API; that is the M2 upstream proposal.
 */
export interface HeaderPoint {
  number: bigint;
  /** Unix timestamp in milliseconds (CKB header timestamps are ms). */
  timestamp: bigint;
}

export interface BlockForDateInput {
  genesis: HeaderPoint;
  tip: HeaderPoint;
  /** Target date as Unix ms. */
  targetMs: bigint;
  /** Blocks to subtract from the estimate so the scan starts before the date. Default 0. */
  safetyBlocks?: bigint;
}

/**
 * Estimated start block for `targetMs`, clamped to [genesis.number, tip.number]. Integer
 * division floors, which biases the estimate slightly earlier (safer). Dates at or before
 * genesis return genesis.number; at or after the tip return tip.number (nothing to scan).
 */
export function estimateBlockForDate(input: BlockForDateInput): bigint {
  const { genesis, tip, targetMs } = input;
  const safety = input.safetyBlocks ?? 0n;
  if (targetMs <= genesis.timestamp) return genesis.number;
  if (targetMs >= tip.timestamp) return tip.number;

  const span = tip.timestamp - genesis.timestamp;
  const blocks = tip.number - genesis.number;
  if (span <= 0n || blocks <= 0n) return genesis.number;

  const estimate = genesis.number + (blocks * (targetMs - genesis.timestamp)) / span;
  const withMargin = estimate - safety;
  return withMargin < genesis.number ? genesis.number : withMargin;
}
