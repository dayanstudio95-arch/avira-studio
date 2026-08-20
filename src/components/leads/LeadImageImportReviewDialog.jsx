import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle, XCircle, ChevronLeft, ChevronRight, Loader2, Upload, ImageIcon } from "lucide-react";

export default function LeadImageImportReviewDialog({ isOpen, onClose, onSuccess }) {
  const [leads, setLeads] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decisions, setDecisions] = useState({});
  const [importing, setImporting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [done, setDone] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [step, setStep] = useState('upload'); // 'upload' | 'review' | 'importing' | 'done'

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setExtracting(true);

    const { file_url } = await base44.integrations.Core.UploadFile({ file });

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `תחלץ את כל הלידים/אירועים מהטבלה בתמונה.
לכל שורה תחלץ:
- coupleNames: שמות הזוג (עמודת "שם הזוג" או דומה)
- eventDate: תאריך האירוע בפורמט YYYY-MM-DD
- venueName: שם האולם
- phoneNumber: מספר טלפון (אם קיים)
- finalPrice: מחיר מספרי בלבד (בלי סימן ₪ או פסיקים)
- packageChoice: שם החבילה (למשל "חבילה 2")

החזר מערך JSON של כל הלידים שמצאת. אל תכלול שורות ריקות.`,
      file_urls: [file_url],
      response_json_schema: {
        type: "object",
        properties: {
          leads: {
            type: "array",
            items: {
              type: "object",
              properties: {
                coupleNames: { type: "string" },
                eventDate: { type: "string" },
                venueName: { type: "string" },
                phoneNumber: { type: "string" },
                finalPrice: { type: "number" },
                packageChoice: { type: "string" }
              }
            }
          }
        }
      }
    });

    setLeads((result.leads || []).map(l => ({ ...l, phoneNumber: l.phoneNumber || "" })));
    setCurrentIndex(0);
    setDecisions({});
    setStep('review');
    setExtracting(false);
  };

  const current = leads[currentIndex];
  const allDecided = leads.length > 0 && Object.keys(decisions).length === leads.length;

  const handleFieldChange = (field, value) => {
    setLeads(prev => prev.map((l, i) => i === currentIndex ? { ...l, [field]: value } : l));
  };

  const decide = (decision) => {
    setDecisions(prev => ({ ...prev, [currentIndex]: decision }));
    if (currentIndex < leads.length - 1) setCurrentIndex(currentIndex + 1);
  };

  const handleImport = async () => {
    setStep('importing');
    const approved = leads.filter((_, i) => decisions[i] === 'approve');
    let count = 0;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < approved.length; i++) {
      try {
        await base44.entities.Lead.create({ ...approved[i], status: "נסגר/חתימה" });
        count++;
      } catch (err) {
        if (err.message?.includes('rate limit') || err.message?.includes('Rate limit')) {
          await sleep(1500);
          try { await base44.entities.Lead.create({ ...approved[i], status: "נסגר/חתימה" }); count++; } catch {}
        }
      }
      if (i % 5 === 4) await sleep(300);
    }
    setImportedCount(count);
    setStep('done');
  };

  const handleClose = () => {
    const wasSuccess = step === 'done' && importedCount > 0;
    setLeads([]);
    setCurrentIndex(0);
    setDecisions({});
    setDone(false);
    setImportedCount(0);
    setStep('upload');
    onClose();
    if (wasSuccess) onSuccess();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-xl text-right">ייבוא לידים מתמונה</DialogTitle>
        </DialogHeader>

        {/* Step: Upload */}
        {step === 'upload' && (
          <div className="py-6 space-y-4">
            {extracting ? (
              <div className="text-center py-8 space-y-3">
                <Loader2 className="w-12 h-12 mx-auto text-yellow-400 animate-spin" />
                <p className="text-gray-300">מנתח את התמונה...</p>
                <p className="text-xs text-gray-500">ה-AI מחלץ את הנתונים</p>
              </div>
            ) : (
              <>
                <label htmlFor="img-upload" className="block border-2 border-dashed border-gray-700 rounded-xl p-10 text-center cursor-pointer hover:border-yellow-400 transition-colors">
                  <ImageIcon className="w-12 h-12 mx-auto text-gray-500 mb-3" />
                  <p className="text-gray-300 font-medium">העלה צילום מסך של טבלת הלידים</p>
                  <p className="text-xs text-gray-500 mt-1">ה-AI יחלץ את הנתונים אוטומטית</p>
                  <input id="img-upload" type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                </label>
                <p className="text-xs text-gray-600 text-center">תומך ב-PNG, JPG, JPEG, WEBP</p>
              </>
            )}
          </div>
        )}

        {/* Step: Review */}
        {step === 'review' && current && (
          <>
            <div className="flex justify-between items-center text-sm text-gray-400 mb-2">
              <span>{currentIndex + 1} / {leads.length}</span>
              <div className="flex gap-1">
                {leads.map((_, i) => (
                  <button key={i} onClick={() => setCurrentIndex(i)}
                    className={`w-3 h-3 rounded-full transition-colors ${
                      decisions[i] === 'approve' ? 'bg-green-500' :
                      decisions[i] === 'skip' ? 'bg-red-500' :
                      i === currentIndex ? 'bg-yellow-400' : 'bg-gray-700'
                    }`} />
                ))}
              </div>
            </div>

            <div className={`border rounded-xl p-4 space-y-3 transition-all ${
              decisions[currentIndex] === 'approve' ? 'border-green-500 bg-green-900/20' :
              decisions[currentIndex] === 'skip' ? 'border-red-500 bg-red-900/20' :
              'border-gray-700 bg-gray-800/50'
            }`}>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-gray-400 text-xs">שמות הזוג</Label>
                  <Input value={current.coupleNames || ''} onChange={e => handleFieldChange('coupleNames', e.target.value)}
                    className="bg-gray-800 border-gray-700 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">תאריך אירוע</Label>
                  <Input type="date" value={current.eventDate || ''} onChange={e => handleFieldChange('eventDate', e.target.value)}
                    className="bg-gray-800 border-gray-700 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">טלפון</Label>
                  <Input value={current.phoneNumber || ''} onChange={e => handleFieldChange('phoneNumber', e.target.value)}
                    className="bg-gray-800 border-gray-700 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">אולם</Label>
                  <Input value={current.venueName || ''} onChange={e => handleFieldChange('venueName', e.target.value)}
                    className="bg-gray-800 border-gray-700 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">מחיר סופי</Label>
                  <Input type="number" value={current.finalPrice || ''} onChange={e => handleFieldChange('finalPrice', parseFloat(e.target.value))}
                    className="bg-gray-800 border-gray-700 text-white mt-1" />
                </div>
              </div>
              <div className="text-xs text-gray-500 text-center">{current.packageChoice} • סטטוס: נסגר/חתימה</div>
            </div>

            <div className="flex gap-3 mt-2">
              <Button onClick={() => decide('skip')} variant="outline"
                className="flex-1 border-red-700 bg-red-950/40 text-red-400 hover:bg-red-900/20 gap-2">
                <XCircle className="w-4 h-4" /> דלג
              </Button>
              <Button onClick={() => decide('approve')}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white gap-2">
                <CheckCircle className="w-4 h-4" /> אשר
              </Button>
            </div>

            <div className="flex justify-between items-center pt-1">
              <Button variant="ghost" size="sm" onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                disabled={currentIndex === 0} className="text-gray-400">
                <ChevronLeft className="w-4 h-4" /> הקודם
              </Button>
              <span className="text-xs text-gray-500">
                אושרו: {Object.values(decisions).filter(d => d === 'approve').length} | דולגו: {Object.values(decisions).filter(d => d === 'skip').length}
              </span>
              {allDecided ? (
                <Button onClick={handleImport} className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-bold">
                  ייבא {Object.values(decisions).filter(d => d === 'approve').length} ✓
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setCurrentIndex(Math.min(leads.length - 1, currentIndex + 1))}
                  disabled={currentIndex === leads.length - 1} className="text-gray-400">
                  הבא <ChevronRight className="w-4 h-4" />
                </Button>
              )}
            </div>
          </>
        )}

        {/* Step: Importing */}
        {step === 'importing' && (
          <div className="text-center py-10 space-y-3">
            <Loader2 className="w-12 h-12 mx-auto text-yellow-400 animate-spin" />
            <p>מייבא לידים...</p>
          </div>
        )}

        {/* Step: Done */}
        {step === 'done' && (
          <div className="text-center py-8 space-y-3">
            <CheckCircle className="w-16 h-16 mx-auto text-green-400" />
            <h3 className="text-xl font-bold">הושלם!</h3>
            <p className="text-gray-300">יובאו {importedCount} לידים בהצלחה</p>
            <div className="flex gap-2 justify-center mt-4">
              <Button onClick={() => { setStep('upload'); setLeads([]); setDecisions({}); }} variant="outline" className="border-gray-700 bg-gray-800">
                העלה תמונה נוספת
              </Button>
              <Button onClick={handleClose} className="bg-yellow-400 hover:bg-yellow-500 text-gray-900">סגור</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}