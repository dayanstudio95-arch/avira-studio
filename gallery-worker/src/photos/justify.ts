/** Justified rows (like Pixieset / Google Photos): every row fills the width, heights close to the target. */
export interface Placed<T> {
  item: T;
  width: number;
  height: number;
}

export function justify<T extends { ar: number }>(items: T[], width: number, target: number, gap: number): Placed<T>[][] {
  const rows: Placed<T>[][] = [];
  if (width <= 0) return rows;
  let row: T[] = [];
  let sum = 0;
  for (const it of items) {
    const ar = it.ar > 0 ? it.ar : 1.5;
    row.push(it);
    sum += ar;
    const rowWidthAtTarget = sum * target + gap * (row.length - 1);
    if (rowWidthAtTarget >= width) {
      const h = (width - gap * (row.length - 1)) / sum;
      rows.push(row.map((r) => ({ item: r, height: h, width: (r.ar > 0 ? r.ar : 1.5) * h })));
      row = [];
      sum = 0;
    }
  }
  if (row.length) rows.push(row.map((r) => ({ item: r, height: target, width: (r.ar > 0 ? r.ar : 1.5) * target })));
  return rows;
}
