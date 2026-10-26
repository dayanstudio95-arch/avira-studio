import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Plus, Bot, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import AIAssistant from "@/components/AIAssistant";
import LeadFormDialog from "@/components/leads/LeadFormDialog";
import UnifiedSidePanel from "@/components/unified/UnifiedSidePanel";
import CrewAvailabilityDialog from "@/components/staffScheduling/CrewAvailabilityDialog";
import { packagePrices } from "@/lib/packagePrices";

const ITEMS = [
  { key: "lead", icon: UserPlus, title: "ליד חדש", sub: "פותח את טופס הליד" },
  { key: "crew", icon: Users, title: "זמינות צוות", sub: "אירועים שחסר בהם איש צוות" },
  { key: "ai", icon: Bot, title: "עוזר אישי", sub: "העוזר שהיה בכפתור עד היום" },
];

// The yellow corner button became "+" (2026-10-27, the owner's request): new lead, crew
// availability (several events → one message per person), and the AI assistant that used to
// open straight from it. Admin roles only, like the assistant before it (Layout).
export default function QuickActionsFab() {
  const { pathname } = useLocation();
  // On a phone the WhatsApp inbox has a composer along the bottom edge — the button sat on it.
  const hideOnMobile = pathname.toLowerCase().includes("whatsappinbox");
  const [menuOpen, setMenuOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [crewOpen, setCrewOpen] = useState(false);
  const [createdLead, setCreatedLead] = useState(null);

  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const pick = (key) => {
    setMenuOpen(false);
    if (key === "lead") setLeadOpen(true);
    if (key === "crew") setCrewOpen(true);
    if (key === "ai") setAiOpen(true);
  };

  return (
    <>
      {!aiOpen && (
        <>
          {menuOpen && <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
          {/* left-to-right box so the button stays in the corner; the items are RTL inside */}
          <div className={`fixed bottom-6 left-6 z-50 flex flex-col items-start gap-2 ${hideOnMobile ? "hidden md:flex" : ""}`} dir="ltr">
            {menuOpen && ITEMS.map(({ key, icon: Icon, title, sub }) => (
              <button
                key={key}
                type="button"
                onClick={() => pick(key)}
                dir="rtl"
                className="flex w-64 items-center gap-3 rounded-xl border border-white/15 bg-gray-900 px-3 py-2.5 text-right shadow-lg hover:bg-gray-800"
              >
                <Icon className="h-5 w-5 flex-shrink-0 text-yellow-400" />
                <span>
                  <span className="block text-sm font-semibold text-white">{title}</span>
                  <span className="block text-xs text-gray-400">{sub}</span>
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={menuOpen ? "סגור" : "פעולות מהירות"}
              aria-expanded={menuOpen}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-r from-yellow-400 to-yellow-500 shadow-lg hover:from-yellow-500 hover:to-yellow-600"
            >
              <Plus className={`h-7 w-7 text-gray-900 transition-transform ${menuOpen ? "rotate-45" : ""}`} />
            </button>
          </div>
        </>
      )}

      <AIAssistant open={aiOpen} onOpenChange={setAiOpen} showLauncher={false} />

      {leadOpen && (
        <LeadFormDialog
          isOpen
          onClose={() => setLeadOpen(false)}
          lead={null}
          packagePrices={packagePrices}
          // The new lead opens in the side panel right away, as on the leads page.
          onSaved={(created) => {
            setLeadOpen(false);
            window.dispatchEvent(new CustomEvent("avira:lead-saved"));
            if (created?.id) setCreatedLead(created);
            else toast.success("הליד נשמר");
          }}
        />
      )}
      {createdLead && (
        <UnifiedSidePanel
          isOpen
          onClose={() => setCreatedLead(null)}
          lead={createdLead}
          event={null}
          staffMembers={[]}
          onLeadUpdated={() => {}}
          onEventUpdated={() => {}}
        />
      )}
      {crewOpen && <CrewAvailabilityDialog open onClose={() => setCrewOpen(false)} />}
    </>
  );
}
