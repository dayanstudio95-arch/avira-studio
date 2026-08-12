import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DollarSign, Save, Users, Edit, Trash2, Plus, Upload, Download, FileText, Plug, MessageCircle, Building2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import IntegrationsTab from "../components/settings/IntegrationsTab";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CSVImportDialog from "../components/CSVImportDialog";
import StaffImportDialog from "../components/settings/StaffImportDialog";
import DiscountForm from "../components/settings/DiscountForm";
import DiscountList from "../components/settings/DiscountList";
import PricingManagement from "../components/settings/PricingManagement";
import MessageTemplatesTab from "../components/settings/MessageTemplatesTab";
import TeamAutomationTab from "../components/settings/TeamAutomationTab";
import GoogleCalendarCleanupSettings from "../components/settings/GoogleCalendarCleanupSettings";
import StaffRatesEditor from "../components/settings/StaffRatesEditor";
import UsersTab from "../components/settings/UsersTab";
import WorkspaceTab from "../components/settings/WorkspaceTab";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import { DEFAULT_CONTRACT_TERMS } from "@/lib/defaultContractTerms";
import { toast } from "sonner";

export default function Settings() {
  const [staffMembers, setStaffMembers] = useState([]);
  const [isStaffLoading, setIsStaffLoading] = useState(true);
  const [editingStaff, setEditingStaff] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: "", role: "photographer", defaultRate: 0, phoneNumber: "", email: "", ratesByRole: [] });
  const [editStaffData, setEditStaffData] = useState(null);
  const [isEditStaffDialogOpen, setIsEditStaffDialogOpen] = useState(false);
  const [isEventImportOpen, setIsEventImportOpen] = useState(false);
  const [isStaffImportOpen, setIsStaffImportOpen] = useState(false);
  const [masterContractTerms, setMasterContractTerms] = useState(DEFAULT_CONTRACT_TERMS);
  const [isSavingContract, setIsSavingContract] = useState(false);
  const [contractSettingId, setContractSettingId] = useState(null);

  useEffect(() => {
    loadStaff();
    loadContractSetting();
  }, []);

  const loadContractSetting = async () => {
    try {
      const settings = await base44.entities.AppSetting.filter({ key: "defaultContractTerms" });
      if (settings && settings.length > 0) {
        setMasterContractTerms(settings[0].value || DEFAULT_CONTRACT_TERMS);
        setContractSettingId(settings[0].id);
      }
    } catch (error) {
      console.error("Error loading contract setting:", error);
    }
  };

  const handleSaveContractTerms = async () => {
    setIsSavingContract(true);
    try {
      if (contractSettingId) {
        await base44.entities.AppSetting.update(contractSettingId, { value: masterContractTerms });
      } else {
        const created = await base44.entities.AppSetting.create({ key: "defaultContractTerms", value: masterContractTerms });
        setContractSettingId(created.id);
      }
      toast.success("תנאי החוזה עודכנו בהצלחה");
    } catch (error) {
      toast.error("שגיאה בשמירת תנאי החוזה");
    }
    setIsSavingContract(false);
  };

  const loadStaff = async () => {
    setIsStaffLoading(true);
    try {
      const data = await base44.entities.StaffMember.list();
      setStaffMembers(data);
    } catch (error) {
      console.error("Error loading staff:", error);
    }
    setIsStaffLoading(false);
  };

  const handleAddStaff = async () => {
    if (!newStaff.name) return;
    try {
      await base44.entities.StaffMember.create(newStaff);
      setNewStaff({ name: "", role: "photographer", defaultRate: 0 });
      setIsDialogOpen(false);
      loadStaff();
    } catch (error) {
      console.error("Error adding staff:", error);
    }
  };

  const handleUpdateStaff = async (id, updates) => {
    try {
      await base44.entities.StaffMember.update(id, updates);
      loadStaff();
      setEditingStaff(null);
      setIsEditStaffDialogOpen(false);
      setEditStaffData(null);
    } catch (error) {
      console.error("Error updating staff:", error);
    }
  };

  const handleDeleteStaff = async (id) => {
    if (!confirm("האם אתה בטוח שברצונך למחוק את איש הצוות?")) return;
    try {
      await base44.entities.StaffMember.delete(id);
      loadStaff();
    } catch (error) {
      console.error("Error deleting staff:", error);
    }
  };

  const handleExportEvents = async () => {
    try {
      const events = await base44.entities.Event.list();
      const csvContent = [
        ['תאריך', 'שם הזוג', 'טלפון', 'אולם', 'סכום ברוטו', 'אחוז מע"ם', 'סטטוס תשלום', 'הערות'].join(','),
        ...events.map(e => [
          e.date || '',
          e.coupleNames || '',
          e.phoneNumber || '',
          e.venue || '',
          e.totalAmountGross || 0,
          e.vatPercent || 18,
          e.clientPaymentStatus || 'Unpaid',
          (e.notes || '').replace(/,/g, ';')
        ].join(','))
      ].join('\n');

      const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `events_export_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
    } catch (error) {
      console.error("Export error:", error);
    }
  };

  const handleExportStaff = async () => {
    try {
      const staff = await base44.entities.StaffMember.list();
      const csvContent = [
        ['שם', 'תפקיד', 'תעריף ברירת מחדל'].join(','),
        ...staff.map(s => [
          s.name || '',
          s.role || '',
          s.defaultRate || 0
        ].join(','))
      ].join('\n');

      const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `staff_export_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
    } catch (error) {
      console.error("Export error:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
            הגדרות
          </h1>
          <p className="text-gray-400">
            כל הגדרות המערכת במקום אחד
          </p>
        </div>

        <Tabs defaultValue="workspace" dir="rtl" className="mb-6">
          <TabsList className="bg-gray-800 border border-gray-700 mb-6 w-full justify-start flex-wrap h-auto">
            <TabsTrigger value="workspace" className="data-[state=active]:bg-yellow-400 data-[state=active]:text-gray-900 text-gray-300">
              <Building2 className="w-4 h-4 ml-1" />
              סביבת עבודה
            </TabsTrigger>
            <TabsTrigger value="contract" className="data-[state=active]:bg-yellow-400 data-[state=active]:text-gray-900 text-gray-300">
              <FileText className="w-4 h-4 ml-1" />
              חוזה
            </TabsTrigger>
            <TabsTrigger value="pricing" className="data-[state=active]:bg-yellow-400 data-[state=active]:text-gray-900 text-gray-300">
              <DollarSign className="w-4 h-4 ml-1" />
              תמחור והנחות
            </TabsTrigger>
            <TabsTrigger value="team" className="data-[state=active]:bg-yellow-400 data-[state=active]:text-gray-900 text-gray-300">
              <Users className="w-4 h-4 ml-1" />
              צוות ואוטומציות
            </TabsTrigger>
            <TabsTrigger value="users" className="data-[state=active]:bg-yellow-400 data-[state=active]:text-gray-900 text-gray-300">
              <Users className="w-4 h-4 ml-1" />
              משתמשים
            </TabsTrigger>
            <TabsTrigger value="templates" className="data-[state=active]:bg-yellow-400 data-[state=active]:text-gray-900 text-gray-300">
              <MessageCircle className="w-4 h-4 ml-1" />
              תבניות הודעה
            </TabsTrigger>
            <TabsTrigger value="integrations" className="data-[state=active]:bg-yellow-400 data-[state=active]:text-gray-900 text-gray-300">
              <Plug className="w-4 h-4 ml-1" />
              חיבורים
            </TabsTrigger>
            <TabsTrigger value="data" className="data-[state=active]:bg-yellow-400 data-[state=active]:text-gray-900 text-gray-300">
              <Upload className="w-4 h-4 ml-1" />
              ייבוא / ייצוא
            </TabsTrigger>
          </TabsList>

          {/* סביבת עבודה */}
          <TabsContent value="workspace">
            <WorkspaceTab />
          </TabsContent>

          {/* משתמשים */}
          <TabsContent value="users">
            <UsersTab />
          </TabsContent>

          {/* חוזה */}
          <TabsContent value="contract">
            <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
              <CardHeader className="border-b border-gray-800">
                <CardTitle className="text-white flex items-center gap-2">
                  <FileText className="w-5 h-5 text-yellow-400" />
                  ניהול חוזה ברירת מחדל
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <p className="text-gray-400 text-sm mb-4">
                  הטקסט שתכתוב כאן יתמלא אוטומטית בכל ליד חדש. ניתן לערוך את החוזה לכל ליד בנפרד מבלי לשנות את הנוסח הכאן.
                </p>
                <div className="rounded-md overflow-hidden mb-4" dir="rtl">
                  <style>{`
                    .master-contract-quill .ql-toolbar { background: #374151; border-color: #4b5563; }
                    .master-contract-quill .ql-toolbar .ql-stroke { stroke: #d1d5db; }
                    .master-contract-quill .ql-toolbar .ql-fill { fill: #d1d5db; }
                    .master-contract-quill .ql-toolbar .ql-picker { color: #d1d5db; }
                    .master-contract-quill .ql-container { background: #1f2937; border-color: #4b5563; color: #f3f4f6; min-height: 300px; font-size: 13px; }
                    .master-contract-quill .ql-editor { direction: rtl; text-align: right; }
                  `}</style>
                  <ReactQuill
                    className="master-contract-quill"
                    value={masterContractTerms}
                    onChange={setMasterContractTerms}
                    modules={{
                      toolbar: [
                        [{ header: [2, 3, false] }],
                        ["bold", "italic", "underline"],
                        [{ list: "ordered" }, { list: "bullet" }],
                        ["clean"],
                      ],
                    }}
                  />
                </div>
                <Button
                  onClick={handleSaveContractTerms}
                  disabled={isSavingContract}
                  className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {isSavingContract ? "שומר..." : "שמור נוסח חוזה"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* תמחור והנחות */}
          <TabsContent value="pricing">
            <div className="space-y-6">
              <PricingManagement />

              <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
                <CardHeader className="border-b border-gray-800">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-white flex items-center gap-2">
                      <DollarSign className="w-5 h-5 text-yellow-400" />
                      ניהול הנחות
                    </CardTitle>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" className="bg-yellow-400 hover:bg-yellow-500 text-gray-900">
                          <Plus className="w-4 h-4 mr-2" />
                          הוסף הנחה
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="bg-gray-900 border-gray-800 text-white">
                        <DialogHeader>
                          <DialogTitle>הוסף הנחה חדשה</DialogTitle>
                        </DialogHeader>
                        <DiscountForm onSuccess={() => window.location.reload()} />
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  <DiscountList />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* צוות ואוטומציות */}
          <TabsContent value="team">
            <div className="space-y-6">
              <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
                <CardHeader className="border-b border-gray-800">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-white flex items-center gap-2">
                      <Users className="w-5 h-5 text-yellow-400" />
                      ניהול אנשי צוות
                    </CardTitle>
                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                      <DialogTrigger asChild>
                        <Button size="sm" className="bg-yellow-400 hover:bg-yellow-500 text-gray-900">
                          <Plus className="w-4 h-4 mr-2" />
                          הוסף איש צוות
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="bg-gray-900 border-gray-800 text-white">
                        <DialogHeader>
                          <DialogTitle>הוסף איש צוות חדש</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label>שם</Label>
                            <Input
                              value={newStaff.name}
                              onChange={(e) => setNewStaff({...newStaff, name: e.target.value})}
                              className="bg-gray-800 border-gray-700 text-white"
                              placeholder="הכנס שם"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>תפקיד</Label>
                            <Select value={newStaff.role} onValueChange={(val) => setNewStaff({...newStaff, role: val})}>
                              <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-gray-900 border-gray-700 text-white">
                                <SelectItem value="photographer">צלם</SelectItem>
                                <SelectItem value="videographer">וידאוגרף</SelectItem>
                                <SelectItem value="editor">עורך</SelectItem>
                                <SelectItem value="graphic_designer">גרפיקאית</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>מחיר ברירת מחדל (₪)</Label>
                            <Input
                              type="number"
                              value={newStaff.defaultRate}
                              onChange={(e) => setNewStaff({...newStaff, defaultRate: parseFloat(e.target.value) || 0})}
                              className="bg-gray-800 border-gray-700 text-white"
                            />
                          </div>
                          <StaffRatesEditor staff={newStaff} onChange={setNewStaff} />
                          <div className="space-y-2">
                            <Label>מספר טלפון</Label>
                            <Input
                              type="tel"
                              value={newStaff.phoneNumber}
                              onChange={(e) => setNewStaff({...newStaff, phoneNumber: e.target.value})}
                              placeholder="05X-XXXXXXX"
                              className="bg-gray-800 border-gray-700 text-white"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>אימייל (לזימון יומן)</Label>
                            <Input
                              type="email"
                              value={newStaff.email}
                              onChange={(e) => setNewStaff({...newStaff, email: e.target.value})}
                              placeholder="example@email.com"
                              className="bg-gray-800 border-gray-700 text-white"
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button onClick={handleAddStaff} className="bg-yellow-400 hover:bg-yellow-500 text-gray-900">
                            הוסף
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardHeader>

                {/* Edit Staff Dialog */}
                <Dialog open={isEditStaffDialogOpen} onOpenChange={setIsEditStaffDialogOpen}>
                  <DialogContent className="bg-gray-900 border-gray-800 text-white">
                    <DialogHeader>
                      <DialogTitle>ערוך איש צוות</DialogTitle>
                    </DialogHeader>
                    {editStaffData && (
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label>שם</Label>
                          <Input value={editStaffData.name} onChange={(e) => setEditStaffData({...editStaffData, name: e.target.value})} className="bg-gray-800 border-gray-700 text-white" />
                        </div>
                        <div className="space-y-2">
                          <Label>תפקיד</Label>
                          <Select value={editStaffData.role} onValueChange={(val) => setEditStaffData({...editStaffData, role: val})}>
                            <SelectTrigger className="bg-gray-800 border-gray-700 text-white"><SelectValue /></SelectTrigger>
                            <SelectContent className="bg-gray-900 border-gray-700 text-white">
                              <SelectItem value="photographer">צלם</SelectItem>
                              <SelectItem value="videographer">וידאוגרף</SelectItem>
                              <SelectItem value="editor">עורך</SelectItem>
                              <SelectItem value="graphic_designer">גרפיקאית</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>מחיר ברירת מחדל (₪)</Label>
                          <Input type="number" value={editStaffData.defaultRate || 0} onChange={(e) => setEditStaffData({...editStaffData, defaultRate: parseFloat(e.target.value) || 0})} className="bg-gray-800 border-gray-700 text-white" />
                        </div>
                        {editStaffData && <StaffRatesEditor staff={editStaffData} onChange={setEditStaffData} />}
                        <div className="space-y-2">
                          <Label>מספר טלפון</Label>
                          <Input type="tel" value={editStaffData.phoneNumber || ""} onChange={(e) => setEditStaffData({...editStaffData, phoneNumber: e.target.value})} placeholder="05X-XXXXXXX" className="bg-gray-800 border-gray-700 text-white" />
                        </div>
                        <div className="space-y-2">
                          <Label>אימייל (לזימון יומן)</Label>
                          <Input type="email" value={editStaffData.email || ""} onChange={(e) => setEditStaffData({...editStaffData, email: e.target.value})} placeholder="example@email.com" className="bg-gray-800 border-gray-700 text-white" />
                        </div>
                      </div>
                    )}
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsEditStaffDialogOpen(false)} className="border-gray-700 text-gray-300">ביטול</Button>
                      <Button onClick={() => handleUpdateStaff(editStaffData.id, editStaffData)} className="bg-yellow-400 hover:bg-yellow-500 text-gray-900">שמור</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <CardContent className="p-6">
                  {isStaffLoading ? (
                    <div className="space-y-3">
                      {Array(3).fill(0).map((_, i) => (
                        <div key={i} className="h-16 bg-gray-800 rounded-lg animate-pulse" />
                      ))}
                    </div>
                  ) : staffMembers.length === 0 ? (
                    <p className="text-gray-400 text-center py-8">אין אנשי צוות במערכת</p>
                  ) : (
                    <div className="space-y-3">
                      {staffMembers.map((staff) => (
                        <div key={staff.id} className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg">
                          <div className="flex-1">
                            <div>
                              <p className="text-white font-medium">{staff.name}</p>
                              <p className="text-sm text-gray-400">
                                {staff.role === 'photographer' ? 'צלם' : staff.role === 'videographer' ? 'וידאוגרף' : staff.role === 'graphic_designer' ? 'גרפיקאית' : 'עורך'} • ₪{staff.defaultRate?.toLocaleString() || 0}
                                {staff.phoneNumber && ` • ${staff.phoneNumber}`}
                              </p>
                              {staff.email && <p className="text-xs text-blue-400 mt-0.5">✉ {staff.email}</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => { setEditStaffData({...staff}); setIsEditStaffDialogOpen(true); }}
                              className="text-gray-400 hover:text-yellow-400"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeleteStaff(staff.id)}
                              className="text-gray-400 hover:text-red-400"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <TeamAutomationTab />
            </div>
          </TabsContent>

          {/* תבניות הודעה */}
          <TabsContent value="templates">
            <MessageTemplatesTab />
          </TabsContent>

          {/* חיבורים */}
          <TabsContent value="integrations">
            <div className="space-y-6">
              <GoogleCalendarCleanupSettings />
              <IntegrationsTab />
            </div>
          </TabsContent>

          {/* ייבוא / ייצוא */}
          <TabsContent value="data">
            <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
              <CardHeader className="border-b border-gray-800">
                <CardTitle className="text-white flex items-center gap-2">
                  <Upload className="w-5 h-5 text-yellow-400" />
                  ייבוא וייצוא נתונים
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-400 mb-3">ייבוא נתונים</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Button
                        onClick={() => setIsEventImportOpen(true)}
                        variant="outline"
                        className="border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-yellow-400 hover:border-yellow-400 h-auto py-4"
                      >
                        <div className="flex flex-col items-center gap-2 w-full">
                          <Upload className="w-8 h-8" />
                          <span className="font-semibold">ייבוא אירועים</span>
                          <span className="text-xs text-gray-500">העלה קובץ CSV עם אירועים</span>
                        </div>
                      </Button>

                      <Button
                        onClick={() => setIsStaffImportOpen(true)}
                        variant="outline"
                        className="border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-yellow-400 hover:border-yellow-400 h-auto py-4"
                      >
                        <div className="flex flex-col items-center gap-2 w-full">
                          <Upload className="w-8 h-8" />
                          <span className="font-semibold">ייבוא אנשי צוות</span>
                          <span className="text-xs text-gray-500">העלה קובץ CSV עם אנשי צוות</span>
                        </div>
                      </Button>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-gray-400 mb-3">ייצוא נתונים</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Button
                        onClick={handleExportEvents}
                        variant="outline"
                        className="border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-green-400 hover:border-green-400 h-auto py-4"
                      >
                        <div className="flex flex-col items-center gap-2 w-full">
                          <Download className="w-8 h-8" />
                          <span className="font-semibold">ייצוא אירועים</span>
                          <span className="text-xs text-gray-500">הורד CSV של כל האירועים</span>
                        </div>
                      </Button>

                      <Button
                        onClick={handleExportStaff}
                        variant="outline"
                        className="border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-green-400 hover:border-green-400 h-auto py-4"
                      >
                        <div className="flex flex-col items-center gap-2 w-full">
                          <Download className="w-8 h-8" />
                          <span className="font-semibold">ייצוא אנשי צוות</span>
                          <span className="text-xs text-gray-500">הורד CSV של כל אנשי הצוות</span>
                        </div>
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Import Dialogs */}
        <CSVImportDialog
          isOpen={isEventImportOpen}
          onClose={() => setIsEventImportOpen(false)}
          onSuccess={() => {}}
        />
        <StaffImportDialog
          isOpen={isStaffImportOpen}
          onClose={() => setIsStaffImportOpen(false)}
          onSuccess={loadStaff}
        />
      </div>
    </div>
  );
}
