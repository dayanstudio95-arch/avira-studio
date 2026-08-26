import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { Loader2, Edit2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { getVatPercent } from "@/lib/financialCalculations";

export default function EventExpensesEditor({ eventId, onSave }) {
  const [event, setEvent] = useState(null);
  const [lead, setLead] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [vatableAmountInput, setVatableAmountInput] = useState(0);

  useEffect(() => {
    const loadData = async () => {
      try {
        const eventData = await base44.entities.Event.filter({ id: eventId });
        if (eventData.length > 0) {
          setEvent(eventData[0]);
          setVatableAmountInput(eventData[0].vatableAmount || eventData[0].totalAmountGross || 0);
          // Load linked lead if exists
          if (eventData[0].sourceLeadId) {
            const leadData = await base44.entities.Lead.filter({ id: eventData[0].sourceLeadId });
            if (leadData.length > 0) {
              setLead(leadData[0]);
            }
          }
        }
      } catch (error) {
        console.error("Failed to load event:", error);
        toast.error('שגיאה בטעינת נתונים');
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [eventId]);

  const handleSave = async () => {
    if (!event) return;
    setIsSaving(true);
    try {
      await base44.entities.Event.update(event.id, {
        team: event.team,
        totalAmountGross: event.totalAmountGross,
        vatAmount: vatableAmountInput * getVatPercent(event) / 100,
        vatableAmount: vatableAmountInput,
        clientPaymentStatus: event.clientPaymentStatus
      });
      toast.success('נתונים עודכנו בהצלחה');
      if (onSave) onSave();
    } catch (error) {
      console.error("Failed to save:", error);
      toast.error('שגיאה בשמירה');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditTeamMember = (index) => {
    const member = event.team[index];
    setEditingTeamId(index);
    setEditValues({ cost: member.cost || 0, isPaid: member.isPaid || false });
  };

  const handleSaveTeamMember = (index) => {
    const newTeam = [...event.team];
    newTeam[index] = { ...newTeam[index], ...editValues };
    setEvent({ ...event, team: newTeam });
    setEditingTeamId(null);
  };

  const handleCancelEdit = () => {
    setEditingTeamId(null);
    setEditValues({});
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="text-center py-8 text-gray-400">
        לא נמצא אירוע
      </div>
    );
  }

  // Calculations
  const totalAmountGross = event.totalAmountGross || 0;
  const vatPercent = getVatPercent(event);
  const vatAmount = vatableAmountInput * vatPercent / (100 + vatPercent);
  const vatableAmount = vatableAmountInput;
  const netAmount = vatableAmount - vatAmount;
  const totalTeamExpenses = (event.team || []).reduce((sum, m) => sum + (m.cost || 0), 0);
  const netProfit = (vatableAmount / (1 + vatPercent / 100)) - totalTeamExpenses;
  const totalPaid = lead?.totalPaid || 0;
  const remainingBalance = lead?.remainingBalance || (totalAmountGross - totalPaid);

  const getPaymentStatusLabel = () => {
    const status = event.clientPaymentStatus || 'Unpaid';
    if (status === 'Paid') return 'שולם במלואו';
    if (status === 'Partially Paid') return 'חלקי';
    return 'לא שולם';
  };

  return (
    <div className="space-y-6 p-4" dir="rtl">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">דוח כלכלי</h2>
        <p className="text-sm text-gray-400">{event.coupleNames}</p>
      </div>

      {/* SECTION 1: REVENUES */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-white">הכנסות</h3>
        
        {/* Vatable Amount Input */}
        <div className="bg-gray-800/50 border border-gray-700/40 rounded-lg p-4">
          <label className="block text-sm text-gray-400 font-medium mb-2">סכום חייב במע"מ:</label>
          <Input
            type="number"
            min="0"
            step="50"
            value={vatableAmountInput}
            onChange={(e) => setVatableAmountInput(parseFloat(e.target.value) || 0)}
            className="bg-gray-700 border-gray-600 text-white font-semibold"
          />
        </div>
        
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Gross Revenue */}
          <div className="bg-gradient-to-br from-green-900/30 to-green-900/10 border border-green-700/40 rounded-lg p-4">
            <p className="text-xs text-gray-400 font-medium mb-1">סכום ברוטו</p>
            <p className="text-2xl font-bold text-green-400">₪{totalAmountGross.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>

          {/* VAT */}
          <div className="bg-gradient-to-br from-orange-900/30 to-orange-900/10 border border-orange-700/40 rounded-lg p-4">
            <p className="text-xs text-gray-400 font-medium mb-1">מע"מ ({vatPercent}%)</p>
            <p className="text-2xl font-bold text-orange-400">₪{vatAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>

          {/* Net Amount */}
          <div className="bg-gradient-to-br from-blue-900/30 to-blue-900/10 border border-blue-700/40 rounded-lg p-4">
            <p className="text-xs text-gray-400 font-medium mb-1">סכום נטו (ללא מע"מ)</p>
            <p className="text-2xl font-bold text-blue-400">₪{netAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>
        </div>

        {/* Payment Details */}
        <div className="bg-gray-800/40 border border-gray-700/40 rounded-lg p-4 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-sm">סטטוס תשלום:</span>
            <span className="text-white font-medium">{getPaymentStatusLabel()}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-sm">סה"כ שולם:</span>
            <span className="text-green-400 font-semibold">₪{totalPaid.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="border-t border-gray-700/40 pt-3 flex justify-between items-center">
            <span className="text-gray-400 text-sm font-medium">יתרה לתשלום:</span>
            <span className={`font-bold ${remainingBalance === 0 ? 'text-green-400' : 'text-red-400'}`}>
              {remainingBalance === 0 ? '✅ שולם במלואו' : `₪${remainingBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            </span>
          </div>
        </div>
      </div>

      {/* SECTION 2: TEAM EXPENSES */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-white">הוצאות צוות</h3>

        {/* Team Table */}
        {(event.team || []).length > 0 ? (
          <div className="bg-gray-800/30 border border-gray-700/40 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800/50 border-b border-gray-700/40">
                  <th className="text-right px-3 py-2 text-gray-400 font-medium">תפקיד</th>
                  <th className="text-right px-3 py-2 text-gray-400 font-medium">שם</th>
                  <th className="text-right px-3 py-2 text-gray-400 font-medium">עלות (₪)</th>
                  <th className="text-center px-3 py-2 text-gray-400 font-medium">שולם</th>
                  <th className="text-center px-3 py-2 text-gray-400 font-medium">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {event.team.map((member, idx) => (
                  <tr key={idx} className="border-b border-gray-700/20 hover:bg-gray-800/20 transition-colors">
                    <td className="px-3 py-2 text-gray-300 text-xs font-medium">{member.role}</td>
                    <td className="px-3 py-2 text-gray-200">{member.staffMemberName}</td>
                    <td className="px-3 py-2">
                      {editingTeamId === idx ? (
                        <Input
                          type="number"
                          min="0"
                          step="50"
                          value={editValues.cost}
                          onChange={(e) => setEditValues({ ...editValues, cost: parseFloat(e.target.value) || 0 })}
                          className="bg-gray-700 border-gray-600 text-white w-24 text-sm"
                        />
                      ) : (
                        <span className="text-yellow-400 font-semibold">₪{(member.cost || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {editingTeamId === idx ? (
                        <Checkbox
                          checked={editValues.isPaid}
                          onCheckedChange={(checked) => setEditValues({ ...editValues, isPaid: checked })}
                          className="data-[state=checked]:bg-green-500 border-gray-600"
                        />
                      ) : (
                        member.isPaid && <span className="text-green-400">✅</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {editingTeamId === idx ? (
                        <div className="flex justify-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-green-400 hover:bg-green-900/20"
                            onClick={() => handleSaveTeamMember(idx)}
                          >
                            <Check className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-red-400 hover:bg-red-900/20"
                            onClick={handleCancelEdit}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-gray-400 hover:text-yellow-400 hover:bg-yellow-900/20"
                          onClick={() => handleEditTeamMember(idx)}
                        >
                          <Edit2 className="w-3 h-3" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="bg-gray-800/30 border border-gray-700/40 rounded-lg p-4 text-center text-gray-500">
            אין צוות משובץ לאירוע זה
          </div>
        )}

        {/* Totals */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Total Expenses */}
          <div className="bg-gradient-to-br from-red-900/30 to-red-900/10 border border-red-700/40 rounded-lg p-4">
            <p className="text-xs text-gray-400 font-medium mb-1">סה"כ הוצאות צוות</p>
            <p className="text-2xl font-bold text-red-400">₪{totalTeamExpenses.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>

          {/* Net Profit */}
          <div className={`bg-gradient-to-br ${netProfit >= 0 ? 'from-cyan-900/30 to-cyan-900/10' : 'from-red-900/30 to-red-900/10'} border ${netProfit >= 0 ? 'border-cyan-700/40' : 'border-red-700/40'} rounded-lg p-4`}>
            <p className="text-xs text-gray-400 font-medium mb-1">רווח נקי</p>
            <p className={`text-2xl font-bold ${netProfit >= 0 ? 'text-cyan-400' : 'text-red-400'}`}>
              ₪{netProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex gap-2 pt-4 border-t border-gray-700/40">
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-semibold"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
          שמור שינויים
        </Button>
      </div>
    </div>
  );
}