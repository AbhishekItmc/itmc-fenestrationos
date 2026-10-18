import type { Issue } from '../api/types';
import { isDesignCheck } from '../engine/checks';

/** Marks DEMO design-check warnings (§8.3) in issue lists. */
export function DesignCheckTag() {
  return (
    <span
      data-testid="design-check-tag"
      data-tip="Plausibility check against DEMO rule-set thresholds — not structural verification"
      className="inline-flex h-4 items-center whitespace-nowrap rounded-sm border border-prov/50 bg-prov/10 px-1 text-[11px] font-semibold text-prov"
    >
      Design check (demo threshold)
    </span>
  );
}

export const designCheckTag = (i: Issue) => (isDesignCheck(i) ? <DesignCheckTag /> : null);
