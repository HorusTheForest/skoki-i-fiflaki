// Level outcome: pass/fail, stars, unlocks. Filled in with the campaign.
import type { DiveResult } from '../scenes/ResultsScene';

export interface LevelOutcome {
  passed: boolean;
  stars: number;
  title: string;
  detail: string;
  next?: () => void;
  nextLabel?: string;
}

export function onLevelResult(_r: DiveResult, _total: number): LevelOutcome | null {
  return null;
}
