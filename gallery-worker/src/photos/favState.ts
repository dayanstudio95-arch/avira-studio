// Hearts and Instagram marks on the couple's page (P72): what the server last said, plus the
// changes still on their way. Taps feel instant, yet
//  - an older answer never overwrites a newer one (quick taps: 3, →, 3);
//  - a failed request takes back only its own photos, not the taps made since;
//  - answers that came back out of order ask for one fresh read (the caller's GET /api/watch/:id),
//    since the server may have applied the requests in another order than they were sent.

export interface Answer {
  /** The answers came back out of order: read the whole state again once. */
  refresh: boolean;
}

export class FavState<V> {
  private server: Record<string, V>;
  /** The request whose answer `server` is (0 = the page's first read). */
  private serverSeq = 0;
  private seq = 0;
  /** Per photo: the value it will have, and which request is taking it there. */
  private pending = new Map<string, { seq: number; value: V }>();
  /** Requests sent and not answered yet. */
  private open = new Set<number>();

  /** `isEmpty`: a value that means "not marked" (no people left, false), dropped from the view. */
  constructor(initial: Record<string, V>, private isEmpty: (v: V) => boolean) {
    this.server = { ...initial };
  }

  /** What the page shows: the server's state with the changes on their way on top. */
  view(): Record<string, V> {
    const out: Record<string, V> = { ...this.server };
    for (const [key, p] of this.pending) out[key] = p.value;
    for (const key of Object.keys(out)) if (this.isEmpty(out[key])) delete out[key];
    return out;
  }

  /** A request is going out with these new values; returns its number (for answer/fail). */
  begin(changes: Record<string, V>): number {
    const seq = ++this.seq;
    this.open.add(seq);
    for (const [key, value] of Object.entries(changes)) this.pending.set(key, { seq, value });
    return seq;
  }

  /** The server answered request `seq` with its whole state. */
  answer(seq: number, state: Record<string, V>): Answer {
    this.open.delete(seq);
    this.settle(seq);
    if (seq < this.serverSeq) return { refresh: true }; // older than what we have: dropped
    this.server = { ...state };
    this.serverSeq = seq;
    // An earlier request still on its way may be applied after this one on the server.
    return { refresh: [...this.open].some((s) => s < seq) };
  }

  /** Request `seq` failed: only its own photos go back to what the server said. */
  fail(seq: number): void {
    this.open.delete(seq);
    this.settle(seq);
  }

  private settle(seq: number) {
    for (const [key, p] of this.pending) if (p.seq === seq) this.pending.delete(key);
  }
}

/** Hearts: photo → the people who hearted it ('' = without a name). */
export const heartState = (favBy: Record<string, string[]>) => new FavState<string[]>(favBy, (v) => v.length === 0);

/** Instagram marks: photo → marked. */
export const instaState = (keys: string[]) => new FavState<boolean>(Object.fromEntries(keys.map((k) => [k, true])), (v) => !v);
export const instaRecord = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, true]));
