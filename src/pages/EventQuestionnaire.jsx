import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, CheckCircle2, Camera, Heart } from "lucide-react";

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
        if (data.productionFormFilledAt) setSubmitted(true);
      }
    } catch (e) {
      setError("לא ניתן לטעון את פרטי האירוע");
    }
    setIsLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await base44.functions.invoke("submitProductionQuestionnaire", {
        leadId,
        ...form,
      });
      setSubmitted(true);
      setJustSubmitted(true);
    } catch (e) {
      setError("שגיאה בשליחת הטופס, נסו שוב");
    }
    setIsSubmitting(false);
  };

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  const setChecked = (field) => (checked) => setForm((prev) => ({ ...prev, [field]: !!checked }));

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-yellow-400 animate-spin" />
      </div>
    );
  }

  if (!leadId || (!lead && !isLoading)) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white" dir="rtl">
        <div className="text-center">
          <p className="text-gray-400 text-lg">לינק לא תקין</p>
        </div>
      </div>
    );
  }

  if (justSubmitted) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center" dir="rtl">
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
    <div className="min-h-screen bg-gray-950 py-10 px-4" dir="rtl">
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

          {/* פרטי קשר */}
          <div className="space-y-4">
            <h3 className="text-white font-semibold text-sm">פרטי קשר ביום האירוע</h3>

            <div>
              <Label className="text-gray-300 mb-1.5 block">📱 נייד כלה *</Label>
              <Input
                type="tel"
                value={form.productionBridePhone}
                onChange={set("productionBridePhone")}
                placeholder="050-0000000"
                required
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500"
                dir="ltr"
              />
            </div>

            <div>
              <Label className="text-gray-300 mb-1.5 block">📱 נייד חתן *</Label>
              <Input
                type="tel"
                value={form.productionGroomPhone}
                onChange={set("productionGroomPhone")}
                placeholder="050-0000000"
                required
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500"
                dir="ltr"
              />
            </div>

            <div>
              <Label className="text-gray-300 mb-1.5 block">🧑‍🤝‍🧑 שם מלווה (אופציונלי)</Label>
              <Input
                type="text"
                value={form.productionCompanionName}
                onChange={set("productionCompanionName")}
                placeholder="מי מלווה אתכם ביום האירוע"
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500"
              />
            </div>

            <div>
              <Label className="text-gray-300 mb-1.5 block">📱 נייד מלווה (אופציונלי)</Label>
              <Input
                type="tel"
                value={form.productionCompanionPhone}
                onChange={set("productionCompanionPhone")}
                placeholder="050-0000000"
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500"
                dir="ltr"
              />
            </div>
          </div>

          {/* לוגיסטיקה */}
          <div className="space-y-4 pt-2 border-t border-gray-800">
            <h3 className="text-white font-semibold text-sm pt-2">לוגיסטיקה</h3>

            <div>
              <Label className="text-gray-300 mb-1.5 block">📍 מקום התארגנות הכלה *</Label>
              <Input
                type="text"
                value={form.productionBridePrepLocation}
                onChange={set("productionBridePrepLocation")}
                placeholder="לדוגמה: בית הורים — רחוב הרצל 12, תל אביב"
                required
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500"
              />
            </div>

            <div>
              <Label className="text-gray-300 mb-1.5 block">🕐 שעת הגעה / קבלת פנים (אופציונלי)</Label>
              <Input
                type="text"
                value={form.productionCheckinTime}
                onChange={set("productionCheckinTime")}
                placeholder="לדוגמה: 18:00"
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500"
              />
            </div>

            <div>
              <Label className="text-gray-300 mb-1.5 block">💍 שעת חופה משוערת (אופציונלי)</Label>
              <Input
                type="text"
                value={form.productionChuppahTime}
                onChange={set("productionChuppahTime")}
                placeholder="לדוגמה: 19:30"
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500"
              />
            </div>

            <div>
              <Label className="text-gray-300 mb-1.5 block">📸 אינסטגרם כלה (אופציונלי)</Label>
              <Input
                type="text"
                value={form.productionBrideInstagram}
                onChange={set("productionBrideInstagram")}
                placeholder="@username או קישור לפרופיל"
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500"
                dir="ltr"
              />
            </div>

            <div>
              <Label className="text-gray-300 mb-1.5 block">📸 אינסטגרם חתן (אופציונלי)</Label>
              <Input
                type="text"
                value={form.productionGroomInstagram}
                onChange={set("productionGroomInstagram")}
                placeholder="@username או קישור לפרופיל"
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500"
                dir="ltr"
              />
            </div>

            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="hasSocialCreator"
                  checked={form.productionHasSocialCreator}
                  onCheckedChange={setChecked("productionHasSocialCreator")}
                  className="border-gray-500 data-[state=checked]:bg-yellow-400 data-[state=checked]:border-yellow-400 data-[state=checked]:text-gray-900"
                />
                <Label htmlFor="hasSocialCreator" className="text-gray-300 cursor-pointer">
                  יש סושיאל קריאייטור/צלם/ת סושיאל באירוע
                </Label>
              </div>

              {form.productionHasSocialCreator && (
                <div className="grid grid-cols-1 gap-3 pr-6">
                  <div>
                    <Label className="text-gray-300 mb-1.5 block">שם הסושיאל קריאייטור</Label>
                    <Input
                      type="text"
                      value={form.productionSocialCreatorName}
                      onChange={set("productionSocialCreatorName")}
                      className="bg-gray-800 border-gray-700 text-white placeholder-gray-500"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300 mb-1.5 block">נייד הסושיאל קריאייטור</Label>
                    <Input
                      type="tel"
                      value={form.productionSocialCreatorPhone}
                      onChange={set("productionSocialCreatorPhone")}
                      placeholder="050-0000000"
                      className="bg-gray-800 border-gray-700 text-white placeholder-gray-500"
                      dir="ltr"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="hasExternalPlanner"
                  checked={form.productionHasExternalPlanner}
                  onCheckedChange={setChecked("productionHasExternalPlanner")}
                  className="border-gray-500 data-[state=checked]:bg-yellow-400 data-[state=checked]:border-yellow-400 data-[state=checked]:text-gray-900"
                />
                <Label htmlFor="hasExternalPlanner" className="text-gray-300 cursor-pointer">
                  יש מנהל/ת אירוע חיצוני/ת
                </Label>
              </div>

              {form.productionHasExternalPlanner && (
                <div className="grid grid-cols-1 gap-3 pr-6">
                  <div>
                    <Label className="text-gray-300 mb-1.5 block">שם מנהל/ת האירוע</Label>
                    <Input
                      type="text"
                      value={form.productionExternalPlannerName}
                      onChange={set("productionExternalPlannerName")}
                      className="bg-gray-800 border-gray-700 text-white placeholder-gray-500"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300 mb-1.5 block">נייד מנהל/ת האירוע</Label>
                    <Input
                      type="tel"
                      value={form.productionExternalPlannerPhone}
                      onChange={set("productionExternalPlannerPhone")}
                      placeholder="050-0000000"
                      className="bg-gray-800 border-gray-700 text-white placeholder-gray-500"
                      dir="ltr"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* משפחה ואנשים חשובים */}
          <div className="space-y-4 pt-2 border-t border-gray-800">
            <h3 className="text-white font-semibold text-sm pt-2">משפחה ואנשים חשובים</h3>

            <div>
              <Label className="text-gray-300 mb-1.5 block">👪 משפחת הכלה (אופציונלי)</Label>
              <Textarea
                value={form.productionFamilyBride}
                onChange={set("productionFamilyBride")}
                placeholder="שמות ותפקידים חשובים במשפחת הכלה"
                rows={3}
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500 resize-none"
              />
            </div>

            <div>
              <Label className="text-gray-300 mb-1.5 block">👪 משפחת החתן (אופציונלי)</Label>
              <Textarea
                value={form.productionFamilyGroom}
                onChange={set("productionFamilyGroom")}
                placeholder="שמות ותפקידים חשובים במשפחת החתן"
                rows={3}
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500 resize-none"
              />
            </div>

            <div>
              <Label className="text-gray-300 mb-1.5 block">⭐ אנשים חשובים במיוחד לצלם (אופציונלי)</Label>
              <Textarea
                value={form.productionImportantPeople}
                onChange={set("productionImportantPeople")}
                placeholder="מי חשוב לכם שנקפיד לתעד"
                rows={3}
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500 resize-none"
              />
            </div>

            <div>
              <Label className="text-gray-300 mb-1.5 block">⚠️ רגישויות משפחתיות (אופציונלי)</Label>
              <Textarea
                value={form.productionFamilySensitivities}
                onChange={set("productionFamilySensitivities")}
                placeholder="אנשים שחשוב לדעת לא לצלם ביחד"
                rows={3}
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500 resize-none"
              />
            </div>
          </div>

          {/* לצוות שלנו */}
          <div className="space-y-4 pt-2 border-t border-gray-800">
            <h3 className="text-white font-semibold text-sm pt-2">לצוות שלנו</h3>

            <div>
              <Label className="text-gray-300 mb-1.5 block">🎁 הפתעות מתוכננות באירוע (אופציונלי)</Label>
              <Textarea
                value={form.productionPlannedSurprises}
                onChange={set("productionPlannedSurprises")}
                placeholder="לדוגמה: הפתעה לכלה/לחתן, ריקוד מיוחד..."
                rows={3}
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500 resize-none"
              />
            </div>

            <div>
              <Label className="text-gray-300 mb-1.5 block">💬 בקשות מיוחדות מהצוות (אופציונלי)</Label>
              <Textarea
                value={form.productionSpecialRequests}
                onChange={set("productionSpecialRequests")}
                placeholder="לדוגמה: רגעים חשובים שחשוב לכם לתעד, אנשים ספציפיים לצלם, משהו שחשוב לדעת..."
                rows={4}
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500 resize-none"
              />
            </div>
          </div>

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
