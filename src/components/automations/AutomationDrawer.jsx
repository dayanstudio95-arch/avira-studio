import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, Check } from "lucide-react";

const VARIABLES = [
  { key: "[שם_לקוח]", label: "שם הלקוח" },
  { key: "[תאריך_אירוע]", label: "תאריך האירוע" },
  { key: "[אולם]", label: "שם האולם" },
  { key: "[לינק_שאלון]", label: "לינק לשאלון הייצור" },
  { key: "[לינק_אלבום]", label: "לינק לאלבום" },
];

export default function AutomationDrawer({ isOpen, onClose, automation, onSave }) {
  const [formData, setFormData] = useState({
    name: "",
    triggerType: "days_after_proposal",
    triggerDays: 2,
    triggerDescription: "",
    messageTemplate: "",
  });

  const [copiedVariable, setCopiedVariable] = useState(null);

  useEffect(() => {
    if (automation) {
      setFormData({
        name: automation.name || "",
        triggerType: automation.triggerType || "days_after_proposal",
        triggerDays: automation.triggerDays || 2,
        triggerDescription: automation.triggerDescription || "",
        messageTemplate: automation.messageTemplate || "",
      });
    } else {
      setFormData({
        name: "",
        triggerType: "days_after_proposal",
        triggerDays: 2,
        triggerDescription: "",
        messageTemplate: "",
      });
    }
  }, [automation, isOpen]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.EventAutomation.create(data),
    onSuccess: () => {
      toast.success("אוטומציה נוצרה בהצלחה");
      onSave();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) =>
      base44.entities.EventAutomation.update(id, data),
    onSuccess: () => {
      toast.success("אוטומציה עודכנה בהצלחה");
      onSave();
    },
  });

  const handleSubmit = () => {
    if (!formData.name || !formData.messageTemplate) {
      toast.error("אנא מלא שם ותוכן הודעה");
      return;
    }

    const dataToSave = {
      ...formData,
      variables: VARIABLES,
    };

    if (automation) {
      updateMutation.mutate({ id: automation.id, data: dataToSave });
    } else {
      createMutation.mutate(dataToSave);
    }
  };

  const handleCopyVariable = (variable) => {
    navigator.clipboard.writeText(variable);
    setCopiedVariable(variable);
    setTimeout(() => setCopiedVariable(null), 2000);
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent
        className="bg-gray-900 border-gray-800 text-white overflow-y-auto max-w-lg"
        dir="rtl"
      >
        <SheetHeader>
          <SheetTitle className="text-white text-2xl">
            {automation ? "ערוך אוטומציה" : "אוטומציה חדשה"}
          </SheetTitle>
          <SheetClose />
        </SheetHeader>

        <div className="space-y-6 mt-6">
          {/* שם האוטומציה */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">
              שם האוטומציה
            </label>
            <Input
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder="למשל: פולו-אפ הצעה"
              className="bg-gray-800 border-gray-700 text-white"
            />
          </div>

          {/* סוג הטריגר */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">
              מתי לשלוח?
            </label>
            <Select
              value={formData.triggerType}
              onValueChange={(value) =>
                setFormData({ ...formData, triggerType: value })
              }
            >
              <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 border-gray-700 text-white">
                <SelectItem value="days_after_proposal">
                  ימים אחרי הצעה
                </SelectItem>
                <SelectItem value="days_after_event">ימים אחרי אירוע</SelectItem>
                <SelectItem value="status_based">לפי סטטוס</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* מספר ימים */}
          {(formData.triggerType === "days_after_proposal" ||
            formData.triggerType === "days_after_event") && (
            <div>
              <label className="text-sm text-gray-400 mb-2 block">
                מספר ימים
              </label>
              <Input
                type="number"
                min="0"
                value={formData.triggerDays}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    triggerDays: Number(e.target.value),
                  })
                }
                className="bg-gray-800 border-gray-700 text-white"
              />
            </div>
          )}

          {/* תיאור הטריגר */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">
              תיאור הטריגר (עבור הצפוי שלך)
            </label>
            <Input
              value={formData.triggerDescription}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  triggerDescription: e.target.value,
                })
              }
              placeholder="למשל: 48 שעות אחרי שליחת הצעה"
              className="bg-gray-800 border-gray-700 text-white text-sm"
            />
          </div>

          {/* תגיות זמינות */}
          <div>
            <label className="text-sm text-gray-400 mb-3 block">
              תגיות זמינות (לחץ להעתקה)
            </label>
            <div className="grid grid-cols-2 gap-2">
              {VARIABLES.map((variable) => (
                <Button
                  key={variable.key}
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopyVariable(variable.key)}
                  className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 h-auto py-2 justify-start text-left"
                >
                  <div className="flex flex-col gap-1 w-full">
                    <code className="text-xs text-yellow-400 font-mono">
                      {variable.key}
                    </code>
                    <span className="text-xs text-gray-500">
                      {variable.label}
                    </span>
                  </div>
                  {copiedVariable === variable.key ? (
                    <Check className="w-3 h-3 text-green-400 mr-1" />
                  ) : (
                    <Copy className="w-3 h-3 text-gray-500 mr-1" />
                  )}
                </Button>
              ))}
            </div>
          </div>

          {/* תוכן ההודעה */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">
              תוכן ההודעה בוואטסאפ
            </label>
            <Textarea
              value={formData.messageTemplate}
              onChange={(e) =>
                setFormData({ ...formData, messageTemplate: e.target.value })
              }
              placeholder="כתוב את ההודעה... אתה יכול להשתמש בתגיות מעלה"
              className="bg-gray-800 border-gray-700 text-white min-h-48"
            />
            <p className="text-xs text-gray-500 mt-2">
              עמודים מותר: 1024 תווים
            </p>
          </div>

          {/* Preview */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">תצוגה מקדימה</label>
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-sm text-gray-300 whitespace-pre-wrap break-words">
              {formData.messageTemplate || "ההודעה תופיע כאן..."}
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-6 border-t border-gray-800">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
            >
              ביטול
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!formData.name || !formData.messageTemplate}
              className="flex-1 bg-yellow-400 text-gray-900 hover:bg-yellow-500"
            >
              {automation ? "עדכן" : "צור"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}