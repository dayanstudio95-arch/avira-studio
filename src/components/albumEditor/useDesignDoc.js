import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/api/supabaseClient";

const HISTORY_LIMIT = 100;
const SAVE_DEBOUNCE_MS = 2000;
const REVISION_EVERY_MS = 10 * 60 * 1000;

// The album design document with undo/redo and autosave (album editor, 2026-10-08).
// - edit(fn): fn(doc) → new doc, pushed to the undo stack.
// - Saves 2s after the last change: "update … where doc_version = <loaded>". 0 rows back means
//   someone else saved in between (another tab / computer) → `conflict`, and we stop saving
//   rather than overwrite their work.
// - Keeps a revision snapshot at most every 10 minutes (album_design_revisions).
export function useDesignDoc(design) {
  const [state, setState] = useState(() => ({ doc: design?.doc || null, past: [], future: [] }));
  const [saveState, setSaveState] = useState("saved"); // saved | dirty | saving | error | conflict
  const [saveError, setSaveError] = useState("");
  const versionRef = useRef(design?.doc_version || 1);
  const lastRevisionRef = useRef(0);
  const timerRef = useRef(null);
  const docRef = useRef(state.doc);
  docRef.current = state.doc;
  const conflictRef = useRef(false);

  const save = useCallback(async () => {
    if (!design?.id || conflictRef.current) return;
    const doc = docRef.current;
    const loaded = versionRef.current;
    setSaveState("saving");
    const { data, error } = await supabase
      .from("album_designs")
      .update({ doc, doc_version: loaded + 1 })
      .eq("id", design.id)
      .eq("doc_version", loaded)
      .select("doc_version");
    if (error) {
      setSaveState("error");
      setSaveError(error.message);
      return;
    }
    if (!data?.length) {
      conflictRef.current = true;
      setSaveState("conflict");
      return;
    }
    versionRef.current = loaded + 1;
    setSaveState(docRef.current === doc ? "saved" : "dirty");
    if (Date.now() - lastRevisionRef.current > REVISION_EVERY_MS) {
      lastRevisionRef.current = Date.now();
      await supabase.from("album_design_revisions").insert({ design_id: design.id, doc, doc_version: loaded + 1, label: "autosave" });
    }
  }, [design?.id]);

  const scheduleSave = useCallback(() => {
    setSaveState((s) => (s === "conflict" ? s : "dirty"));
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, SAVE_DEBOUNCE_MS);
  }, [save]);

  // Save on leave (tab close / navigation) if something is pending.
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (timerRef.current && !conflictRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearTimeout(timerRef.current);
    };
  }, []);

  // `mergeKey`: consecutive edits with the same key within a second (a slider being dragged,
  // a title being typed) become one undo step instead of fifty.
  const lastEditRef = useRef({ key: null, at: 0 });
  const edit = useCallback(
    (fn, mergeKey = null) => {
      const now = Date.now();
      const merge = mergeKey && lastEditRef.current.key === mergeKey && now - lastEditRef.current.at < 1000;
      lastEditRef.current = { key: mergeKey, at: now };
      setState((s) => {
        const next = fn(s.doc);
        if (!next || next === s.doc) return s;
        if (merge) return { ...s, doc: next, future: [] };
        return { doc: next, past: [...s.past, s.doc].slice(-HISTORY_LIMIT), future: [] };
      });
      scheduleSave();
    },
    [scheduleSave]
  );

  const undo = useCallback(() => {
    setState((s) => (s.past.length ? { doc: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.doc, ...s.future] } : s));
    scheduleSave();
  }, [scheduleSave]);

  const redo = useCallback(() => {
    setState((s) => (s.future.length ? { doc: s.future[0], past: [...s.past, s.doc], future: s.future.slice(1) } : s));
    scheduleSave();
  }, [scheduleSave]);

  const saveNow = useCallback(async () => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    await save();
  }, [save]);

  const snapshot = useCallback(
    async (label = "manual") => {
      if (!design?.id) return { error: "no design" };
      return supabase.from("album_design_revisions").insert({ design_id: design.id, doc: docRef.current, doc_version: versionRef.current, label });
    },
    [design?.id]
  );

  return {
    doc: state.doc,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    edit,
    undo,
    redo,
    saveNow,
    snapshot,
    saveState,
    saveError,
  };
}
