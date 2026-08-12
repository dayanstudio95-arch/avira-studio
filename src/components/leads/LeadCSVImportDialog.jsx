import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileText, AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

const leadFields = [
  { key: "coupleNames", label: "שם הזוג", required: true },
  { key: "eventDate", label: "תאריך אירוע", required: false },
  { key: "venueName", label: "אולם", required: false },
  { key: "phoneNumber", label: "טלפון", required: false },
  { key: "finalPrice", label: "מחיר סופי", required: false },
  { key: "packageChoice", label: "חבילה", required: false },
];

function detectDelimiter(text) {
  const firstLine = text.split('\n')[0];
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs >= commas ? '\t' : ',';
}

function autoMap(headers) {
  const mapping = {};
  headers.forEach(header => {
    const h = header.toLowerCase();
    if (h.includes('שם') || h.includes('זוג') || h.includes('couple') || h.includes('name')) {
      mapping['coupleNames'] = header;
    } else if (h.includes('תאריך') || h.includes('date')) {
      mapping['eventDate'] = header;
    } else if (h.includes('אולם') || h.includes('venue') || h.includes('hall')) {
      mapping['venueName'] = header;
    } else if (h.includes('טלפון') || h.includes('phone') || h.includes('tel')) {
      mapping['phoneNumber'] = header;
    } else if (h.includes('מחיר') || h.includes('סכום') || h.includes('price') || h.includes('amount')) {
      mapping['finalPrice'] = header;
    } else if (h.includes('חבילה') || h.includes('package')) {
      mapping['packageChoice'] = header;
    }
  });
  return mapping;
}

export default function LeadCSVImportDialog({ isOpen, onClose, onSuccess }) {
  const [csvData, setCsvData] = useState(null);
  const [columnMapping, setColumnMapping] = useState({});
  const [step, setStep] = useState(1);
  const [importProgress, setImportProgress] = useState(0);
  const [importedCount, setImportedCount] = useState(0);
  const [errors, setErrors] = useState([]);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const text = await file.text();
    const delimiter = detectDelimiter(text);
    const lines = text.split('\n').filter(l => l.trim());
    const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map(line => {
      const values = line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx] || '';
      });
      return row;
    }).filter(row => Object.values(row).some(v => v));

    setCsvData({ headers, rows });
    setColumnMapping(autoMap(headers));
    setStep(2);
  };

  const handleImport = async () => {
    setStep(3);
    setImportProgress(0);
    setImportedCount(0);
    setErrors([]);

    // Load existing leads to skip duplicates
    const existingLeads = await base44.entities.Lead.list();
    const existingKeys = new Set(
      existingLeads.map(l => `${l.coupleNames?.trim()}_${l.eventDate || ''}`)
    );

    const leadsToCreate = [];
    csvData.rows.forEach((row) => {
      const coupleNames = (columnMapping.coupleNames ? row[columnMapping.coupleNames]?.trim() : '') || '(ללא שם)';

      const lead = {
        coupleNames,
        status: "חדש",
      };

      if (columnMapping.eventDate && row[columnMapping.eventDate]) {
        lead.eventDate = row[columnMapping.eventDate];
      }
      if (columnMapping.venueName && row[columnMapping.venueName]) {
        lead.venueName = row[columnMapping.venueName];
      }
      if (columnMapping.phoneNumber && row[columnMapping.phoneNumber]) {
        let phone = row[columnMapping.phoneNumber].trim();
        if (phone.startsWith('972')) phone = '0' + phone.slice(3);
        lead.phoneNumber = phone;
      }
      if (columnMapping.finalPrice && row[columnMapping.finalPrice]) {
        const price = parseFloat(row[columnMapping.finalPrice].replace(/[^\d.]/g, ''));
        if (!isNaN(price)) {
          lead.finalPrice = price;
          lead.basePrice = price;
        }
      }
      if (columnMapping.packageChoice && row[columnMapping.packageChoice]) {
        lead.packageChoice = row[columnMapping.packageChoice];
      }

      const key = `${coupleNames}_${lead.eventDate || ''}`;
      if (!existingKeys.has(key)) {
        leadsToCreate.push(lead);
      }
    });

    if (leadsToCreate.length === 0) {
      setImportedCount(0);
      setStep(4);
      return;
    }

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    let failed = 0;
    for (let i = 0; i < leadsToCreate.length; i++) {
      let success = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await base44.entities.Lead.create(leadsToCreate[i]);
          success = true;
          break;
        } catch (err) {
          if (err.message?.includes('Rate limit') || err.message?.includes('rate limit')) {
            await sleep(1000 * (attempt + 1));
          } else {
            setErrors(prev => [...prev, `שורה ${i + 2}: ${err.message}`]);
            break;
          }
        }
      }
      if (!success) failed++;
      else setImportedCount(prev => prev + 1);
      setImportProgress(((i + 1) / leadsToCreate.length) * 100);
      if (i % 10 === 9) await sleep(300);
    }
    setStep(4);
  };

  const handleClose = () => {
    const wasSuccess = step === 4 && importedCount > 0;
    setCsvData(null);
    setColumnMapping({});
    setStep(1);
    setImportProgress(0);
    setImportedCount(0);
    setErrors([]);
    onClose();
    if (wasSuccess) onSuccess();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-xl text-right">ייבוא לידים מקובץ CSV</DialogTitle>
        </DialogHeader>

        {/* Step 1: Upload */}
        {step === 1 && (
          <div className="space-y-4 py-4">
            <div className="border-2 border-dashed border-gray-700 rounded-lg p-8 text-center hover:border-yellow-400 transition-colors">
              <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-300 mb-4">בחר קובץ CSV או TSV (ייצוא מאקסל)</p>
              <input type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload} className="hidden" id="lead-csv-upload" />
              <label htmlFor="lead-csv-upload">
                <Button variant="outline" className="border-gray-700 cursor-pointer" asChild>
                  <span><FileText className="w-4 h-4 ml-2" />העלה קובץ</span>
                </Button>
              </label>
            </div>
            <div className="text-xs text-gray-500 space-y-1 text-right">
              <p>• קובץ CSV / TSV עם כותרות בשורה הראשונה</p>
              <p>• עמודות: שם, תאריך, אולם, טלפון, מחיר, חבילה</p>
              <p>• כל הלידים יווצרו עם סטטוס "חדש"</p>
            </div>
          </div>
        )}

        {/* Step 2: Mapping */}
        {step === 2 && csvData && (
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <p className="text-sm text-gray-400">נמצאו {csvData.rows.length} שורות. התאם עמודות:</p>
            {leadFields.map(field => (
              <div key={field.key} className="flex items-center gap-3">
                <Label className="text-gray-300 w-28 flex-shrink-0 text-right">
                  {field.label}{field.required && <span className="text-red-400"> *</span>}
                </Label>
                <Select
                  value={columnMapping[field.key] || "__none__"}
                  onValueChange={(val) => setColumnMapping(prev => ({ ...prev, [field.key]: val === "__none__" ? "" : val }))}
                >
                  <SelectTrigger className="bg-gray-800 border-gray-700 flex-1">
                    <SelectValue placeholder="בחר עמודה..." />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700 text-white">
                    <SelectItem value="__none__">— ללא —</SelectItem>
                    {csvData.headers.map(header => (
                      <SelectItem key={header} value={header}>{header}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}

            {/* Preview */}
            {csvData.rows.length > 0 && (
              <div className="mt-4 p-3 bg-gray-800/50 rounded-lg text-xs text-gray-400">
                <p className="font-semibold mb-1">תצוגה מקדימה (שורה 1):</p>
                {leadFields.map(f => columnMapping[f.key] ? (
                  <p key={f.key}><span className="text-gray-300">{f.label}:</span> {csvData.rows[0][columnMapping[f.key]] || '—'}</p>
                ) : null)}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Importing */}
        {step === 3 && (
          <div className="space-y-4 py-8 text-center">
            <Loader2 className="w-12 h-12 mx-auto text-yellow-400 animate-spin" />
            <p className="text-white">מייבא לידים...</p>
            <Progress value={importProgress} className="h-2" />
            <p className="text-sm text-gray-400">{importedCount} / {csvData.rows.length}</p>
          </div>
        )}

        {/* Step 4: Complete */}
        {step === 4 && (
          <div className="space-y-4 py-8 text-center">
            <CheckCircle className="w-16 h-16 mx-auto text-green-400 mb-4" />
            <h3 className="text-xl font-bold text-white">הייבוא הושלם!</h3>
            <p className="text-gray-300">יובאו בהצלחה {importedCount} לידים</p>
            {errors.length > 0 && (
              <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-right">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-5 h-5 text-red-400" />
                  <p className="text-red-400 font-semibold">שגיאות ({errors.length}):</p>
                </div>
                <div className="text-sm text-red-300 space-y-1 max-h-32 overflow-y-auto">
                  {errors.map((err, idx) => <p key={idx}>• {err}</p>)}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex gap-2 justify-start flex-row-reverse">
          {step === 2 && (
            <>
              <Button
                onClick={handleImport}
                disabled={!columnMapping.coupleNames}
                className="bg-yellow-400 hover:bg-yellow-500 text-gray-900"
              >
                התחל ייבוא ({csvData?.rows.length} שורות)
              </Button>
              <Button variant="outline" onClick={() => setStep(1)} className="border-gray-700">חזור</Button>
            </>
          )}
          {step === 4 && (
            <Button onClick={handleClose} className="bg-yellow-400 hover:bg-yellow-500 text-gray-900">סגור</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}