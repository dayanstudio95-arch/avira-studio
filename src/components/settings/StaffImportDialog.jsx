import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileText, AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

export default function StaffImportDialog({ isOpen, onClose, onSuccess }) {
  const [file, setFile] = useState(null);
  const [csvData, setCsvData] = useState(null);
  const [columnMapping, setColumnMapping] = useState({});
  const [step, setStep] = useState(1);
  const [importProgress, setImportProgress] = useState(0);
  const [importedCount, setImportedCount] = useState(0);
  const [errors, setErrors] = useState([]);

  const staffFields = [
    { key: "name", label: "שם", required: true },
    { key: "role", label: "תפקיד", required: true },
    { key: "defaultRate", label: "תעריף ברירת מחדל", required: false }
  ];

  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;

    if (!uploadedFile.name.endsWith('.csv')) {
      toast.error('אנא העלה קובץ CSV בלבד');
      return;
    }

    setFile(uploadedFile);
    
    const text = await uploadedFile.text();
    const lines = text.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim());
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx];
      });
      return row;
    });

    setCsvData({ headers, rows });
    
    // Auto-map columns
    const autoMapping = {};
    headers.forEach(header => {
      const lowerHeader = header.toLowerCase();
      if (lowerHeader.includes('name') || lowerHeader.includes('שם')) {
        autoMapping['name'] = header;
      } else if (lowerHeader.includes('role') || lowerHeader.includes('תפקיד')) {
        autoMapping['role'] = header;
      } else if (lowerHeader.includes('rate') || lowerHeader.includes('תעריף') || lowerHeader.includes('מחיר')) {
        autoMapping['defaultRate'] = header;
      }
    });
    
    setColumnMapping(autoMapping);
    setStep(2);
  };

  const normalizeRole = (roleValue) => {
    if (!roleValue) return 'photographer';
    const normalized = roleValue.toLowerCase().trim();
    if (normalized.includes('video') || normalized.includes('וידאו')) return 'videographer';
    if (normalized.includes('edit') || normalized.includes('עורך')) return 'editor';
    return 'photographer';
  };

  const handleImport = async () => {
    setStep(3);
    setImportProgress(0);
    setImportedCount(0);
    setErrors([]);

    const staffToCreate = [];
    
    csvData.rows.forEach((row, idx) => {
      try {
        const staff = {};
        
        if (columnMapping.name) {
          staff.name = row[columnMapping.name];
        }
        if (columnMapping.role) {
          staff.role = normalizeRole(row[columnMapping.role]);
        } else {
          staff.role = 'photographer';
        }
        if (columnMapping.defaultRate && row[columnMapping.defaultRate]) {
          staff.defaultRate = parseFloat(row[columnMapping.defaultRate]) || 0;
        } else {
          staff.defaultRate = 0;
        }

        if (staff.name && staff.role) {
          staffToCreate.push(staff);
        } else {
          setErrors(prev => [...prev, `שורה ${idx + 2}: חסר שם`]);
        }
      } catch (error) {
        setErrors(prev => [...prev, `שורה ${idx + 2}: ${error.message}`]);
      }
    });

    try {
      for (let i = 0; i < staffToCreate.length; i++) {
        await base44.entities.StaffMember.create(staffToCreate[i]);
        setImportedCount(i + 1);
        setImportProgress(((i + 1) / staffToCreate.length) * 100);
      }
      setStep(4);
      toast.success(`${staffToCreate.length} אנשי צוות יובאו בהצלחה`);
    } catch (error) {
      console.error("Import error:", error);
      setErrors(prev => [...prev, `שגיאה כללית: ${error.message}`]);
      setStep(4);
    }
  };

  const handleClose = () => {
    setFile(null);
    setCsvData(null);
    setColumnMapping({});
    setStep(1);
    setImportProgress(0);
    setImportedCount(0);
    setErrors([]);
    onClose();
    if (step === 4 && importedCount > 0) {
      onSuccess();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">ייבוא אנשי צוות מקובץ CSV</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4 py-4">
            <div className="border-2 border-dashed border-gray-700 rounded-lg p-8 text-center hover:border-yellow-400 transition-colors">
              <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-300 mb-4">בחר קובץ CSV לייבוא</p>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
                id="staff-csv-upload"
              />
              <label htmlFor="staff-csv-upload">
                <Button variant="outline" className="border-gray-700 cursor-pointer" asChild>
                  <span>
                    <FileText className="w-4 h-4 mr-2" />
                    העלה קובץ
                  </span>
                </Button>
              </label>
            </div>
            <div className="text-xs text-gray-500 space-y-1">
              <p>• הקובץ צריך להיות בפורמט CSV</p>
              <p>• שדות חובה: שם, תפקיד (photographer/videographer/editor)</p>
              <p>• שדות אופציונליים: תעריף ברירת מחדל</p>
            </div>
          </div>
        )}

        {step === 2 && csvData && (
          <div className="space-y-4 py-4 max-h-96 overflow-y-auto">
            <p className="text-sm text-gray-400">התאם את עמודות ה-CSV לשדות במערכת:</p>
            {staffFields.map(field => (
              <div key={field.key} className="space-y-2">
                <Label className="text-gray-300">
                  {field.label}
                  {field.required && <span className="text-red-400 mr-1">*</span>}
                </Label>
                <Select
                  value={columnMapping[field.key] || ""}
                  onValueChange={(val) => setColumnMapping(prev => ({ ...prev, [field.key]: val }))}
                >
                  <SelectTrigger className="bg-gray-800 border-gray-700">
                    <SelectValue placeholder="בחר עמודה..." />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700">
                    <SelectItem value={null}>ללא</SelectItem>
                    {csvData.headers.map(header => (
                      <SelectItem key={header} value={header}>{header}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 py-8 text-center">
            <Loader2 className="w-12 h-12 mx-auto text-yellow-400 animate-spin" />
            <p className="text-white">מייבא אנשי צוות...</p>
            <Progress value={importProgress} className="h-2" />
            <p className="text-sm text-gray-400">{importedCount} / {csvData.rows.length}</p>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4 py-8 text-center">
            <CheckCircle className="w-16 h-16 mx-auto text-green-400 mb-4" />
            <h3 className="text-xl font-bold text-white">הייבוא הושלם!</h3>
            <p className="text-gray-300">יובאו בהצלחה {importedCount} אנשי צוות</p>
            {errors.length > 0 && (
              <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-right">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-5 h-5 text-red-400" />
                  <p className="text-red-400 font-semibold">שגיאות:</p>
                </div>
                <div className="text-sm text-red-300 space-y-1 max-h-32 overflow-y-auto">
                  {errors.map((error, idx) => (
                    <p key={idx}>• {error}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 2 && (
            <>
              <Button variant="outline" onClick={() => setStep(1)} className="border-gray-700">
                חזור
              </Button>
              <Button
                onClick={handleImport}
                disabled={!columnMapping.name}
                className="bg-yellow-400 hover:bg-yellow-500 text-gray-900"
              >
                התחל ייבוא
              </Button>
            </>
          )}
          {step === 4 && (
            <Button onClick={handleClose} className="bg-yellow-400 hover:bg-yellow-500 text-gray-900">
              סגור
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}