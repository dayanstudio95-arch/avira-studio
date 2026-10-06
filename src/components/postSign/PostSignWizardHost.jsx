import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { rowToRecord } from "@/api/entities";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { isAdmin } from "@/lib/permissions";
import { todayInIsrael } from "@/lib/localDate";
import { isPostSignPending, SIGNED_STATUS } from "@/lib/postSignFlow";
import PostSignWizard, { isSessionSnoozed, isAnyWizardOpen } from "./PostSignWizard";

// Pops the "after signing" wizard up by itself, on any admin screen (2026-10-07). Looks for
// couples who signed (status חוזה) or whose wizard is unfinished: on load, every 60 seconds
// while the tab is visible, and when the owner comes back to the tab — so a couple who signs
// while he is in the system shows up within a minute. One couple at a time; after he closes
// or snoozes one, the next appears on the following check. Admins only (the wizard writes
// financial columns that 0020 reserves for them).
const POLL_MS = 60_000;

// Never on top of something the owner is in the middle of (a side panel, an invoice, a form):
// any open dialog/sheet postpones the popup to the next check.
function isOtherDialogOpen() {
  return !!document.querySelector('[role="dialog"]');
}

export default function PostSignWizardHost() {
  const { user } = useAuth();
  const enabled = isAdmin(user);
  const [lead, setLead] = useState(null);
  const openRef = useRef(false);

  const check = useCallback(async () => {
    if (!enabled || openRef.current || isAnyWizardOpen() || isOtherDialogOpen() || document.visibilityState !== "visible") return;
    try {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .or(`status.eq."${SIGNED_STATUS}",post_sign_flow.not.is.null`)
        .or(`event_date.is.null,event_date.gte.${todayInIsrael()}`)
        .order("signed_at", { ascending: true, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      const now = new Date();
      const next = (data || []).map(rowToRecord).find((l) => isPostSignPending(l, now) && !isSessionSnoozed(l.id));
      // Re-checked after the query: a wizard may have been opened from the panel meanwhile.
      if (next && !openRef.current && !isAnyWizardOpen() && !isOtherDialogOpen()) {
        openRef.current = true;
        setLead(next);
      }
    } catch (e) {
      // Before 0074 runs the column doesn't exist — stay silent, never break the app.
      console.warn("PostSignWizardHost: check failed", e?.message || e);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(check, 2500); // let the page itself load first
    const timer = setInterval(check, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, check]);

  if (!enabled || !lead) return null;

  return (
    <PostSignWizard
      lead={lead}
      isOpen
      onClose={() => { openRef.current = false; setLead(null); }}
    />
  );
}
