import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  PRODUCTION_QUESTIONNAIRE_FIELDS,
  PRODUCTION_QUESTIONNAIRE_LONG_TEXT_FIELDS,
  PRODUCTION_QUESTIONNAIRE_BOOLEAN_FIELDS,
  hasAnyProductionQuestionnaireAnswer,
} from "@/lib/productionQuestionnaireFields";

// Read-only viewer for a lead's *filled-in* production questionnaire answers,
// opened from the Leads page's row-level "שאלון" button so the studio can review
// what the couple actually submitted without leaving the Leads page. Reuses the
// exact same field list as UnifiedSidePanel.jsx's questionnaire sections (see
// src/lib/productionQuestionnaireFields.js) so both surfaces always show the same
// complete set of fields, skip-if-empty.
export default function QuestionnaireAnswersDialog({ isOpen, onClose, lead }) {
  if (!lead) return null;

  const hasAnyAnswer = hasAnyProductionQuestionnaireAnswer(lead);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose?.(); }}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-lg max-h-[80vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-white text-lg">
            תשובות השאלון — {lead.coupleNames}
          </DialogTitle>
        </DialogHeader>

        {!hasAnyAnswer ? (
          <p className="text-gray-500 text-sm py-6 text-center">הזוג טרם מילא את השאלון</p>
        ) : (
          <div className="space-y-3 text-sm">
            {PRODUCTION_QUESTIONNAIRE_FIELDS.map(({ key, label, icon }) => (
              lead?.[key] ? (
                <div key={key} className="flex justify-between gap-3 text-gray-200">
                  <span className="text-gray-400 flex-shrink-0">{icon} {label}:</span>
                  <span className="text-left">{lead[key]}</span>
                </div>
              ) : null
            ))}
            {PRODUCTION_QUESTIONNAIRE_BOOLEAN_FIELDS.map(({ flagKey, label, icon, nameKey, phoneKey }) => (
              lead?.[flagKey] ? (
                <div key={flagKey} className="flex justify-between gap-3 text-gray-200">
                  <span className="text-gray-400 flex-shrink-0">{icon} {label}:</span>
                  <span className="text-left">{[lead[nameKey], lead[phoneKey]].filter(Boolean).join(' — ') || '—'}</span>
                </div>
              ) : null
            ))}
            {PRODUCTION_QUESTIONNAIRE_LONG_TEXT_FIELDS.map(({ key, label, icon }) => (
              lead?.[key] ? (
                <div key={key} className="text-gray-200">
                  <span className="text-gray-400">{icon} {label}:</span>
                  <p className="mt-1 text-xs text-gray-300">{lead[key]}</p>
                </div>
              ) : null
            ))}
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button
            variant="outline"
            onClick={onClose}
            className="border-gray-700 text-gray-300 w-full"
          >
            סגור
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
