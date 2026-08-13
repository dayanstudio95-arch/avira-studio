import React, { useState, useEffect } from 'react';
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Eye, Heart, Users, Album, UserCheck, AlertTriangle, MessageCircle, Receipt } from "lucide-react";
import InvoiceDialog from "@/components/invoice/InvoiceDialog";

import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { calculateNetProfit } from "@/lib/profitCalculations";
import PaymentStatusSelector, { paymentStatusConfig, statusLabels } from "@/components/common/PaymentStatusSelector";
const { StaffMember } = base44.entities;

const calcProfit = (event, staffMembers) => calculateNetProfit(event, staffMembers);

export default function EventsTable({ events, isLoading, onRefresh }) {
  const [staffMembers, setStaffMembers] = useState([]);
  const [invoiceEvent, setInvoiceEvent] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const members = await base44.entities.StaffMember.list();
        setStaffMembers(members);
      } catch (error) {
        console.error("Failed to fetch data:", error);
      }
    };
    fetchData();
  }, []);

  const ROLE_DONE_FIELDS = {
    photographer1: 'photographer1Done',
    photographer2: 'photographer2Done',
    videographer: 'video1Done',
    videographer2: 'video1Done',
    editor: 'editorDone',
  };

  const getEventProgressStatus = (event) => {
    const team = event.team || [];
    const items = [];
    team.forEach(m => {
      const field = ROLE_DONE_FIELDS[m?.role];
      if (field) items.push(!!event[field]);
    });
    items.push(!!(event.rawLink || event.rawDoneManual));
    items.push(!!(event.finalLink || event.finalDoneManual));

    const total = items.length;
    if (total === 0) return { label: 'ממתין', color: 'bg-red-500/20 text-red-400 border-red-500/30' };
    const completed = items.filter(Boolean).length;
    const pct = Math.round((completed / total) * 100);

    if (pct === 100) return { label: `הושלם (${pct}%)`, color: 'bg-green-500/20 text-green-400 border-green-500/30' };
    if (pct > 0)    return { label: `בתהליך (${pct}%)`, color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' };
    return { label: 'ממתין', color: 'bg-red-500/20 text-red-400 border-red-500/30' };
  };

  if (isLoading) {
    return (
      <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-white">אירועים אחרונים</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array(5).fill(0).map((_, i) => (
              <div key={i} className="flex items-center justify-between p-4 rounded-lg bg-gray-800/30">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32 bg-gray-700" />
                  <Skeleton className="h-3 w-24 bg-gray-700" />
                </div>
                <Skeleton className="h-6 w-20 bg-gray-700" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
      <CardHeader className="border-b border-gray-800">
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl font-bold text-white flex items-center gap-2">
            <Heart className="w-5 h-5 text-yellow-400" />
            אירועים אחרונים
          </CardTitle>
          <Button 
            variant="outline" 
            size="sm"
            onClick={onRefresh}
            className="border-gray-700 text-gray-300 hover:bg-gray-800"
          >
            רענן
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* Mobile View - Cards */}
        <div className="md:hidden p-3 space-y-3">
          {events.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Heart className="w-12 h-12 mx-auto mb-4 text-gray-600" />
              <p className="text-lg font-medium">אין אירועים עדיין</p>
              <p className="text-sm">צור את האירוע הראשון שלך כדי להתחיל</p>
            </div>
          ) : (
            events.map((event) => {
              const clientPaymentStatus = event.clientPaymentStatus || "Unpaid";
              const assignedTeam = event.team?.filter(m => {
                if (!m.staffMemberName) return false;
                const staffMember = staffMembers.find(s => s.name === m.staffMemberName);
                return staffMember?.role !== 'editor';
              }) || [];
              const requiredCrew = event.requiredCrew || 3;
              const isFullTeam = assignedTeam.length >= requiredCrew;
              const progressStatus = getEventProgressStatus(event);

              return (
                <Card key={event.id} className="bg-gray-800/50 border-gray-700">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-bold text-white text-base">{event.coupleNames}</div>
                        <div className="text-gray-400 text-sm">{format(new Date(event.date), "d/M/yyyy")}</div>
                      </div>
                      <PaymentStatusSelector
                        eventId={event.id}
                        currentStatus={clientPaymentStatus}
                        onStatusChange={onRefresh}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-400">סכום:</span>
                        <span className="text-yellow-400 font-semibold mr-2">₪{event.totalAmountGross?.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-gray-400">רווח:</span>
                        <span className={`font-semibold mr-2 ${calcProfit(event, staffMembers) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                           ₪{Math.round(calcProfit(event, staffMembers)).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-2 flex-wrap">
                      <Badge variant="outline" className={`${progressStatus.color} border text-xs`}>
                        {progressStatus.label}
                      </Badge>
                      <Badge variant="outline" className={`${isFullTeam ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'} border text-xs`}>
                        {isFullTeam ? <UserCheck className="w-3 h-3 mr-1 inline" /> : <AlertTriangle className="w-3 h-3 mr-1 inline" />}
                        צוות {isFullTeam ? 'מלא' : `חסר ${requiredCrew - assignedTeam.length}`}
                      </Badge>
                      <Badge variant="outline" className={`${event.albumStatus === 'sent' ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-pink-500/20 text-pink-400 border-pink-500/30'} border text-xs`}>
                        <Album className="w-3 h-3 mr-1 inline" />
                        {event.albumStatus === 'sent' ? 'נשלח' : 'לא נשלח'}
                      </Badge>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Link to={createPageUrl(`EventDetails?id=${event.id}`)} className="flex-1">
                        <Button variant="outline" size="sm" className="w-full border-gray-700 text-gray-300 hover:bg-gray-700">
                          <Eye className="w-4 h-4 mr-2" />
                          צפה
                        </Button>
                      </Link>
                      <Link to={createPageUrl(`TeamPayments?id=${event.id}`)}>
                        <Button variant="outline" size="sm" className="border-gray-700 text-gray-300 hover:bg-gray-700">
                          <Users className="w-4 h-4" />
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Desktop View - Table */}
        <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-800 hover:bg-gray-800/30">
                <TableHead className="text-gray-400">תאריך</TableHead>
                <TableHead className="text-gray-400">זוג</TableHead>
                <TableHead className="text-gray-400">סכום ברוטו</TableHead>
                <TableHead className="text-gray-400">רווח נקי</TableHead>
                <TableHead className="text-gray-400">סטטוס תשלום</TableHead>
                <TableHead className="text-gray-400">סטטוס התקדמות</TableHead>
                <TableHead className="text-gray-400">אלבום</TableHead>
                <TableHead className="text-gray-400">יומן</TableHead>
                <TableHead className="text-gray-400">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12">
                    <div className="text-gray-500">
                      <Heart className="w-12 h-12 mx-auto mb-4 text-gray-600" />
                      <p className="text-lg font-medium">אין אירועים עדיין</p>
                      <p className="text-sm">צור את האירוע הראשון שלך כדי להתחיל</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                events.map((event) => {
                  const clientPaymentStatus = event.clientPaymentStatus || "Unpaid";
                  return (
                    <TableRow 
                      key={event.id} 
                      className="border-gray-800 hover:bg-gray-800/30 transition-colors duration-200"
                    >
                      <TableCell className="text-gray-300">
                        {format(new Date(event.date), "d/M/yyyy")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="font-medium text-white">{event.coupleNames}</div>
                          {event.phoneNumber && (
                            <a
                              href={`https://wa.me/${(() => {
                                const cleaned = event.phoneNumber.replace(/[-\s()]/g, '');
                                return cleaned.startsWith('0') ? '972' + cleaned.substring(1) : cleaned;
                              })()}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-green-500 hover:text-green-400 transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MessageCircle className="w-4 h-4" />
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold text-yellow-400">
                          ₪{event.totalAmountGross?.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`font-semibold ${
                          calcProfit(event, staffMembers) >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          ₪{Math.round(calcProfit(event, staffMembers)).toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <PaymentStatusSelector
                          eventId={event.id}
                          currentStatus={clientPaymentStatus}
                          onStatusChange={onRefresh}
                        />
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const progressStatus = getEventProgressStatus(event);
                          return (
                            <Badge 
                              variant="outline"
                              className={`${progressStatus.color} border font-medium`}
                            >
                              {progressStatus.label}
                            </Badge>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            const newStatus = event.albumStatus === 'sent' ? 'pending' : 'sent';
                            try {
                              await base44.entities.Event.update(event.id, { albumStatus: newStatus });
                              if (onRefresh) onRefresh();
                            } catch (error) {
                              console.error("Failed to update album status:", error);
                            }
                          }}
                          className="p-0 h-auto hover:bg-transparent"
                        >
                          <div className="flex items-center gap-1">
                            <Album className={`w-4 h-4 ${event.albumStatus === 'sent' ? 'text-green-400' : 'text-pink-400'}`} />
                            <Badge 
                              variant="outline"
                              className={`${
                                event.albumStatus === 'sent' 
                                  ? 'bg-green-500/20 text-green-400 border-green-500/30' 
                                  : 'bg-pink-500/20 text-pink-400 border-pink-500/30'
                              } border font-medium text-xs cursor-pointer hover:opacity-80 transition-opacity`}
                            >
                              {event.albumStatus === 'sent' ? 'נשלח' : 'לא נשלח'}
                            </Badge>
                          </div>
                        </Button>
                      </TableCell>
                      <TableCell>
                        {event.googleCalendarEventId ? (
                          <div className="flex items-center gap-1">
                            <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                            <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30 border font-medium text-xs">
                              סונכרן
                            </Badge>
                          </div>
                        ) : (
                          <span className="text-gray-500 text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Link to={createPageUrl(`EventDetails?id=${event.id}`)}>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              className="text-gray-400 hover:text-yellow-400 hover:bg-yellow-500/10"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          </Link>
                          <Link to={createPageUrl(`TeamPayments?id=${event.id}`)}>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              className="text-gray-400 hover:text-blue-400 hover:bg-blue-500/10"
                            >
                              <Users className="w-4 h-4" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setInvoiceEvent(event)}
                            className="text-emerald-400 hover:bg-emerald-500/10"
                            title="הפקת חשבונית"
                          >
                            <Receipt className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>

                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      </Card>
      <InvoiceDialog
      isOpen={!!invoiceEvent}
      onClose={() => {
        setInvoiceEvent(null);
        if (onRefresh) onRefresh();
      }}
      coupleNames={invoiceEvent?.coupleNames}
      eventDate={invoiceEvent?.date}
      venueName={invoiceEvent?.venue}
      clientPhone={invoiceEvent?.phoneNumber}
      onInvoiceCreated={(url, amount) => {
        setTimeout(() => {
          if (onRefresh) onRefresh();
        }, 300);
      }}
      />
    </>
  );
}