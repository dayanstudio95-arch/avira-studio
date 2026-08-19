// The ONE page the "lead_coordinator" role can reach (see src/App.jsx's restructured
// gate) — create new leads and share the couple-facing contract link. Deliberately no
// pricing/discount/payment UI anywhere on this page: the backing edge function
// (supabase/functions/coordinator-leads/index.ts) never returns or accepts financial
// fields, and RLS (0029_scoped_roles.sql) additionally scopes this role's SELECT on
// `leads` to only rows it created itself — this page's `list` call already reflects
// that scoping, this comment is just documenting why there's no "all leads" view here.
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Link as LinkIcon, Loader2, Heart } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/lib/SupabaseAuthContext";

const emptyForm = {
  coupleNames: "",
  phone: "",
  email: "",
  eventDate: "",
  venueName: "",
  notes: "",
};

export default function LeadsCoordinator() {
  const { user } = useAuth();
  const [leads, setLeads] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const getContractLink = (leadId) => `${window.location.origin}/contract/${leadId}`;

  const loadLeads = async () => {
    setIsLoading(true);
    try {
      const res = await base44.functions.invoke("coordinatorLeads", { action: "list" });
      setLeads(res?.data?.leads || []);
    } catch (error) {
      console.error("Failed to load leads:", error);
      toast.error("שגיאה בטעינת הלידים");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLeads();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.coupleNames.trim()) {
      toast.error("יש להזין שם זוג");
      return;
    }
    setIsSaving(true);
    try {
      const res = await base44.functions.invoke("coordinatorLeads", {
        action: "create",
        coupleNames: form.coupleNames,
        phone: form.phone,
        email: form.email,
        eventDate: form.eventDate,
        venueName: form.venueName,
        notes: form.notes,
      });
      if (res?.data?.error) {
        toast.error(res.data.error);
        return;
      }
      toast.success("הליד נוצר בהצלחה");
      setForm(emptyForm);
      setIsFormOpen(false);
      loadLeads();
    } catch (error) {
      console.error("Failed to create lead:", error);
      toast.error(error.message || "שגיאה ביצירת הליד");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyLink = (lead) => {
    navigator.clipboard.writeText(getContractLink(lead.id));
    setCopiedId(lead.id);
    toast.success("הקישור לחוזה הועתק");
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Heart className="w-6 h-6 text-yellow-400" />
            לידים חדשים
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            שלום {user?.full_name || ""} — כאן ניתן ליצור ליד חדש ולשתף איתו את קישור החוזה.
          </p>
        </div>
        <Button onClick={() => setIsFormOpen(true)} className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold gap-2">
          <Plus className="w-4 h-4" />
          ליד חדש
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      ) : leads.length === 0 ? (
        <div className="text-center py-16 text-gray-500">עדיין לא יצרת לידים.</div>
      ) : (
        <div className="space-y-3">
          {leads.map((lead) => (
            <div key={lead.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <p className="font-semibold text-white">{lead.couple_names}</p>
                <p className="text-sm text-gray-400">
                  {lead.phone_number || "—"} · {lead.venue_name || "—"} ·{" "}
                  {lead.event_date ? format(new Date(lead.event_date), "dd/MM/yyyy") : "אין תאריך"}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  סטטוס: {lead.status || "חדש"} {lead.signed_at ? "· חוזה נחתם ✅" : lead.contract_sent ? "· חוזה נשלח" : ""}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => handleCopyLink(lead)}
                className="gap-2 border-gray-700 text-gray-200 hover:bg-gray-800"
              >
                <LinkIcon className="w-4 h-4" />
                {copiedId === lead.id ? "הועתק!" : "העתק קישור לחוזה"}
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="bg-gray-900 border-gray-800 text-white">
          <DialogHeader>
            <DialogTitle>ליד חדש</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <Label>שם זוג *</Label>
              <Input
                value={form.coupleNames}
                onChange={(e) => setForm((f) => ({ ...f, coupleNames: e.target.value }))}
                placeholder="דנה ויוסי"
                className="bg-gray-800 border-gray-700"
                required
              />
            </div>
            <div>
              <Label>טלפון</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="bg-gray-800 border-gray-700"
              />
            </div>
            <div>
              <Label>אימייל</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="bg-gray-800 border-gray-700"
              />
            </div>
            <div>
              <Label>תאריך אירוע</Label>
              <Input
                type="date"
                value={form.eventDate}
                onChange={(e) => setForm((f) => ({ ...f, eventDate: e.target.value }))}
                className="bg-gray-800 border-gray-700"
              />
            </div>
            <div>
              <Label>אולם / מקום</Label>
              <Input
                value={form.venueName}
                onChange={(e) => setForm((f) => ({ ...f, venueName: e.target.value }))}
                className="bg-gray-800 border-gray-700"
              />
            </div>
            <div>
              <Label>הערות</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="bg-gray-800 border-gray-700"
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isSaving} className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold">
                {isSaving ? "שומר..." : "שמור ליד"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
