// Reading when each photo was taken (and its Lightroom colour) through the films Worker's
// `…/photos/dates` (fix plan P62, P64). The Worker reads at most datesBatchSize(provider) photos per
// call (its outside-request budget), so batches have that size; it answers its own size in `batch`
// (Drive without the studio's API key reads fewer) and the batches after that use it. What it did not
// try (`skipped`, past its size) goes back in the queue; what it could not read (`failed`) is asked
// again, up to `retries` times, and a photo that still failed is reported here, so the photo screen
// doesn't mark it as read (it is tried again next time the screen opens).
import { datesBatchSize } from "@films-shared/photosets";

/**
 * `post` sends one batch and answers the Worker's `{ dates, labels, failed?, skipped?, batch? }`.
 * @param {{ keys: string[], provider?: string, post: (keys: string[]) => Promise<any>, onProgress?: (done: number, total: number) => void, lanes?: number, retries?: number }} opts
 * @returns {Promise<{ dates: Record<string, number|null>, labels: Record<string, string>, failed: string[] }>}
 */
export async function readPhotoDates({ keys, provider, post, onProgress = () => {}, lanes = 3, retries = 3 }) {
  let size = datesBatchSize(provider);
  /** @type {Record<string, number|null>} */
  const dates = {};
  /** @type {Record<string, string>} */
  const labels = {};
  // A photo counts toward the progress once: the first time the Worker read it or failed it.
  const answered = new Set();
  let todo = [...keys];
  for (let round = 0; round <= retries && todo.length; round++) {
    const queue = [...todo];
    const failed = new Set();
    const worker = async () => {
      while (queue.length) {
        const batch = queue.splice(0, size);
        // An error (Dropbox needs reconnecting…) stops everything: the screen shows it.
        const r = await post(batch);
        if (Number.isInteger(r?.batch) && r.batch > 0 && r.batch < size) size = r.batch;
        // A Worker from before P62 sends no `failed`: everything it answered counts as read.
        const miss = new Set(Array.isArray(r?.failed) ? r.failed : []);
        const later = new Set(Array.isArray(r?.skipped) ? r.skipped : []);
        const tried = batch.filter((k) => !later.has(k));
        // A Worker that tried none of them would be asked forever: that batch counts as failed.
        if (tried.length === 0) for (const k of batch) miss.add(k);
        else queue.push(...batch.filter((k) => later.has(k)));
        for (const k of tried.length ? tried : batch) {
          answered.add(k);
          if (miss.has(k)) {
            failed.add(k);
            continue;
          }
          dates[k] = r?.dates?.[k] ?? null;
          labels[k] = r?.labels?.[k] ?? "";
        }
        onProgress(answered.size, keys.length);
      }
    };
    await Promise.all(Array.from({ length: lanes }, worker));
    todo = todo.filter((k) => failed.has(k));
  }
  return { dates, labels, failed: todo };
}
