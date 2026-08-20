import React, { useState, useEffect } from "react";
import { Event } from "@/entities/Event";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, User } from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

export default function TeamPayments() {
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingPayment, setUpdatingPayment] = useState(null);

  const urlParams = new URLSearchParams(window.location.search);
  const eventId = urlParams.get('id');

  useEffect(() => {
    if (!eventId) {
      navigate(createPageUrl("Dashboard"));
      return;
    }
    loadEvent();
  }, [eventId]);

  const loadEvent = async () => {
    setIsLoading(true);
    try {
      const foundEvent = await Event.list().then(events => events.find(e => e.id === eventId));
      if (foundEvent) {
        setEvent(foundEvent);
      } else {
        navigate(createPageUrl("Dashboard"));
      }
    } catch (error) {
      console.error("Error loading event:", error);
    }
    setIsLoading(false);
  };

  const togglePaymentStatus = async (memberIndex) => {
    if (!event || updatingPayment) return;
    
    setUpdatingPayment(memberIndex);
    try {
      const newTeam = [...event.team];
      newTeam[memberIndex].isPaid = !newTeam[memberIndex].isPaid;
      
      await Event.update(event.id, { team: newTeam });
      setEvent({ ...event, team: newTeam });
    } catch (error) {
      console.error("Error updating payment status:", error);
    }
    setUpdatingPayment(null);
  };

  if (isLoading || !event) {
    return (
      <div className="min-h-screen bg-gray-950 p-4 md:p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <Skeleton className="h-10 w-64 bg-gray-800" />
          <div className="grid gap-4">
            {Array(4).fill(0).map((_, i) => (
              <Skeleton key={i} className="h-24 bg-gray-800" />
            ))}
          </div>
        </div>
      </div>
    );
  }
  
  const totalExpenses = (event.team || []).reduce((sum, member) => sum + (member.cost || 0), 0);
  const totalPaid = (event.team || []).reduce((sum, member) => member.isPaid ? sum + (member.cost || 0) : sum, 0);

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate(createPageUrl(`EventDetails?id=${event.id}`))}
            className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-white">תשלומים לצוות</h1>
            <p className="text-gray-400">{event.coupleNames} • {format(new Date(event.date), "d/M/yyyy")}</p>
          </div>
        </div>

        <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm mb-6">
          <CardHeader className="border-b border-gray-800">
            <CardTitle className="text-white">סיכום תשלומים</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <p className="text-sm text-gray-400 mb-1">שולם לצוות</p>
                <p className="text-2xl font-bold text-green-400">₪{totalPaid.toLocaleString()}</p>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-400 mb-1">נותר לשלם</p>
                <p className="text-2xl font-bold text-red-400">₪{(totalExpenses - totalPaid).toLocaleString()}</p>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-400 mb-1">סך הכל הוצאות</p>
                <p className="text-2xl font-bold text-white">₪{totalExpenses.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {(event.team || []).map((member, index) => {
            const isUpdating = updatingPayment === index;
            if (!member.staffMemberName && !member.cost) return null;

            return (
              <Card key={index} className={`transition-all duration-300 ${
                member.isPaid 
                  ? 'bg-green-500/10 border-green-500/30' 
                  : 'bg-red-500/10 border-red-500/30'
              }`}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-xl ${
                        member.isPaid ? 'bg-green-500/20' : 'bg-red-500/20'
                      }`}>
                        <User className={`w-6 h-6 ${
                          member.isPaid ? 'text-green-400' : 'text-red-400'
                        }`} />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-white">{member.staffMemberName || 'איש צוות'}</h3>
                        <p className="text-2xl font-bold text-yellow-400">₪{(member.cost || 0).toLocaleString()}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <Badge 
                        variant="outline"
                        className={`${
                          member.isPaid 
                            ? 'bg-green-500/20 text-green-400 border-green-500/30' 
                            : 'bg-red-500/20 text-red-400 border-red-500/30'
                        } font-medium`}
                      >
                        {member.isPaid ? 'שולם' : 'לא שולם'}
                      </Badge>
                      
                      <Button
                        onClick={() => togglePaymentStatus(index)}
                        disabled={isUpdating}
                        className={`${
                          member.isPaid 
                            ? 'bg-red-500 hover:bg-red-600' 
                            : 'bg-green-500 hover:bg-green-600'
                        } text-white transition-colors duration-200`}
                      >
                        {isUpdating ? "מעדכן..." : (member.isPaid ? 'בטל תשלום' : 'סמן כשולם')}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}