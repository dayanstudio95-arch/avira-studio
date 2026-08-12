import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { format, parseISO } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), "dd/MM/yyyy");
  } catch {
    return dateStr;
  }
}

export default function RescheduleConfirmModal({ data, onConfirm, onCancel }) {
  const { oldDate, newDate, event } = data;
  const [lead, setLead] = useState(null);
  const [loadingLead, setLoadingLead] = useState(false);

  useEffect(() => {
    if (!event?.leadId) return;
    setLoadingLead(true);
    base44.entities.Lead.filter({ id: event.leadId })
      .then((results) => setLead(results?.[0] || null))
      .catch(() => setLead(null))
      .finally(() => setLoadingLead(false));
  }, [event?.leadId]);

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-white">אישור שינוי תאריך</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <p className="text-gray-300">
            שינוי תאריך אירוע עבור <span className="text-yellow-400 font-semibold">{event?.coupleNames}</span>
          </p>

          <div className="bg-gray-800 rounded-lg p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-400">תאריך ישן:</span>
              <span className="text-white font-medium">{formatDate(oldDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">תאריך חדש:</span>
              <span className="text-green-400 font-medium">{formatDate(newDate)}</span>
            </div>
          </div>

          {event?.leadId && (
            <div className="bg-gray-800/60 rounded-lg p-4 space-y-2 border border-gray-700">
              <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">ליד מקושר</p>
              {loadingLead ? (
                <p className="text-gray-500 text-xs">טוען...</p>
              ) : lead ? (
                <div className="flex justify-between">
                  <span className="text-gray-400">תאריך ליד נוכחי:</span>
                  <span className="text-white font-medium">{formatDate(lead.eventDate)}</span>
                </div>
              ) : (
                <p className="text-gray-500 text-xs">לא נמצא ליד</p>
              )}
              <p className="text-yellow-300/80 text-xs pt-1">
                האם לעדכן גם את תאריך האירוע בליד?
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-col">
          {event?.leadId && (
            <Button
              onClick={() => onConfirm({ updateLead: true })}
              className="w-full bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold"
            >
              עדכן אירוע + ליד
            </Button>
          )}
          <Button
            onClick={() => onConfirm({ updateLead: false })}
            variant="outline"
            className="w-full border-gray-600 text-gray-200 hover:bg-gray-800"
          >
            עדכן אירוע בלבד
          </Button>
          <Button
            onClick={onCancel}
            variant="ghost"
            className="w-full text-gray-400 hover:text-white hover:bg-gray-800"
          >
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}