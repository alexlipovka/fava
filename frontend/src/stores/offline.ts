import { writable } from "svelte/store";

/** True when the browser reports no network connection. */
export const is_offline = writable(
  typeof navigator !== "undefined" ? !navigator.onLine : false,
);

/** Number of entries queued in IndexedDB waiting to sync. */
export const pending_count = writable(0);
