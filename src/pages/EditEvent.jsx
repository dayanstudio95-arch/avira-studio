import React, { useState, useEffect } from "react";
import { Event } from "@/entities/Event";
import { StaffMember } from "@/entities/StaffMember"; // Added StaffMember import
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { getStaffRateForRole } from "@/lib/staffRates";
import { getVatPercent } from "@/lib/financialCalculations";

import StepIndicator from "../components/newEvent/StepIndicator";
import DetailsStep from "../components/newEvent/DetailsStep";
import ExpensesStep from "../components/newEvent/ExpensesStep";
import SummaryStep from "../components/newEvent/SummaryStep";
import RescheduleConfirmModal from "../components/events/RescheduleConfirmModal";

export default function EditEvent() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [eventData, setEventData] = useState(null);
  const [originalDate, setOriginalDate] = useState(null);
  const [rescheduleModal, setRescheduleModal] = useState(null);
  const [staffMembers, setStaffMembers] = useState([]);
  const [packages, setPackages] = useState([]);

  const urlParams = new URLSearchParams(window.location.search);
  const eventId = urlParams.get('id');

  useEffect(() => {
    if (!eventId) {
      navigate(createPageUrl("Dashboard"));
      return;
    }
    loadEvent();
    
    // Fetch staff members on component mount
    const fetchStaff = async () => {
        try {
            const members = await StaffMember.list();
            setStaffMembers(members);
        } catch (error) {
            console.error("Error fetching staff members:", error);
        }
    };
    fetchStaff();

    const fetchPackages = async () => {
        try {
            const pkgs = await base44.entities.Package.list();
            setPackages(pkgs);
        } catch (error) {
            console.error("Error fetching packages:", error);
        }
    };
    fetchPackages();
  }, [eventId]);

  const loadEvent = async () => {
    setIsLoading(true);
    try {
      const events = await Event.list();
      const foundEvent = events.find(e => e.id === eventId);
      if (foundEvent) {
        let eventToSet = foundEvent;
        // Auto-fix requiredCrew from package
        if (foundEvent.packageId) {
          try {
            const pkgs = await base44.entities.Package.list();
            const pkg = pkgs.find(p => p.id === foundEvent.packageId);
            if (pkg && pkg.totalCrewCount != null && pkg.totalCrewCount !== foundEvent.requiredCrew) {
              eventToSet = { ...foundEvent, requiredCrew: pkg.totalCrewCount };
              await base44.entities.Event.update(eventId, { requiredCrew: pkg.totalCrewCount });
            }
          } catch (e) {
            console.error('Error auto-fixing requiredCrew:', e);
          }
        }
        setEventData(eventToSet);
        setOriginalDate(eventToSet.date);
      } else {
        navigate(createPageUrl("Dashboard"));
      }
    } catch (error) {
      console.error("Error loading event:", error);
    }
    setIsLoading(false);
  };

  const steps = [
    { number: 1, title: "פרטי האירוע", description: "מידע בסיסי" },
    { number: 2, title: "הוצאות", description: "עלויות הצוות" },
    { number: 3, title: "סיכום", description: "בדיקה ואישור" }
  ];

  const calculateFinancials = (data) => {
    if (!data) return {};
    const totalAmountGross = data.totalAmountGross || 0;
    
    // Extract VAT using the event's own rate to get amount before VAT
    const amountBeforeVat = totalAmountGross / (1 + getVatPercent(data) / 100);
    const vatAmount = totalAmountGross - amountBeforeVat;
    
    // Calculate total expenses from the 'team' array (including editor)
    const totalExpenses = (data.team || []).reduce((sum, member) => sum + (member.cost || 0), 0);
    
    // Net profit = amount before VAT - total expenses
    const profitNet = amountBeforeVat - totalExpenses;

    // `totalExpenses` is deliberately NOT returned. There is no `events.total_expenses`
    // column and there never was one (it is a leftover Base44 field name), while
    // src/api/entities.js's recordToRow passes every key straight through to PostgREST
    // with no allowlist. Including it made every save of this screen fail with
    // PGRST204 "Could not find the 'total_expenses' column of 'events' in the schema
    // cache" -- raised at request-parse time, before auth, so it failed for everyone
    // from the very first commit of the Supabase rewrite until 2026-08-27. The catch in
    // executeSave() showed only "שגיאה בעדכון אירוע", which is why it went unnoticed.
    // Consumers that want the figure derive it from `team`, exactly as this line does.
    return { ...data, vatableAmount: totalAmountGross, vatAmount: Math.round(vatAmount * 100) / 100, profitNet: Math.round(profitNet * 100) / 100 };
  };

  const handleUpdate = async () => {
    const finalData = calculateFinancials(eventData);
    const dateChanged = originalDate && eventData.date && originalDate !== eventData.date;

    // If date changed and a linked lead exists → show confirmation modal
    if (dateChanged && eventData.leadId) {
      setRescheduleModal({ oldDate: originalDate, newDate: eventData.date, event: eventData, finalData });
      return;
    }

    // No date change (or no leadId): save directly
    await executeSave(finalData, dateChanged, false);
  };

  const executeSave = async (finalData, dateChanged, updateLead) => {
    setIsUpdating(true);
    try {
      await base44.entities.Event.update(eventId, finalData);

      if (updateLead && eventData.leadId && finalData.date) {
        try {
          await base44.entities.Lead.update(eventData.leadId, { eventDate: finalData.date });
        } catch (e) {
          console.error('[reschedule] Failed to update lead date:', e);
          toast.warning('אירוע עודכן, אך עדכון הליד נכשל');
        }
      }

      if (dateChanged) {
        try {
          await base44.functions.invoke('syncEventToCalendar', { eventId });
        } catch (e) {
          console.error('[reschedule] Calendar sync failed:', e);
          toast.warning('אירוע עודכן אך סנכרון יומן נכשל');
        }
      }

      toast.success('אירוע עודכן בהצלחה');
      setRescheduleModal(null);
      navigate(createPageUrl(`EventDetails?id=${eventId}`));
    } catch (error) {
      console.error("Error updating event:", error);
      toast.error('שגיאה בעדכון אירוע');
    }
    setIsUpdating(false);
  };
  
  const handleNext = () => currentStep < 3 && setCurrentStep(currentStep + 1);
  const handleBack = () => currentStep > 1 && setCurrentStep(currentStep - 1);
  const updateEventData = (updates) => setEventData(prev => ({ ...prev, ...updates }));

  // New function to handle updates for individual team members
  const updateTeamMember = (role, updates) => {
      setEventData(prev => {
          const newTeam = [...(prev.team || [])]; // Ensure team is an array, create a copy
          const memberIndex = newTeam.findIndex(m => m.role === role);

          // If staffMemberName changed, auto-update cost from defaultRate
          let finalUpdates = { ...updates };
          if (updates.staffMemberName !== undefined && updates.cost === undefined) {
              const selectedStaff = staffMembers.find(s => s.name === updates.staffMemberName);
              if (selectedStaff) {
                  finalUpdates.cost = getStaffRateForRole(selectedStaff, role);
              }
          }

          const parsedCost = parseFloat(finalUpdates.cost) || 0;
          const updatesWithParsedCost = { ...finalUpdates, cost: parsedCost };

          if (memberIndex > -1) {
              // If staffMemberName is empty AND cost is 0, remove the member
              if (!finalUpdates.staffMemberName && parsedCost === 0) {
                  newTeam.splice(memberIndex, 1);
              } else {
                  // Otherwise, update existing member
                  newTeam[memberIndex] = { ...newTeam[memberIndex], ...updatesWithParsedCost };
              }
          } else if (finalUpdates.staffMemberName || parsedCost > 0) {
              // Add new member if a name is provided or cost is greater than 0
              newTeam.push({ role, isPaid: false, ...updatesWithParsedCost });
          }

          // If videographer exists, ensure editor also exists
          const hasVideographer = newTeam.some(m => ['videographer', 'videographer2'].includes(m.role));
          const hasEditor = newTeam.some(m => m.role === 'editor');
          
          if (hasVideographer && !hasEditor) {
              // Get default editor rate
              const defaultEditor = staffMembers.find(s => s.role === 'editor');
              newTeam.push({
                  role: 'editor',
                  isPaid: false,
                  staffMemberName: '',
                  cost: getStaffRateForRole(defaultEditor, 'editor'),
                  progressStatus: 'pending'
              });
          } else if (!hasVideographer && hasEditor) {
              // Remove editor if no videographer
              const editorIndex = newTeam.findIndex(m => m.role === 'editor');
              if (editorIndex > -1) {
                  newTeam.splice(editorIndex, 1);
              }
          }

          return { ...prev, team: newTeam };
      });
  };

  const isStepValid = () => {
    if (!eventData) return false;
    if (currentStep === 1) return eventData.date && eventData.coupleNames && eventData.totalAmountGross > 0;
    return true;
  };
  
  // Added !eventData to loading condition
  if (isLoading || !eventData) {
    return (
      <div className="min-h-screen bg-gray-950 p-4 md:p-8">
        <div className="max-w-4xl mx-auto space-y-8">
          <Skeleton className="h-10 w-64 bg-gray-800" />
          <Skeleton className="h-24 w-full bg-gray-800" />
          <Skeleton className="h-96 w-full bg-gray-800" />
        </div>
      </div>
    );
  }

  return (
    <>
    {rescheduleModal && (
      <RescheduleConfirmModal
        data={rescheduleModal}
        onConfirm={({ updateLead }) => executeSave(rescheduleModal.finalData, true, updateLead)}
        onCancel={() => setRescheduleModal(null)}
      />
    )}
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="outline" size="icon" onClick={() => navigate(createPageUrl(`EventDetails?id=${eventId}`))} className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"><ArrowLeft className="w-4 h-4" /></Button>
          <div>
            <h1 className="text-3xl font-bold text-white">עריכת אירוע</h1>
            <p className="text-gray-400">{eventData.coupleNames}</p>
          </div>
        </div>

        <StepIndicator steps={steps} currentStep={currentStep} />

        <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
          <CardHeader className="border-b border-gray-800"><CardTitle className="text-xl text-white">{steps[currentStep - 1].title}</CardTitle></CardHeader>
          <CardContent className="p-6">
            {currentStep === 1 && <DetailsStep eventData={eventData} updateEventData={updateEventData} packages={packages} />}
            {/* Passed updateTeamMember and staffMembers to ExpensesStep */}
            {currentStep === 2 && <ExpensesStep eventData={eventData} updateTeamMember={updateTeamMember} staffMembers={staffMembers} />}
            {currentStep === 3 && <SummaryStep eventData={calculateFinancials(eventData)} />}
          </CardContent>
        </Card>

        <div className="flex justify-between mt-8">
          <Button variant="outline" onClick={handleBack} disabled={currentStep === 1} className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2"><ArrowRight className="w-4 h-4" />חזור</Button>
          {currentStep < 3 ? (
            <Button onClick={handleNext} disabled={!isStepValid()} className="bg-gradient-to-r from-yellow-400 to-yellow-500 hover:from-yellow-500 hover:to-yellow-600 text-gray-900 font-semibold disabled:opacity-50 flex items-center gap-2"><ArrowLeft className="w-4 h-4" />הבא</Button>
          ) : (
            <Button onClick={handleUpdate} disabled={isUpdating} className="bg-gradient-to-r from-green-400 to-green-500 hover:from-green-500 hover:to-green-600 text-gray-900 font-semibold flex items-center gap-2"><Check className="w-4 h-4" />{isUpdating ? 'מעדכן...' : 'עדכן אירוע'}</Button>
          )}
        </div>
      </div>
    </div>
    </>
  );
}