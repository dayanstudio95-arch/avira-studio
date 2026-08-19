import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
const Event = base44.entities.Event;
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { WalletCards, Check, User, Calendar, Coins, CalendarDays } from 'lucide-react';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VAT_RATE } from "@/lib/financialCalculations";

export default function Payments() {
    const [events, setEvents] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [updatingPayment, setUpdatingPayment] = useState(null);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth().toString());
    const [selectedPayments, setSelectedPayments] = useState({});

    const loadData = async () => {
        setIsLoading(true);
        const allEvents = await Event.list('-date');
        setEvents(allEvents);
        setIsLoading(false);
    };

    useEffect(() => {
        loadData();
    }, []);

    const paymentsOwed = useMemo(() => {
        const owed = {};
        const filteredEvents = events.filter(event => {
            const eventDate = new Date(event.date);
            const eventYear = eventDate.getFullYear();
            const eventMonth = eventDate.getMonth();
            
            const yearMatch = eventYear === selectedYear;
            const monthMatch = selectedMonth === "all" || eventMonth === parseInt(selectedMonth);
            
            return yearMatch && monthMatch;
        });
        
        filteredEvents.forEach(event => {
            if (!event.team || event.team.length === 0) return;

            event.team.forEach((member, index) => {
                if (!member.isPaid && member.cost > 0) {
                    if (!owed[member.staffMemberName]) {
                        owed[member.staffMemberName] = { total: 0, events: [] };
                    }
                    owed[member.staffMemberName].total += member.cost;
                    owed[member.staffMemberName].events.push({
                        ...member,
                        eventId: event.id,
                        coupleNames: event.coupleNames,
                        date: event.date,
                        memberIndexInEvent: index
                    });
                }
            });
        });
        return owed;
    }, [events, selectedYear, selectedMonth]);

    const handleMarkAsPaid = async (eventId, memberIndexInEvent) => {
        setUpdatingPayment(`${eventId}-${memberIndexInEvent}`);
        try {
            const eventToUpdate = events.find(e => e.id === eventId);
            if (eventToUpdate && eventToUpdate.team && eventToUpdate.team[memberIndexInEvent]) {
                const newTeam = [...eventToUpdate.team];
                newTeam[memberIndexInEvent] = { ...newTeam[memberIndexInEvent], isPaid: true };
                await Event.update(eventId, { team: newTeam });
                await loadData();
            }
        } catch (error) {
            console.error("Error updating payment:", error);
        } finally {
            setUpdatingPayment(null);
        }
    };
    
    const handleMarkAllAsPaid = async (staffName) => {
        setUpdatingPayment(staffName);
        try {
            const staffPaymentDetails = paymentsOwed[staffName];
            if (!staffPaymentDetails || staffPaymentDetails.events.length === 0) return;

            const eventUpdates = new Map();
            staffPaymentDetails.events.forEach(payment => {
                if (!eventUpdates.has(payment.eventId)) {
                    eventUpdates.set(payment.eventId, []);
                }
                eventUpdates.get(payment.eventId).push(payment.memberIndexInEvent);
            });

            const eventIdsToUpdate = Array.from(eventUpdates.keys());
            const eventsToModify = events.filter(e => eventIdsToUpdate.includes(e.id));

            const updatePromises = eventsToModify.map(event => {
                const indicesToUpdate = eventUpdates.get(event.id);
                if (!indicesToUpdate) return null;

                const newTeam = [...event.team];
                indicesToUpdate.forEach(index => {
                    if (newTeam[index]) {
                        newTeam[index].isPaid = true;
                    }
                });
                return Event.update(event.id, { team: newTeam });
            }).filter(Boolean);

            await Promise.all(updatePromises);
            await loadData();
            setSelectedPayments({});
        } catch (error) {
            console.error("Error updating all payments for staff:", error);
        } finally {
            setUpdatingPayment(null);
        }
    };

    const handleMarkSelectedAsPaid = async (staffName) => {
        setUpdatingPayment(`selected-${staffName}`);
        try {
            const selected = selectedPayments[staffName] || [];
            if (selected.length === 0) return;

            const eventUpdates = new Map();
            selected.forEach(paymentKey => {
                // eventId is a uuid and already contains hyphens, so the key uses
                // '::' as a separator (chosen because it can't appear inside a uuid)
                // and the index is always the last segment.
                const sepIndex = paymentKey.lastIndexOf('::');
                const eventId = paymentKey.slice(0, sepIndex);
                const memberIndex = paymentKey.slice(sepIndex + 2);
                if (!eventUpdates.has(eventId)) {
                    eventUpdates.set(eventId, []);
                }
                eventUpdates.get(eventId).push(parseInt(memberIndex));
            });

            const eventIdsToUpdate = Array.from(eventUpdates.keys());
            const eventsToModify = events.filter(e => eventIdsToUpdate.includes(e.id));

            const updatePromises = eventsToModify.map(event => {
                const indicesToUpdate = eventUpdates.get(event.id);
                if (!indicesToUpdate) return null;

                const newTeam = [...event.team];
                indicesToUpdate.forEach(index => {
                    if (newTeam[index]) {
                        newTeam[index].isPaid = true;
                    }
                });
                return Event.update(event.id, { team: newTeam });
            }).filter(Boolean);

            await Promise.all(updatePromises);
            await loadData();
            setSelectedPayments(prev => ({ ...prev, [staffName]: [] }));
        } catch (error) {
            console.error("Error updating selected payments:", error);
        } finally {
            setUpdatingPayment(null);
        }
    };

    const togglePaymentSelection = (staffName, paymentKey) => {
        setSelectedPayments(prev => {
            const currentSelected = prev[staffName] || [];
            const isSelected = currentSelected.includes(paymentKey);
            return {
                ...prev,
                [staffName]: isSelected 
                    ? currentSelected.filter(k => k !== paymentKey)
                    : [...currentSelected, paymentKey]
            };
        });
    };

    const isPaymentSelected = (staffName, paymentKey) => {
        return (selectedPayments[staffName] || []).includes(paymentKey);
    };
    
    const totalOwedAmount = Object.values(paymentsOwed).reduce((sum, staff) => sum + staff.total, 0);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-950 p-4 md:p-8">
                <div className="max-w-6xl mx-auto">
                    <Skeleton className="h-12 w-1/3 mb-4" />
                    <Skeleton className="h-20 w-full mb-8" />
                    <div className="space-y-4">
                        <Skeleton className="h-16 w-full" />
                        <Skeleton className="h-16 w-full" />
                        <Skeleton className="h-16 w-full" />
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-950 p-4 md:p-8">
            <div className="max-w-6xl mx-auto">
                <div className="mb-8">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div>
                            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 flex items-center gap-3">
                                <WalletCards className="w-8 h-8 text-yellow-400" />
                                תשלומים לצוות
                            </h1>
                            <p className="text-gray-400">
                                מעקב אחר תשלומים שטרם הועברו לאנשי הצוות
                            </p>
                        </div>
                        <div className="flex items-center gap-2 w-full md:w-auto">
                            <CalendarDays className="w-5 h-5 text-gray-400 flex-shrink-0" />
                            <Select value={selectedYear.toString()} onValueChange={(val) => setSelectedYear(parseInt(val))}>
                                <SelectTrigger className="flex-1 md:w-32 bg-gray-900/50 border-gray-700 text-white">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-gray-900 border-gray-700 text-white">
                                    <SelectItem value="2025">2025</SelectItem>
                                    <SelectItem value="2026">2026</SelectItem>
                                    <SelectItem value="2027">2027</SelectItem>
                                    <SelectItem value="2028">2028</SelectItem>
                                    <SelectItem value="2029">2029</SelectItem>
                                    <SelectItem value="2030">2030</SelectItem>
                                </SelectContent>
                            </Select>
                            
                            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                                <SelectTrigger className="flex-1 md:w-32 bg-gray-900/50 border-gray-700 text-white">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-gray-900 border-gray-700 text-white">
                                    <SelectItem value="all">כל החודשים</SelectItem>
                                    <SelectItem value="0">ינואר</SelectItem>
                                    <SelectItem value="1">פברואר</SelectItem>
                                    <SelectItem value="2">מרץ</SelectItem>
                                    <SelectItem value="3">אפריל</SelectItem>
                                    <SelectItem value="4">מאי</SelectItem>
                                    <SelectItem value="5">יוני</SelectItem>
                                    <SelectItem value="6">יולי</SelectItem>
                                    <SelectItem value="7">אוגוסט</SelectItem>
                                    <SelectItem value="8">ספטמבר</SelectItem>
                                    <SelectItem value="9">אוקטובר</SelectItem>
                                    <SelectItem value="10">נובמבר</SelectItem>
                                    <SelectItem value="11">דצמבר</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>
                
                <Card className="bg-gray-900/50 border-yellow-400/20 mb-8">
                    <CardContent className="p-4 md:p-6">
                        <p className="text-gray-400 text-base md:text-lg">סך הכל חובות לצוות</p>
                        <p className="text-2xl md:text-4xl font-bold text-red-400">
                           ₪{totalOwedAmount.toLocaleString()}
                        </p>
                    </CardContent>
                </Card>

                <Accordion type="multiple" className="w-full space-y-4">
                    {Object.keys(paymentsOwed).length > 0 ? Object.entries(paymentsOwed).map(([name, data]) => (
                        <Card key={name} className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
                            <AccordionItem value={name} className="border-b-0">
                                <AccordionTrigger className="p-3 md:p-6 text-white hover:no-underline">
                                    <div className="flex flex-col gap-2 w-full">
                                        {/* Row 1: name + badge */}
                                        <div className="flex items-center gap-2">
                                            <User className="w-5 h-5 text-yellow-400 flex-shrink-0"/>
                                            <span className="text-base md:text-xl font-semibold">{name}</span>
                                            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{data.events.length} אירועים</span>
                                        </div>
                                        {/* Row 2: amount + buttons */}
                                        <div className="flex flex-wrap items-center gap-2">
                                            <div className="text-right flex-1 min-w-0">
                                                <p className="text-gray-400 text-xs">סה״כ לתשלום</p>
                                                <p className="text-base font-bold text-red-400">
                                                    ₪{data.total.toLocaleString()}
                                                    <span className="text-xs font-normal text-gray-500 mr-1 hidden sm:inline">(כולל מע"מ: ₪{Math.round(data.total * VAT_RATE).toLocaleString()})</span>
                                                </p>
                                                <p className="text-xs font-normal text-gray-500 sm:hidden">כולל מע"מ: ₪{Math.round(data.total * VAT_RATE).toLocaleString()}</p>
                                            </div>
                                            {(selectedPayments[name] || []).length > 0 && (
                                               <Button
                                                   size="sm"
                                                   onClick={(e) => {
                                                       e.stopPropagation();
                                                       handleMarkSelectedAsPaid(name);
                                                   }}
                                                   disabled={updatingPayment === `selected-${name}`}
                                                   className="bg-blue-500 hover:bg-blue-600 text-white text-xs px-2"
                                               >
                                                   <Check className="w-3 h-3 ml-1"/>
                                                   {updatingPayment === `selected-${name}` ? 'מעדכן...' : `שולם (${(selectedPayments[name] || []).length})`}
                                               </Button>
                                            )}
                                            <Button
                                               size="sm"
                                               onClick={(e) => {
                                                   e.stopPropagation();
                                                   handleMarkAllAsPaid(name);
                                               }}
                                               disabled={updatingPayment === name}
                                               className="bg-green-500 hover:bg-green-600 text-white text-xs px-2"
                                           >
                                               <Check className="w-3 h-3 ml-1"/>
                                               {updatingPayment === name ? 'מעדכן...' : 'שולם הכל'}
                                           </Button>
                                        </div>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="px-3 md:px-6 pb-4 md:pb-6">
                                    <div className="space-y-2 border-t border-gray-800 pt-3">
                                        {data.events.map((event, index) => {
                                            const paymentKey = `${event.eventId}::${event.memberIndexInEvent}`;
                                            return (
                                                <div key={index} className="flex justify-between items-center p-2 md:p-3 rounded-lg bg-gray-800/50 gap-2">
                                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                                        <Checkbox
                                                            checked={isPaymentSelected(name, paymentKey)}
                                                            onCheckedChange={() => togglePaymentSelection(name, paymentKey)}
                                                            className="border-gray-600 flex-shrink-0"
                                                        />
                                                        <div className="flex flex-col gap-0.5 min-w-0">
                                                           <div className="flex items-center gap-1.5">
                                                                <Calendar className="w-3 h-3 text-gray-500 flex-shrink-0" />
                                                                <span className="text-gray-300 text-xs">{format(new Date(event.date), 'd/M/yy')}</span>
                                                                <Coins className="w-3 h-3 text-yellow-500 flex-shrink-0 mr-1" />
                                                                <span className="text-yellow-400 text-xs font-semibold">₪{event.cost.toLocaleString()}</span>
                                                            </div>
                                                             <div className="flex items-center gap-1.5">
                                                                <span className="text-gray-300 text-sm font-medium truncate">{event.coupleNames}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <Button 
                                                        size="sm"
                                                        onClick={() => handleMarkAsPaid(event.eventId, event.memberIndexInEvent)}
                                                        disabled={updatingPayment === `${event.eventId}-${event.memberIndexInEvent}`}
                                                        className="bg-green-500 hover:bg-green-600 text-white text-xs px-2 flex-shrink-0"
                                                    >
                                                        <Check className="w-3 h-3 ml-1"/>
                                                        {updatingPayment === `${event.eventId}-${event.memberIndexInEvent}` ? 'מעדכן...' : 'שולם'}
                                                    </Button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        </Card>
                    )) : (
                         <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm text-center p-12">
                            <Check className="w-16 h-16 mx-auto text-green-500 mb-4" />
                            <h3 className="text-xl font-bold text-white">הכל שולם!</h3>
                            <p className="text-gray-400">אין תשלומים פתוחים לאנשי הצוות.</p>
                        </Card>
                    )}
                </Accordion>

            </div>
        </div>
    );
}