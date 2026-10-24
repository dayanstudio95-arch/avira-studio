import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, Camera, Heart } from "lucide-react";
import QuestionnaireFields from "@/components/questionnaire/QuestionnaireFields";
import { questionnaireSections, extraAnswersById, missingRequiredAnswers } from "@/lib/questionnaireConfig";

export default function EventQuestionnaire() {
  const { id: paramId } = useParams();
  // Support both /questionnaire/:id and /questionnaire?leadId=...
  const urlParams = new URLSearchParams(window.location.search);
  const leadId = paramId || urlParams.get("leadId");

  const [lead, setLead] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [error, setError] = useState(null);
  // The studio's wording and its own questions (Settings → שאלון הפקה, 2026-10-24) — from
  // get-lead-public; without it the form is the built-in one, as before.
  const [config, setConfig] = useState(null);
  const [extra, setExtra] = useState({});

  const [form, setForm] = useState({
    productionBridePhone: "",
    productionGroomPhone: "",
    productionCompanionName: "",
    productionCompanionPhone: "",
    productionBridePrepLocation: "",
    productionCheckinTime: "",
    productionChuppahTime: "",
    productionBrideInstagram: "",
    productionGroomInstagram: "",
    productionHasSocialCreator: false,
    productionSocialCreatorName: "",
    productionSocialCreatorPhone: "",
    productionHasExternalPlanner: false,
    productionExternalPlannerName: "",
    productionExternalPlannerPhone: "",
    productionFamilyBride: "",
    productionFamilyGroom: "",
    productionImportantPeople: "",
    productionFamilySensitivities: "",
    productionPlannedSurprises: "",
    productionSpecialRequests: "",
  });

  useEffect(() => {
    if (!leadId) { setIsLoading(false); return; }
    loadLead();
  }, [leadId]);

  const loadLead = async () => {
    try {
      const res = await base44.functions.invoke("getLeadPublic", { leadId });
      const data = res.data;
      if (data?.coupleNames) {
        setLead(data);
        setForm((prev) => ({
          ...prev,
          productionBridePhone: data.productionBridePhone || data.phoneNumber || "",
          productionGroomPhone: data.productionGroomPhone || "",
          productionCompanionName: data.productionCompanionName || "",
          productionCompanionPhone: data.productionCompanionPhone || "",
          productionBridePrepLocation: data.productionBridePrepLocation || "",
          productionCheckinTime: data.productionCheckinTime || "",
          productionChuppahTime: data.productionChuppahTime || "",
          productionBrideInstagram: data.productionBrideInstagram || data.productionInstagram || "",
          productionGroomInstagram: data.productionGroomInstagram || "",
          productionHasSocialCreator: !!data.productionHasSocialCreator,
          productionSocialCreatorName: data.productionSocialCreatorName || "",
          productionSocialCreatorPhone: data.productionSocialCreatorPhone || "",
          productionHasExternalPlanner: !!data.productionHasExternalPlanner,
          productionExternalPlannerName: data.productionExternalPlannerName || "",
          productionExternalPlannerPhone: data.productionExternalPlannerPhone || "",
          productionFamilyBride: data.productionFamilyBride || "",
          productionFamilyGroom: data.productionFamilyGroom || "",
          productionImportantPeople: data.productionImportantPeople || "",
          productionFamilySensitivities: data.productionFamilySensitivities || "",
          productionPlannedSurprises: data.productionPlannedSurprises || "",
          productionSpecialRequests: data.productionSpecialRequests || "",
        }));
        setConfig(data.questionnaireConfig || null);
        setExtra(extraAnswersById(data.productionExtraAnswers));
        if (data.productionFormFilledAt) setSubmitted(true);
      }
    } catch (e) {
      setError("לא ניתן לטעון את פרטי האירוע");
    }
    setIsLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // the browser checks the text boxes itself; a required yes/no is checked here
    const missing = missingRequiredAnswers(config, extra);
    if (missing.length) {
      setError(`חסרה תשובה: ${missing.join(", ")}`);
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await base44.functions.invoke("submitProductionQuestionnaire", {
        leadId,
        ...form,
        extraAnswers: extra,
      });
      setSubmitted(true);
      setJustSubmitted(true);
    } catch (e) {
      setError("שגיאה בשליחת הטופס, נסו שוב");
    }
    setIsSubmitting(false);
  };


  if (isLoading) {
    return (
      <div className="e-page min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-yellow-400 animate-spin" />
      </div>
    );
  }

  if (!leadId || (!lead && !isLoading)) {
    return (
      <div className="e-page min-h-screen bg-gray-950 flex items-center justify-center text-white" dir="rtl">
        <div className="text-center">
          <p className="text-gray-400 text-lg">לינק לא תקין</p>
        </div>
      </div>
    );
  }

  if (justSubmitted) {
    return (
      <div className="e-page min-h-screen bg-gray-950 flex items-center justify-center" dir="rtl">
        <div className="text-center space-y-4 px-6">
          <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto" />
          <h2 className="text-2xl font-bold text-white">תודה! הפרטים התקבלו 💛</h2>
          <p className="text-gray-400">הצוות שלנו יהיה מוכן עם כל הפרטים ביום האירוע.</p>
          <button
            onClick={() => setJustSubmitted(false)}
            className="text-sm text-gray-500 underline"
          >
            עריכת הפרטים
          </button>
        </div>
      </div>
    );
  }

  const eventDateFormatted = lead?.eventDate
    ? new Date(lead.eventDate).toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <div className="e-page min-h-screen bg-gray-950 py-10 px-4" dir="rtl">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Heart className="w-6 h-6 text-yellow-400" />
            <Camera className="w-6 h-6 text-yellow-400" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-1">שאלון פרטי האירוע</h1>
          {lead?.coupleNames && (
            <p className="text-yellow-400 text-lg font-semibold">{lead.coupleNames}</p>
          )}
          {eventDateFormatted && (
            <p className="text-gray-400 text-sm mt-1">{eventDateFormatted} • {lead?.venueName || ""}</p>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5">
          {submitted ? (
            <div className="flex items-center gap-2 bg-green-900/30 border border-green-700/40 rounded-xl px-3 py-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
              <p className="text-green-400 text-xs">השאלון כבר מולא — ניתן לעדכן ולשלוח שוב</p>
            </div>
          ) : (
            <p className="text-gray-400 text-sm border-b border-gray-800 pb-4">
              מלאו את הפרטים הבאים כדי שהצוות שלנו יוכל להתכונן בצורה הטובה ביותר ✨
            </p>
          )}

          <QuestionnaireFields sections={questionnaireSections(config)} form={form} setForm={setForm} extra={extra} setExtra={setExtra} />

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-bold py-3 rounded-xl text-base"
          >
            {isSubmitting ? (
              <><Loader2 className="w-5 h-5 animate-spin ml-2" /> שולח...</>
            ) : submitted ? (
              "עדכן פרטים 💛"
            ) : (
              "שלח פרטים לצוות 💛"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
