import type { MissionState } from "../missions";
import type { SeasonState } from "../modes";
import type { ProgressionStore } from "../progression";

/**
 * Replays durable mission/Season claims into the idempotent progression ledger.
 * This is the recovery seam for separate localStorage keys: if one write fails,
 * the next startup can safely finish the credit without paying twice.
 */
export function reconcileExternalRewards(
  progression: ProgressionStore,
  missions: MissionState,
  season: SeasonState
): { applied: number; alreadyCredited: number } {
  let applied = 0;
  let alreadyCredited = 0;
  for (const mission of missions.missions) {
    if (!mission.claimed || !mission.claimId) continue;
    const result = progression.creditExternalReward({
      transactionId: mission.claimId,
      coins: mission.reward.coins,
      xp: mission.reward.xp,
      source: "mission"
    });
    if (result.applied) applied += 1;
    else if (result.alreadyCredited) alreadyCredited += 1;
  }
  if (season.completionRewardClaimed && season.completion?.reward) {
    const reward = season.completion.reward;
    const result = progression.creditExternalReward({
      transactionId: reward.rewardId,
      coins: reward.coins,
      xp: reward.xp,
      source: "season"
    });
    if (result.applied) applied += 1;
    else if (result.alreadyCredited) alreadyCredited += 1;
  }
  return { applied, alreadyCredited };
}
