import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import ProgressEventRow from "@/components/progressStatus/ProgressEventRow";
import ProgressEventMobileCard from "@/components/progressStatus/ProgressEventMobileCard";
import { useProgressActions } from "@/components/progressStatus/useProgressActions";

// "סטטוס התקדמות" on the dashboard (2026-10-09, the owner's request): the status opens this
// event's row from the work-status page — the same row component and the same actions hook,
// so a click here writes exactly what a click there writes (and the page shows it).
export default function ProgressEventDialog({ event, staffMembers, onClose, onChanged }) {
  const [events, setEvents] = useState([]);
  const actions = useProgressActions({ setEvents, staffMembers });

  useEffect(() => {
    if (!event) return;
    setEvents([event]);
    // the newest copy, in case the dashboard's is a few minutes old
    base44.entities.Event.get(event.id).then((fresh) => fresh && setEvents([fresh])).catch(() => {});
  }, [event]);

  if (!event) return null;
  const live = events[0] || event;
  const close = () => {
    onChanged?.();
    onClose();
  };

  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && close()}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-[1150px] overflow-y-auto border-gray-700 bg-gray-900 text-white">
        <DialogHeader>
          <DialogTitle className="text-right">סטטוס התקדמות — {live.coupleNames}</DialogTitle>
        </DialogHeader>
        <div className="hidden md:block">
          <ProgressEventRow event={live} actions={actions} />
        </div>
        <div className="md:hidden">
          <ProgressEventMobileCard
            event={live}
            pendingLinks={actions.pendingLinks}
            setPendingLinks={actions.setPendingLinks}
            updateField={actions.updateField}
            saveLinkOnBlur={actions.saveLinkOnBlur}
            getLinkValue={actions.getLinkValue}
            handleSendToEditor={actions.handleSendToEditor}
            handleSendToCouple={actions.handleSendToCouple}
            handleSendAlbumToGraphic={actions.handleSendAlbumToGraphic}
            handleSendAlbumToCouple={actions.handleSendAlbumToCouple}
            sendingEditor={actions.sendingEditor}
            sendingCouple={actions.sendingCouple}
            sendingGraphic={actions.sendingGraphic}
            sendingAlbumCouple={actions.sendingAlbumCouple}
          />
        </div>
        <p className="text-[11px] text-slate-500">
          כל סימון כאן נשמר מיד ומופיע גם ב
          <Link to="/ProgressStatus" className="text-sky-400 hover:underline" onClick={close}>סטטוס עבודה</Link>.
        </p>
      </DialogContent>
    </Dialog>
  );
}
