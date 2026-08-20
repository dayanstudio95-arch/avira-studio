import React, { useState, useEffect } from "react";
import { Event } from "@/entities/Event";
import { base44 } from "@/api/base44Client";
import { useNavigate, Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Calendar, Heart, Banknote, Edit, Check, X, Trash2, Users } from "lucide-react"; // Added Users icon
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";

import EventChart from "../components/eventDetails/EventChart";
import ClientCard from "../components/eventDetails/ClientCard";

const paymentStatusConfig = {
  "Paid": { color: "bg-green-500/20 text-green-400 border-green-500/30", icon: "✅" },
  "Partially Paid": { color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", icon: "🟡" },
  "Unpaid": { color: "bg-red-500/20 text-red-400 border-red-500/30", icon: "🔴" }
};

export default function EventDetails() {
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditingStatus, setIsEditingStatus] = useState(false);
  const [newPaymentStatus, setNewPaymentStatus] = useState(""); // This now refers to client payment status
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const urlParams = new URLSearchParams(window.location.search);
  const eventId = urlParams.get('id');

  useEffect(() => {
    if (eventId) {
      loadEvent();
    }
  }, [eventId]);

  const loadEvent = async () => {
    setIsLoading(true);
    try {
      const events = await Event.list();
      const foundEvent = events.find(e => e.id === eventId);
      if (foundEvent) {
        setEvent(foundEvent);
        // Set newPaymentStatus for the client's payment status
        setNewPaymentStatus(foundEvent.clientPaymentStatus || "Unpaid");
      }
    } catch (error) {
      console.error("Error loading event:", error);
    }
    setIsLoading(false);
  };

  const updatePaymentStatus = async () => {
    if (!event || !newPaymentStatus) return;
    
    try {
      // Update the clientPaymentStatus field
      await Event.update(event.id, { clientPaymentStatus: newPaymentStatus });
      setEvent({ ...event, clientPaymentStatus: newPaymentStatus });
      setIsEditingStatus(false);
    } catch (error) {
      console.error("Error updating payment status:", error);
    }
  };

  const handleDelete = async () => {
    if (!event) return;
    try {
      // Clean up Google Calendar BEFORE deleting the row — best-effort, never
      // blocks the actual deletion.
      try {
        await base44.functions.invoke('deleteEventFromCalendar', { eventId: event.id });
      } catch (calendarErr) {
        console.error('Failed to clean up Google Calendar for event', event.id, calendarErr);
      }
      await Event.delete(event.id);
      setIsDeleteDialogOpen(false);
      navigate(createPageUrl("Dashboard"));
    } catch (error) {
      console.error("Error deleting event:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-gray-800 rounded-lg w-64"></div>
            <div className="h-96 bg-gray-800 rounded-xl"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-gray-950 p-4 md:p-8">
        <div className="max-w-6xl mx-auto text-center">
          <h1 className="text-2xl font-bold text-white mb-4">אירוע לא נמצא</h1>
          <Button onClick={() => navigate(createPageUrl("Dashboard"))}>
            חזור לדף הבית
          </Button>
        </div>
      </div>
    );
  }

  const teamExpenses = (event.team || []).reduce((sum, member) => sum + (member.cost || 0), 0);
  const hasVideographer = (event.team || []).some(m => ['videographer', 'videographer2'].includes(m.role));
  const totalExpenses = teamExpenses + (hasVideographer ? 1200 : 0);

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-start justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigate(createPageUrl("Dashboard"))}
              className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-white">{event.coupleNames}</h1>
              <p className="text-gray-400">
                {format(new Date(event.date), "d/M/yyyy")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to={createPageUrl(`TeamPayments?id=${event.id}`)}>
              <Button variant="outline" className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white flex items-center gap-2">
                <Users className="w-4 h-4" />
                תשלומי צוות
              </Button>
            </Link>
            <Link to={createPageUrl(`EditEvent?id=${event.id}`)}>
              <Button variant="outline" className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white flex items-center gap-2">
                <Edit className="w-4 h-4" />
                ערוך
              </Button>
            </Link>
            <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" className="bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300 border border-red-500/30 flex items-center gap-2">
                  <Trash2 className="w-4 h-4" />
                  מחק
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-gray-900 border-gray-800 text-white">
                <DialogHeader>
                  <DialogTitle>האם אתה בטוח?</DialogTitle>
                  <DialogDescription className="text-gray-400">
                    פעולה זו תמחק את האירוע "{event.coupleNames}" לצמיתות. לא ניתן יהיה לשחזר את הנתונים.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2 sm:justify-start">
                  <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)} className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700">
                    ביטול
                  </Button>
                  <Button variant="destructive" onClick={handleDelete}>
                    מחק אירוע
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Client Card */}
          <div>
            <ClientCard event={event} />
          </div>

          {/* Event Details */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
              <CardHeader className="border-b border-gray-800">
                <CardTitle className="text-white flex items-center gap-2">
                  <Heart className="w-5 h-5 text-yellow-400" />
                  מידע על האירוע
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <Calendar className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="text-sm text-gray-400">תאריך האירוע</p>
                        <p className="text-white font-medium">
                          {format(new Date(event.date), "d/M/yyyy")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Heart className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="text-sm text-gray-400">הזוג</p>
                        <p className="text-white font-medium">{event.coupleNames}</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <Banknote className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="text-sm text-gray-400">סכום ברוטו</p>
                        <p className="text-yellow-400 font-semibold text-lg">
                          ₪{event.totalAmountGross?.toLocaleString()}
                        </p>
                        <p className="text-xs text-gray-500">
                          מע״מ: {event.vatPercent || 18}% (₪{event.vatAmount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                        </p>
                        {event.vatableAmount > 0 && event.vatableAmount < event.totalAmountGross && (
                            <p className="text-xs text-gray-500">
                                מחושב על בסיס ₪{event.vatableAmount.toLocaleString()}
                            </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-5 h-5 flex items-center justify-center">
                        {isEditingStatus ? (
                          <Edit className="w-4 h-4 text-gray-400" />
                        ) : (
                          <span className="text-sm">💳</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-gray-400">סטטוס תשלום</p>
                        {isEditingStatus ? (
                          <div className="flex items-center gap-2 mt-1">
                            <Select value={newPaymentStatus} onValueChange={setNewPaymentStatus}>
                              <SelectTrigger className="w-40 bg-gray-800 border-gray-700 text-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Paid">✅ שולם</SelectItem>
                                <SelectItem value="Partially Paid">🟡 שולם חלקית</SelectItem>
                                <SelectItem value="Unpaid">🔴 לא שולם</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button size="sm" onClick={updatePaymentStatus}>
                              <Check className="w-4 h-4" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setIsEditingStatus(false)} className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700">
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 mt-1">
                            <Badge 
                              variant="outline"
                              className={`${paymentStatusConfig[event.clientPaymentStatus || 'Unpaid']?.color} border font-medium`}
                            >
                              {paymentStatusConfig[event.clientPaymentStatus || 'Unpaid']?.icon} {event.clientPaymentStatus || 'Unpaid'}
                            </Badge>
                            <Button 
                              size="sm" 
                              variant="ghost"
                              onClick={() => setIsEditingStatus(true)}
                              className="text-gray-400 hover:text-yellow-400"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {event.notes && (
                  <div className="mt-6 pt-6 border-t border-gray-800">
                    <p className="text-sm text-gray-400 mb-2">הערות</p>
                    <p className="text-gray-300">{event.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Expenses Breakdown */}
            <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
              <CardHeader className="border-b border-gray-800">
                <CardTitle className="text-white">פירוט הוצאות</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-3">
                    {(event.team || []).map((member, index) => (
                        <div key={index} className="flex justify-between items-center">
                            <span className="text-gray-400">{member.staffMemberName || `איש צוות`}</span>
                            <span className="text-white font-medium">₪{(member.cost || 0).toLocaleString()}</span>
                        </div>
                    ))}
                    {hasVideographer && (
                        <div className="flex justify-between items-center pt-2 border-t border-gray-700">
                            <span className="text-gray-400">דרור (עורך וידאו)</span>
                            <span className="text-white font-medium">₪1,200</span>
                        </div>
                    )}
                </div>
                <div className="mt-4 pt-4 border-t border-gray-800">
                  <div className="flex justify-between items-center">
                    <span className="text-white font-semibold">סך הוצאות</span>
                    <span className="text-red-400 font-bold text-lg">₪{totalExpenses.toLocaleString()}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Profit Chart - moved to bottom */}
        <div className="mt-6">
          <EventChart event={event} />
        </div>
      </div>
    </div>
  );
}