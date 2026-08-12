import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Users, Banknote, CheckCircle2, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function TeamPaymentsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [payments, setPayments] = useState(new Map());

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    setIsLoading(true);
    try {
      const eventsList = await base44.entities.Event.list();
      setEvents(eventsList);
    } catch (error) {
      console.error("Error loading events:", error);
    }
    setIsLoading(false);
  };

  // חישוב תשלומים לפי חודש וצלם
  const getPaymentsByMonth = () => {
    const [year, month] = selectedMonth.split("-");
    const monthStart = new Date(parseInt(year), parseInt(month) - 1, 1);
    const monthEnd = new Date(parseInt(year), parseInt(month), 0);

    const staffPayments = new Map();

    events.forEach((event) => {
      const eventDate = new Date(event.date);
      if (eventDate >= monthStart && eventDate <= monthEnd) {
        (event.team || []).forEach((member) => {
          if (member.staffMemberName && member.cost) {
            const key = member.staffMemberName;
            if (!staffPayments.has(key)) {
              staffPayments.set(key, { name: member.staffMemberName, totalAmount: 0, isPaid: false, events: [] });
            }
            const current = staffPayments.get(key);
            current.totalAmount += member.cost;
            current.events.push({
              coupleNames: event.coupleNames,
              date: event.date,
              amount: member.cost,
              isPaid: member.isPaid,
            });
          }
        });
      }
    });

    return Array.from(staffPayments.values());
  };

  const handleTogglePaid = async (staffName) => {
    const paymentKey = `${staffName}-${selectedMonth}`;
    const newPaidStatus = !payments.get(paymentKey);
    const newPayments = new Map(payments);
    newPayments.set(paymentKey, newPaidStatus);
    setPayments(newPayments);
  };

  const staffPaymentsList = getPaymentsByMonth();
  const totalPayable = staffPaymentsList.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalPaid = staffPaymentsList
    .filter((s) => payments.get(`${s.name}-${selectedMonth}`))
    .reduce((sum, s) => sum + s.totalAmount, 0);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-12 bg-gray-800 rounded-lg w-64"></div>
            <div className="h-96 bg-gray-800 rounded-xl"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate(createPageUrl("Dashboard"))}
            className="border-gray-700 text-gray-300 hover:bg-gray-800"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-2">
              <Users className="w-8 h-8 text-yellow-400" />
              תשלומים לצוות
            </h1>
            <p className="text-gray-400">עקוב אחרי תשלומים לצלמים וצוות ההפקה</p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card className="bg-gray-900/50 border-gray-800">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">סה"כ לתשלום</p>
                  <p className="text-3xl font-bold text-yellow-400 mt-2">
                    ₪{totalPayable.toLocaleString()}
                  </p>
                </div>
                <Banknote className="w-12 h-12 text-yellow-400/20" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-900/50 border-gray-800">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">שולם</p>
                  <p className="text-3xl font-bold text-green-400 mt-2">
                    ₪{totalPaid.toLocaleString()}
                  </p>
                </div>
                <CheckCircle2 className="w-12 h-12 text-green-400/20" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-900/50 border-gray-800">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">חוב עדיין</p>
                  <p className="text-3xl font-bold text-red-400 mt-2">
                    ₪{(totalPayable - totalPaid).toLocaleString()}
                  </p>
                </div>
                <Clock className="w-12 h-12 text-red-400/20" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Month Selection */}
        <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm mb-8">
          <CardContent className="p-6">
            <label className="text-sm text-gray-400 mb-2 block">בחר חודש</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white rounded-md p-2 focus:border-yellow-400 focus:outline-none"
            />
          </CardContent>
        </Card>

        {/* Payments Table */}
        <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
          <CardHeader className="border-b border-gray-800">
            <CardTitle className="text-white">תשלומים לחודש זה</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {staffPaymentsList.length === 0 ? (
              <p className="text-gray-400 text-center py-8">אין תשלומים לחודש זה</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-700 hover:bg-transparent">
                      <TableHead className="text-gray-400 text-right">שם</TableHead>
                      <TableHead className="text-gray-400 text-right">סה"כ לתשלום</TableHead>
                      <TableHead className="text-gray-400 text-center">מספר אירועים</TableHead>
                      <TableHead className="text-gray-400 text-center">סטטוס</TableHead>
                      <TableHead className="text-gray-400 text-center">פעולה</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {staffPaymentsList.map((staff) => {
                      const isPaid = payments.get(`${staff.name}-${selectedMonth}`);
                      return (
                        <TableRow key={staff.name} className="border-gray-700 hover:bg-gray-800/50">
                          <TableCell className="text-white font-medium">{staff.name}</TableCell>
                          <TableCell className="text-yellow-400 font-semibold">
                            ₪{staff.totalAmount.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge className="bg-gray-700 text-gray-300">
                              {staff.events.length} אירועים
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              className={`text-xs font-medium ${
                                isPaid
                                  ? "bg-green-500/20 text-green-400 border-green-500/30"
                                  : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                              } border`}
                            >
                              {isPaid ? "✅ שולם" : "⏳ בהמתנה"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              size="sm"
                              variant={isPaid ? "default" : "outline"}
                              onClick={() => handleTogglePaid(staff.name)}
                              className={`text-xs ${
                                isPaid
                                  ? "bg-green-500/20 text-green-400 hover:bg-green-500/30 border-green-500/30"
                                  : "border-gray-700 text-gray-300 hover:bg-gray-800"
                              }`}
                            >
                              {isPaid ? "ביטול" : "סמן כשולם"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}