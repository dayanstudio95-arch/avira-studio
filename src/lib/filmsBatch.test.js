// Fix plan P70: the galleries list in pages, and batches that go on by themselves and say what they skipped.
import { describe, expect, it } from "vitest";
import { batchMessages, needsConfirm, readAllGalleries, runBatch, withoutSkipped } from "./filmsBatch";

describe("readAllGalleries", () => {
  it("reads every page until the total, and keeps a gallery seen twice (a new one shifted the pages) once", async () => {
    const all = Array.from({ length: 1200 }, (_, i) => ({ id: `g${i}` }));
    const asked = [];
    let extra = false;
    const get = async (path) => {
      asked.push(path);
      const u = new URL(path, "http://x");
      const limit = Number(u.searchParams.get("limit"));
      const offset = Number(u.searchParams.get("offset"));
      // A gallery made after the first page: every later page starts one gallery earlier.
      const list = extra ? [{ id: "new" }, ...all] : all;
      if (offset > 0) extra = true;
      return { items: list.slice(offset, offset + limit), total: list.length };
    };
    const got = await readAllGalleries(get);
    expect(asked).toEqual(["/api/admin/galleries?limit=500&offset=0", "/api/admin/galleries?limit=500&offset=500", "/api/admin/galleries?limit=500&offset=1000"]);
    expect(new Set(got.map((g) => g.id)).size).toBe(got.length);
    expect(got.filter((g) => g.id.startsWith("g")).length).toBe(1200);
  });

  it("a failed page fails the whole read", async () => {
    let n = 0;
    const get = async () => {
      if (++n === 2) throw new Error("שגיאה (500)");
      return { items: Array.from({ length: 500 }, (_, i) => ({ id: `a${i}` })), total: 900 };
    };
    await expect(readAllGalleries(get)).rejects.toThrow("שגיאה (500)");
  });
});

describe("runBatch", () => {
  it("collects the reopened galleries whose face search went off when its data was deleted (fix plan P68)", async () => {
    const send = async (body) => (body.ids.length === 3 ? { done: 1, doneIds: ["a"], skipped: [], remaining: ["b", "c"], faceSearchOff: ["a"] } : { done: 2, doneIds: ["b", "c"], skipped: [], remaining: [], faceSearchOff: ["c"] });
    const r = await runBatch(send, "restore", ["a", "b", "c"]);
    expect(r.faceSearchOff).toEqual(["a", "c"]);
    expect((await runBatch(async () => ({ done: 1, doneIds: ["x"], skipped: [] }), "extend", ["x"])).faceSearchOff).toEqual([]);
  });

  it("sends the photo galleries the Worker left for later again, until none is left, and adds the answers up", async () => {
    const sent = [];
    const send = async (body) => {
      sent.push(body.ids);
      const real = body.ids.filter((id) => id !== "x");
      const now = real.slice(0, 6);
      return { done: now.length, doneIds: now, skipped: body.ids.includes("x") ? [{ id: "x", reason: "not_found" }] : [], remaining: real.slice(6) };
    };
    const ids = ["x", ...Array.from({ length: 14 }, (_, i) => `p${i}`)];
    const r = await runBatch(send, "trash", ids);
    expect(sent.length).toBe(3);
    expect(r.done).toBe(14);
    expect(r.skipped).toEqual([{ id: "x", reason: "not_found" }]);
  });

  it("stops when a request moves nothing", async () => {
    let calls = 0;
    const r = await runBatch(async (body) => (calls++, { done: 0, doneIds: [], skipped: [], remaining: body.ids }), "purge", ["a", "b"]);
    expect(calls).toBe(1);
    expect(r.skipped.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("passes the extra fields (days, the closing times the screen saw) with every request", async () => {
    let got;
    await runBatch(async (body) => ((got = body), { done: 1, doneIds: ["a"], skipped: [], remaining: [] }), "extend", ["a"], { days: 10, seen: { a: "2026-10-01T20:59:59.000Z" } });
    expect(got).toEqual({ action: "extend", ids: ["a"], days: 10, seen: { a: "2026-10-01T20:59:59.000Z" } });
  });
});

describe("batchMessages", () => {
  it("says how many were done and which were skipped and why, by name", () => {
    const m = batchMessages({ done: 2, skipped: [{ id: "a", reason: "changed" }, { id: "b", reason: "faces_failed" }] }, "extend", { a: "נועה & איתי" });
    expect(m.success).toBe("2 גלריות הוארכו");
    expect(m.warning).toContain("גלריה אחת דולגה (נועה & איתי): השתנו בינתיים");
    expect(m.warning).toContain("גלריה אחת דולגה (b): נתוני זיהוי הפנים");
    expect(batchMessages({ done: 1, skipped: [] }, "trash").success).toBe("גלריה אחת הועברה לסל המחזור");
    expect(batchMessages({ done: 0, skipped: [] }, "close")).toEqual({ success: "", warning: "" });
  });
});

describe("P71: a designed album keeps its gallery", () => {
  it("the galleries waiting for the studio's yes are asked about apart; the others are said in words", () => {
    const r = { done: 1, doneIds: ["c"], skipped: [{ id: "a", reason: "album_submitted" }, { id: "b", reason: "album_order" }] };
    expect(needsConfirm(r)).toEqual(["a"]);
    expect(withoutSkipped(r, "album_submitted").skipped).toEqual([{ id: "b", reason: "album_order" }]);
    const m = batchMessages({ done: 0, skipped: [{ id: "b", reason: "album_order" }, { id: "d", reason: "album_paid" }] }, "purge", { b: "נועה & איתי" });
    expect(m.warning).toContain("גלריה אחת דולגה (נועה & איתי): יש להן הזמנת אלבום פתוחה");
    expect(m.warning).toContain("הזמנת אלבום ששולמה או בהדפסה");
  });
});
