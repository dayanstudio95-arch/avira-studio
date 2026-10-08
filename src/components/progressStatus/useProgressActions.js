import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { confirmDialog } from "@/components/ui/confirm-dialog";

// Everything a work-status row can do (mark a role / raw / final / album done, save the
// links, send to the editor / the couple / the album graphic designer). Moved out of
// ProgressStatus.jsx unchanged on 2026-10-09 so the dashboard's progress window (same row,
// same database fields) behaves exactly like the page.
// `setEvents` updates the caller's copy of the events after a change.
export function useProgressActions({ setEvents, staffMembers }) {
  const [pendingLinks, setPendingLinks] = useState({});
  const [sendingEditor, setSendingEditor] = useState({});
  const [sendingCouple, setSendingCouple] = useState({});
  const [sendingGraphic, setSendingGraphic] = useState({});
  const [sendingAlbumCouple, setSendingAlbumCouple] = useState({});

  const updateField = async (eventId, field, value) => {
    try {
      await base44.entities.Event.update(eventId, { [field]: value });
      setEvents(prev => prev.map(e => e?.id === eventId ? { ...e, [field]: value } : e));
    } catch {
      toast.error("שגיאה בשמירה");
    }
  };

  const saveLinkOnBlur = async (eventId, field) => {
    const key = `${eventId}-${field}`;
    const value = pendingLinks[key];
    if (value === undefined) return;
    await updateField(eventId, field, value);
    setPendingLinks(prev => { const next = { ...prev }; delete next[key]; return next; });
  };

  const handleSendToEditor = async (event) => {
    if (event?.rawSentToEditor) {
      toast.warning('גלם כבר נשלח לעורך עבור אירוע זה');
      return;
    }
    const rawLink = event?.rawLink || pendingLinks[`${event?.id}-rawLink`];
    if (!rawLink) { toast.error('נא להזין לינק גלם לפני השליחה'); return; }

    const editorMember = (event?.team || []).find(m => m?.role === 'editor');
    if (!editorMember?.staffMemberName) { toast.error('לא הוגדר עורך לאירוע זה'); return; }

    const staffRecord = staffMembers.find(s => s?.name === editorMember.staffMemberName);
    if (!staffRecord?.phoneNumber) { toast.error('חסר טלפון לעורך ' + editorMember.staffMemberName); return; }

    setSendingEditor(prev => ({ ...prev, [event.id]: true }));
    try {
      await base44.functions.invoke('sendToEditor', {
        eventId: event.id,
        coupleNames: event?.coupleNames,
        eventDate: event?.date,
        venue: event?.venue,
        phoneNumber: event?.phoneNumber,
        editorName: editorMember.staffMemberName,
        editorPhone: staffRecord.phoneNumber,
        rawLink,
      });
      setEvents(prev => prev.map(e => e?.id === event.id
        ? { ...e, rawSentToEditor: true, rawSentAt: new Date().toISOString() }
        : e
      ));
      toast.success('נשלח לעורך בהצלחה ✅');
    } catch (err) {
      toast.error('שגיאה בשליחה: ' + (err?.message || ''));
    } finally {
      setSendingEditor(prev => ({ ...prev, [event.id]: false }));
    }
  };

  const handleSendToCouple = async (event) => {
    const finalLink = event?.finalLink || pendingLinks[`${event?.id}-finalLink`];
    if (!finalLink) { toast.error('נא להזין לינק סופי לפני השליחה'); return; }
    if (!event?.phoneNumber) { toast.error('חסר טלפון זוג לאירוע'); return; }
    // Daniel's decision R4 (2026-10-06): a second send to the couple only after asking.
    if (event?.finalDoneManual && !await confirmDialog(`הגלריה כבר סומנה כנשלחה ל${event?.coupleNames || 'זוג'}. לשלוח שוב?`)) return;

    setSendingCouple(prev => ({ ...prev, [event.id]: true }));
    try {
      await base44.functions.invoke('sendToCouple', {
        eventId: event.id,
        coupleNames: event?.coupleNames,
        eventDate: event?.date,
        venue: event?.venue,
        phoneNumber: event?.phoneNumber,
        finalLink,
      });
      setEvents(prev => prev.map(e => e?.id === event.id
        ? { ...e, finalDoneManual: true }
        : e
      ));
      toast.success('נשלח לזוג בהצלחה ✅');
    } catch (err) {
      toast.error('שגיאה בשליחה: ' + (err?.message || ''));
    } finally {
      setSendingCouple(prev => ({ ...prev, [event.id]: false }));
    }
  };

  const handleSendAlbumToGraphic = async (event) => {
    if (!event?.albumSketchLink && !pendingLinks[`${event?.id}-albumSketchLink`]) {
      toast.error('נא להזין לינק סקיצת אלבום לפני השליחה');
      return;
    }
    // save link first if pending
    const key = `${event?.id}-albumSketchLink`;
    if (pendingLinks[key] !== undefined) {
      await updateField(event.id, 'albumSketchLink', pendingLinks[key]);
      setPendingLinks(prev => { const next = { ...prev }; delete next[key]; return next; });
    }
    setSendingGraphic(prev => ({ ...prev, [event.id]: true }));
    try {
      await base44.functions.invoke('sendAlbumSketch', { eventId: event.id, target: 'graphic' });
      setEvents(prev => prev.map(e => e?.id === event.id ? { ...e, albumSketchGraphicNotified: true } : e));
      toast.success('נשלח לגרפיקאית בהצלחה ✅');
    } catch (err) {
      toast.error('שגיאה בשליחה: ' + (err?.message || ''));
    } finally {
      setSendingGraphic(prev => ({ ...prev, [event.id]: false }));
    }
  };

  const handleSendAlbumToCouple = async (event) => {
    if (!event?.albumSketchLink && !pendingLinks[`${event?.id}-albumSketchLink`]) {
      toast.error('נא להזין לינק סקיצת אלבום לפני השליחה');
      return;
    }
    const key = `${event?.id}-albumSketchLink`;
    if (pendingLinks[key] !== undefined) {
      await updateField(event.id, 'albumSketchLink', pendingLinks[key]);
      setPendingLinks(prev => { const next = { ...prev }; delete next[key]; return next; });
    }
    // Daniel's decision R4: a second send of the album sketch to the couple only after asking.
    if (event?.albumSketchCoupleNotified && !await confirmDialog(`סקיצת האלבום כבר נשלחה ל${event?.coupleNames || 'זוג'}. לשלוח שוב?`)) return;
    setSendingAlbumCouple(prev => ({ ...prev, [event.id]: true }));
    try {
      await base44.functions.invoke('sendAlbumSketch', { eventId: event.id, target: 'couple' });
      setEvents(prev => prev.map(e => e?.id === event.id ? { ...e, albumSketchCoupleNotified: true } : e));
      toast.success('סקיצת האלבום נשלחה לזוג בהצלחה ✅');
    } catch (err) {
      toast.error('שגיאה בשליחה: ' + (err?.message || ''));
    } finally {
      setSendingAlbumCouple(prev => ({ ...prev, [event.id]: false }));
    }
  };

  const getLinkValue = (event, field) => {
    const key = `${event?.id}-${field}`;
    return pendingLinks[key] !== undefined ? pendingLinks[key] : (event?.[field] || "");
  };


  return {
    pendingLinks, setPendingLinks, sendingEditor, sendingCouple, sendingGraphic, sendingAlbumCouple,
    updateField, saveLinkOnBlur, getLinkValue,
    handleSendToEditor, handleSendToCouple, handleSendAlbumToGraphic, handleSendAlbumToCouple,
  };
}
