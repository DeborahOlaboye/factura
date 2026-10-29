import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * False during SSR and hydration, true afterwards. Wallet state only exists in the
 * browser, so wallet-dependent UI waits for this to avoid hydration mismatches.
 */
export function useMounted() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
