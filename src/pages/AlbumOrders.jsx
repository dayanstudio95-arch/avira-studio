import React, { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { createPageUrl } from "@/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { BookImage, Plus, Search, Link2, PenLine, Trash2 } from "lucide-react";

const BUCKET = "album-files";

// Wedding Albums module -- order list + creation. Orders can be linked to an existing
// `events` row, or stand alone via manual couple/date/phone fields (e.g. a 2024 couple
// who wants an album and may no longer be a live event in the system) -- see
// CLAUDE.md's "Wedding Albums module" section, decision 6 in the working plan.

export const WORKFLOW_STATUS_LABELS = {
  draft: "טיוטה",
  sketch_uploaded: "סקיצה הועלתה",
  in_review: "בבדיקת הזוג",
  revision_requested: "נדרש תיקון",
  approved: "אושר",
  product_selected: "מוצר נבחר",
  awaiting_payment: "ממתין לתשלום",
  paid: "שולם",
  in_print: "בהדפסה",
  delivered: "נמסר",
  completed: "הושלם",
};

export const WORKFLOW_STATUS_COLORS = {
  draft: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  sketch_uploaded: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  in_review: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  revision_requested: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  approved: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  product_selected: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  awaiting_payment: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  paid: "bg-green-500/20 text-green-400 border-green-500/30",
  in_print: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  delivered: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

export const PAYMENT_STATUS_LABELS = {
  unpaid: "לא שולם",
  transfer_pending_review: "העברה ממתינה לאישור",
  paid: "שולם",
};

// "שולם" gets a bold/prominent green treatment everywhere it's shown (list rows here +
// AlbumOrderDetail.jsx's payment card) so a paid order is instantly recognizable at a
// glance, distinct from the neutral-gray treatment every other payment status keeps.
export const PAYMENT_STATUS_COLORS = {
  unpaid: "border-gray-700 bg-gray-800 text-gray-400",
  transfer_pending_review: "border-amber-500/30 bg-amber-500/20 text-amber-400",
  paid: "border-green-500/40 bg-green-500/20 text-green-400 font-semibold",
};

export default function AlbumOrders() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [linkMode, setLinkMode] = useState("event"); // 'event' | 'manual'
  const [eventSearch, setEventSearch] = useState("");
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [manualForm, setManualForm] = useState({ coupleNamesManual: "", weddingDateManual: "", phoneManual: "" });

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["albumOrders"],
    queryFn: () => base44.entities.AlbumOrder.list("-createdDate"),
  });

  const { data: events = [] } = useQuery({
    queryKey: ["eventsForAlbumLink"],
    queryFn: () => base44.entities.Event.list("-date", 500),
  });

  const eventsById = useMemo(() => {
    const map = {};
    for (const ev of events) map[ev.id] = ev;
    return map;
  }, [events]);

  const filteredEvents = useMemo(() => {
    if (!eventSearch.trim()) return events.slice(0, 20);
    const q = eventSearch.trim().toLowerCase();
    return events.filter((ev) => (ev.coupleNames || "").toLowerCase().includes(q)).slice(0, 20);
  }, [events, eventSearch]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.AlbumOrder.create(data),
    onSuccess: (newOrder) => {
      queryClient.invalidateQueries({ queryKey: ["albumOrders"] });
      handleCloseDialog();
      toast.success("הזמנת אלבום נוצרה");
      navigate(createPageUrl(`AlbumOrders/${newOrder.id}`));
    },
    onError: (err) => toast.error(err.message || "שגיאה ביצירת ההזמנה"),
  });

  // DB-level FKs (album_versions/album_review_rounds/album_order_selections/
  // album_order_addons/print_access_links, all "on delete cascade" -- see
  // 0031_wedding_albums.sql) clean up every child row automatically once the order
  // itself is deleted. They never touch actual Storage *files* though, so those are
  // collected and removed explicitly first -- otherwise every spread image (and the
  // bank-transfer proof file, if any) would be orphaned forever in the album-files
  // bucket with nothing left in the DB pointing at them.
  const deleteOrderMutation = useMutation({
    mutationFn: async (order) => {
      const versions = await base44.entities.AlbumVersion.filter({ albumOrderId: order.id });
      const spreadsByVersion = await Promise.all(
        versions.map((v) => base44.entities.AlbumSpread.filter({ versionId: v.id }))
      );
      // Each spread also has a separate thumbnail Storage object (thumbFileKey,
      // added in 0043_album_spread_thumbnails.sql) alongside the full-res original
      // (fileKey) -- both must be collected or the thumbnail is left orphaned.
      const paths = spreadsByVersion.flat().flatMap((s) => [s.fileKey, s.thumbFileKey]).filter(Boolean);
      if (order.transferProofFileKey) paths.push(order.transferProofFileKey);
      if (paths.length > 0) {
        await supabase.storage.from(BUCKET).remove(paths).catch(() => {});
      }
      await base44.entities.AlbumOrder.delete(order.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["albumOrders"] });
      toast.success("ההזמנה נמחקה");
    },
    onError: (err) => toast.error(err.message || "שגיאה במחיקת ההזמנה"),
  });

  const handleDeleteOrder = (e, order) => {
    e.preventDefault();
    e.stopPropagation();
    if (
      !confirm(
        `למחוק לצמיתות את הזמנת האלבום של ${displayName(order)}? כל הגרסאות, הקבצים, סבבי הבדיקה, בחירות המוצר והקישורים (לזוג/למעבדת הדפסה) יימחקו ולא ניתן יהיה לשחזר.`
      )
    ) {
      return;
    }
    deleteOrderMutation.mutate(order);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setLinkMode("event");
    setEventSearch("");
    setSelectedEventId(null);
    setManualForm({ coupleNamesManual: "", weddingDateManual: "", phoneManual: "" });
  };

  const handleCreate = () => {
    if (linkMode === "event") {
      if (!selectedEventId) {
        toast.error("יש לבחור אירוע");
        return;
      }
      createMutation.mutate({ eventId: selectedEventId, workflowStatus: "draft", paymentStatus: "unpaid" });
    } else {
      if (!manualForm.coupleNamesManual.trim()) {
        toast.error("יש להזין שם זוג");
        return;
      }
      createMutation.mutate({
        eventId: null,
        coupleNamesManual: manualForm.coupleNamesManual.trim(),
        weddingDateManual: manualForm.weddingDateManual || null,
        phoneManual: manualForm.phoneManual || null,
        workflowStatus: "draft",
        paymentStatus: "unpaid",
      });
    }
  };

  const displayName = (order) => {
    if (order.eventId && eventsById[order.eventId]) return eventsById[order.eventId].coupleNames;
    return order.coupleNamesManual || "ללא שם";
  };

  const displayDate = (order) => {
    if (order.eventId && eventsById[order.eventId]) return eventsById[order.eventId].date;
    return order.weddingDateManual;
  };

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      if (statusFilter !== "all" && order.workflowStatus !== statusFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const name = (displayName(order) || "").toLowerCase();
        const phone = order.eventId ? eventsById[order.eventId]?.phoneNumber || "" : order.phoneManual || "";
        if (!name.includes(q) && !phone.includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, statusFilter, searchTerm, eventsById]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 p-4 md:p-8">
        <div className="max-w-6xl mx-auto animate-pulse space-y-6">
          <div className="h-12 bg-gray-800 rounded-lg w-64"></div>
          <div className="space-y-3">
            {Array(5).fill(0).map((_, i) => (
              <div key={i} className="h-20 bg-gray-800 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8" dir="rtl">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 flex items-center gap-3">
              <BookImage className="w-8 h-8 text-yellow-400" />
              הזמנות אלבומים
            </h1>
            <p className="text-gray-400">ניהול הזמנות אלבום, מסקיצה ועד משלוח להדפסה</p>
          </div>
          <Button onClick={() => setIsDialogOpen(true)} className="bg-yellow-400 text-gray-900 hover:bg-yellow-500">
            <Plus className="w-5 h-5 mr-2" />
            הזמנה חדשה
          </Button>
        </div>

        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <Input
              placeholder="חיפוש לפי שם זוג או טלפון..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-gray-900 border-gray-800 text-white pr-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="bg-gray-900 border-gray-800 text-white md:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הסטטוסים</SelectItem>
              {Object.entries(WORKFLOW_STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {filteredOrders.length === 0 ? (
          <Card className="bg-gray-900/50 border-gray-800 text-center p-12">
            <BookImage className="w-16 h-16 mx-auto text-gray-600 mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">אין הזמנות אלבומים</h3>
            <p className="text-gray-400 mb-6">צור את ההזמנה הראשונה</p>
            <Button onClick={() => setIsDialogOpen(true)} className="bg-yellow-400 text-gray-900 hover:bg-yellow-500">
              <Plus className="w-5 h-5 mr-2" />
              הזמנה חדשה
            </Button>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredOrders.map((order) => (
              <Link key={order.id} to={createPageUrl(`AlbumOrders/${order.id}`)}>
                <Card className="bg-gray-900/50 border-gray-800 hover:border-yellow-400/30 transition-all duration-200 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-semibold text-lg">{displayName(order)}</span>
                      {!order.eventId && (
                        <Badge variant="outline" className="border-gray-700 bg-gray-800 text-gray-500 text-xs">ללא אירוע מקושר</Badge>
                      )}
                    </div>
                    <p className="text-gray-500 text-sm mt-1">
                      {displayDate(order) || "ללא תאריך"}
                      {order.totalAmount ? ` · ₪${Number(order.totalAmount).toLocaleString()}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={WORKFLOW_STATUS_COLORS[order.workflowStatus] || "bg-gray-500/20 text-gray-400 border-gray-500/30"}>
                      {WORKFLOW_STATUS_LABELS[order.workflowStatus] || order.workflowStatus}
                    </Badge>
                    {order.paymentStatus !== "unpaid" && (
                      <Badge
                        variant="outline"
                        className={`text-xs ${PAYMENT_STATUS_COLORS[order.paymentStatus] || "border-gray-700 bg-gray-800 text-gray-400"}`}
                      >
                        {PAYMENT_STATUS_LABELS[order.paymentStatus]}
                      </Badge>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      title="מחק הזמנה"
                      disabled={deleteOrderMutation.isPending}
                      onClick={(e) => handleDeleteOrder(e, order)}
                      className="h-8 w-8 text-gray-500 hover:text-red-400 hover:bg-red-950/30"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}

        <Dialog open={isDialogOpen} onOpenChange={(open) => (open ? setIsDialogOpen(true) : handleCloseDialog())}>
          <DialogContent className="bg-gray-900 border-gray-800 text-white">
            <DialogHeader>
              <DialogTitle>הזמנת אלבום חדשה</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex gap-2">
                <Button
                  variant={linkMode === "event" ? "default" : "outline"}
                  onClick={() => setLinkMode("event")}
                  className={linkMode === "event" ? "bg-yellow-400 text-gray-900 hover:bg-yellow-500 flex-1" : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 flex-1"}
                >
                  <Link2 className="w-4 h-4 mr-2" />
                  קישור לאירוע קיים
                </Button>
                <Button
                  variant={linkMode === "manual" ? "default" : "outline"}
                  onClick={() => setLinkMode("manual")}
                  className={linkMode === "manual" ? "bg-yellow-400 text-gray-900 hover:bg-yellow-500 flex-1" : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 flex-1"}
                >
                  <PenLine className="w-4 h-4 mr-2" />
                  הזנה ידנית
                </Button>
              </div>

              {linkMode === "event" ? (
                <div className="space-y-2">
                  <label className="text-sm text-gray-400 block">חיפוש אירוע לפי שם זוג</label>
                  <Input
                    value={eventSearch}
                    onChange={(e) => setEventSearch(e.target.value)}
                    placeholder="לדוגמה: דניאל ותמר"
                    className="bg-gray-800 border-gray-700 text-white"
                  />
                  <div className="max-h-56 overflow-y-auto space-y-1 border border-gray-800 rounded-lg p-2">
                    {filteredEvents.length === 0 ? (
                      <p className="text-gray-500 text-sm p-2">לא נמצאו אירועים</p>
                    ) : (
                      filteredEvents.map((ev) => (
                        <button
                          key={ev.id}
                          onClick={() => setSelectedEventId(ev.id)}
                          className={`w-full text-right p-2 rounded-lg text-sm transition-colors ${
                            selectedEventId === ev.id ? "bg-yellow-400/20 text-yellow-300" : "text-gray-300 hover:bg-gray-800"
                          }`}
                        >
                          {ev.coupleNames} · {ev.date}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">שם הזוג</label>
                    <Input
                      value={manualForm.coupleNamesManual}
                      onChange={(e) => setManualForm({ ...manualForm, coupleNamesManual: e.target.value })}
                      className="bg-gray-800 border-gray-700 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">תאריך החתונה</label>
                    <Input
                      type="date"
                      value={manualForm.weddingDateManual}
                      onChange={(e) => setManualForm({ ...manualForm, weddingDateManual: e.target.value })}
                      className="bg-gray-800 border-gray-700 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">טלפון</label>
                    <Input
                      value={manualForm.phoneManual}
                      onChange={(e) => setManualForm({ ...manualForm, phoneManual: e.target.value })}
                      className="bg-gray-800 border-gray-700 text-white"
                    />
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleCloseDialog} className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700">
                ביטול
              </Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending} className="bg-yellow-400 text-gray-900 hover:bg-yellow-500">
                צור הזמנה
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
