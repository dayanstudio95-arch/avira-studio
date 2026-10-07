import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Phone, Video, Users, BellRing, Loader2 } from "lucide-react";
import { KINDS, israelLocalToUtc, utcToIsraelParts, todayIsrael } from "@/lib/meetings";

const KIND_ICONS = { call: Phone, zoom: Video, in_person: Users };
const ZOOM_KEY = "meeting_default_zoom_url";
const DURATIONS = [15, 30, 45, 60, 90];

// Book or edit a sales meeting (2026-10-07). Opened from a WhatsApp conversation (name and
// phone already filled), from a lead's side panel, or from the meetings list. The reminder
// itself is the server's job (meeting-reminders); this only writes the row.
//
// `meeting` — an existing one to edit; `initial` — { title, phone, conversationId, leadId }
// for a new one.
export default function MeetingDialog({ isOpen, onClose, meeting, initial, onSaved }) {
  const [form, setForm] = useState(null);
  const [defaultZoom, setDefaultZoom] = useState("");
  const [saveZoomDefault, setSaveZoomDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const parts = meeting ? utcToIsraelParts(meeting.startsAt) : { date: "", time: "" };
    setForm({
      title: meeting?.title || initial?.title || "",
      phone: meeting?.phone || initial?.phone || "",
      kind: meeting?.kind || "call",
      date: parts.date,
      time: parts.time,
      durationMin: meeting?.durationMin || 30,
      zoomUrl: meeting?.zoomUrl || "",
      location: meeting?.location || "",
      notes: meeting?.notes || "",
    });
    setSaveZoomDefault(false);
    base44.entities.AppSetting.filter({ key: ZOOM_KEY })
      .then((rows) => setDefaultZoom(rows?.[0]?.value || ""))
      .catch(() => setDefaultZoom(""));
  }, [isOpen, meeting, initial]);

  if (!isOpen || !form) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const startsAt = form.date && form.time ? israelLocalToUtc(form.date, form.time) : null;
  const inPast = startsAt && startsAt.getTime() < Date.now();

  const pickKind = (k) => {
    setForm((f) => ({ ...f, kind: k, zoomUrl: k === "zoom" && !f.zoomUrl ? defaultZoom : f.zoomUrl }));
  };

  const save = async () => {
    if (!form.title.trim()) { toast.error("חסר עם מי הפגישה"); return; }
    if (!startsAt) { toast.error("חסרים תאריך ושעה"); return; }
    setSaving(true);
    const values = {
      title: form.title.trim(),
      phone: form.phone.trim() || null,
      kind: form.kind,
      startsAt: startsAt.toISOString(),
      durationMin: Number(form.durationMin) || 30,
      zoomUrl: form.kind === "zoom" ? form.zoomUrl.trim() || null : null,
      location: form.kind === "in_person" ? form.location.trim() || null : null,
      notes: form.notes.trim() || null,
      updatedAt: new Date().toISOString(),
    };
    try {
      let saved;
      if (meeting) {
        // A new time means new reminders.
        const moved = meeting.startsAt !== values.startsAt;
        saved = await base44.entities.SalesMeeting.update(meeting.id, {
          ...values,
          ...(moved ? { reminderSentAt: null, secondReminderSentAt: null, acknowledgedAt: null } : {}),
        });
      } else {
        saved = await base44.entities.SalesMeeting.create({
          ...values,
          conversationId: initial?.conversationId || null,
          leadId: initial?.leadId || null,
        });
      }
      if (saveZoomDefault && values.zoomUrl) {
        const rows = await base44.entities.AppSetting.filter({ key: ZOOM_KEY }).catch(() => []);
        if (rows?.[0]) await base44.entities.AppSetting.update(rows[0].id, { value: values.zoomUrl });
        else await base44.entities.AppSetting.create({ key: ZOOM_KEY, value: values.zoomUrl });
      }
      toast.success(meeting ? "הפגישה עודכנה" : "הפגישה נקבעה · תזכורת תגיע 10 דק׳ לפני");
      onSaved?.(saved);
      onClose();
    } catch (e) {
      toast.error("שמירת הפגישה נכשלה", { description: e?.message });
    }
    setSaving(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto border-gray-700 bg-gray-900 text-white sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">{meeting ? "עריכת פגישה" : "📅 קביעת פגישה"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 space-y-1">
              <span className="text-xs text-gray-400">עם מי</span>
              <Input value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={120} placeholder="עדי ואור" className="border-gray-700 bg-gray-800 text-white" />
            </label>
            <label className="col-span-2 space-y-1">
              <span className="text-xs text-gray-400">טלפון</span>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} dir="ltr" placeholder="050-0000000" className="border-gray-700 bg-gray-800 text-white" />
            </label>
          </div>

          <div className="space-y-1">
            <span className="text-xs text-gray-400">סוג</span>
            <div className="flex gap-2">
              {KINDS.map((k) => {
                const Icon = KIND_ICONS[k.key];
                const on = form.kind === k.key;
                return (
                  <button
                    key={k.key}
                    type="button"
                    onClick={() => pickKind(k.key)}
                    aria-pressed={on}
                    className={`flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl border text-sm ${on ? "border-yellow-400 bg-yellow-400/15 font-semibold text-yellow-300" : "border-gray-700 bg-gray-800 text-gray-300"}`}
                  >
                    <Icon className="h-4 w-4" /> {k.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-1">
              <span className="text-xs text-gray-400">תאריך</span>
              <Input type="date" min={todayIsrael()} value={form.date} onChange={(e) => set("date", e.target.value)} dir="ltr" className="border-gray-700 bg-gray-800 px-2 text-white" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-gray-400">שעה</span>
              <Input type="time" step={300} value={form.time} onChange={(e) => set("time", e.target.value)} dir="ltr" className="border-gray-700 bg-gray-800 px-2 text-white" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-gray-400">משך</span>
              <select value={form.durationMin} onChange={(e) => set("durationMin", e.target.value)} className="h-9 w-full rounded-md border border-gray-700 bg-gray-800 px-2 text-white">
                {DURATIONS.map((d) => <option key={d} value={d}>{d} דק׳</option>)}
              </select>
            </label>
          </div>
          {inPast && <p className="text-xs text-amber-300">השעה הזו כבר עברה — לא תישלח תזכורת.</p>}

          {form.kind === "zoom" && (
            <label className="block space-y-1">
              <span className="text-xs text-gray-400">קישור לזום</span>
              <Input value={form.zoomUrl} onChange={(e) => set("zoomUrl", e.target.value)} dir="ltr" placeholder="https://zoom.us/j/…" className="border-gray-700 bg-gray-800 text-white" />
              {form.zoomUrl && form.zoomUrl !== defaultZoom && (
                <span className="flex items-center gap-2 text-xs text-gray-400">
                  <input type="checkbox" checked={saveZoomDefault} onChange={(e) => setSaveZoomDefault(e.target.checked)} />
                  לשמור כקישור הקבוע שלי
                </span>
              )}
            </label>
          )}
          {form.kind === "in_person" && (
            <label className="block space-y-1">
              <span className="text-xs text-gray-400">מקום</span>
              <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="הסטודיו / כתובת" className="border-gray-700 bg-gray-800 text-white" />
            </label>
          )}

          <label className="block space-y-1">
            <span className="text-xs text-gray-400">הערות</span>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder="על מה לדבר" className="border-gray-700 bg-gray-800 text-white" />
          </label>

          <p className="flex items-center gap-1.5 text-xs text-gray-400">
            <BellRing className="h-3.5 w-3.5 text-yellow-400" />
            תזכורת בטלפון 10 דק׳ לפני, ושוב אחרי 5 דק׳ אם לא אישרת שראית
          </p>

          <div className="flex gap-2 pt-1">
            <Button onClick={save} disabled={saving} className="flex-1 bg-yellow-400 font-semibold text-gray-900 hover:bg-yellow-300">
              {saving && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
              {meeting ? "שמור שינויים" : "קבע פגישה"}
            </Button>
            <Button variant="outline" onClick={onClose} disabled={saving} className="border-gray-700 bg-gray-800 text-gray-300">ביטול</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
