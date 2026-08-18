import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Users, Search, X, Camera, Video, Scissors, Palette, TrendingUp, Calendar, DollarSign, AlertCircle, Settings as SettingsIcon, Eye, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STAFF_JOB_ROLES } from "@/lib/staffRoles";

// Was previously missing "graphic_designer" entirely (a real staff_members.role value,
// per the DB check constraint) — a graphic designer's card fell through to the
// generic Users-icon fallback below instead of getting a real label/icon/color.
const ROLE_ICONS = { photographer: Camera, videographer: Video, editor: Scissors, graphic_designer: Palette };
const ROLE_COLORS = { photographer: 'text-blue-400', videographer: 'text-purple-400', editor: 'text-green-400', graphic_designer: 'text-pink-400' };
const ROLE_CONFIG = Object.fromEntries(
  STAFF_JOB_ROLES.map(({ value, label }) => [value, { label, icon: ROLE_ICONS[value], color: ROLE_COLORS[value] }])
);

export default function TeamMembers() {
  const [staffMembers, setStaffMembers] = useState([]);
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [isEventsDialogOpen, setIsEventsDialogOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [staffData, eventsData] = await Promise.all([
        base44.entities.StaffMember.list(),
        base44.entities.Event.list("-date")
      ]);
      setStaffMembers(staffData);
      setEvents(eventsData);
    } catch (error) {
      console.error("Error loading data:", error);
    }
    setIsLoading(false);
  };

  const calculateStaffStats = (staffMember) => {
    let totalEvents = 0;
    let totalEventsThisYear = 0;
    let totalEarned = 0;
    let totalPaid = 0;
    let totalRemaining = 0;
    const eventsList = [];
    const currentYear = new Date().getFullYear();

    events.forEach(event => {
      const teamMembers = event.team || [];
      const memberInEvent = teamMembers.find(m => m.staffMemberName === staffMember.name);
      
      if (memberInEvent) {
        totalEvents++;
        const eventYear = new Date(event.date).getFullYear();
        if (eventYear === currentYear) {
          totalEventsThisYear++;
        }
        
        const cost = memberInEvent.cost || 0;
        totalEarned += cost;
        
        if (memberInEvent.isPaid) {
          totalPaid += cost;
        } else {
          totalRemaining += cost;
        }
        
        eventsList.push({
          id: event.id,
          coupleNames: event.coupleNames,
          date: event.date,
          cost: cost,
          isPaid: memberInEvent.isPaid
        });
      }
    });

    return {
      totalEvents,
      totalEventsThisYear,
      totalEarned,
      totalPaid,
      totalRemaining,
      eventsList,
      paidPercentage: totalEarned > 0 ? Math.round((totalPaid / totalEarned) * 100) : 0
    };
  };

  const filteredStaff = staffMembers.filter(staff => {
    if (!searchTerm.trim()) return true;
    return staff.name.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const handleViewEvents = (staff) => {
    setSelectedStaff(staff);
    setIsEventsDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-gray-800 rounded-lg w-64"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array(6).fill(0).map((_, i) => (
                <div key={i} className="h-80 bg-gray-800 rounded-xl"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 flex items-center gap-3">
              <Users className="w-8 h-8 text-yellow-400" />
              אנשי צוות
            </h1>
            <p className="text-gray-400">
              מעקב ומידע על כל אנשי הצוות שלך
            </p>
          </div>
          {/* Editing/adding/removing staff members lives in Settings → team, the single
              source of truth (it also handles per-role pay rates, which this page never
              did) — this page stays a read-only performance/finance dashboard to avoid
              two divergent edit surfaces for the same data. */}
          <Link to={createPageUrl("Settings?tab=team")}>
            <Button variant="outline" className="border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-yellow-400 hover:border-yellow-400 gap-2">
              <SettingsIcon className="w-4 h-4" />
              עריכת/הוספת אנשי צוות בהגדרות
            </Button>
          </Link>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              type="text"
              placeholder="חפש איש צוות..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-gray-900/50 border-gray-700 text-white placeholder-gray-400 focus:border-yellow-400 focus:ring-yellow-400/20"
            />
            {searchTerm && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSearchTerm("")}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Staff Cards Grid */}
        {filteredStaff.length === 0 ? (
          <Card className="bg-gray-900/50 border-gray-800 text-center p-12">
            <Users className="w-16 h-16 mx-auto text-gray-600 mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">אין אנשי צוות</h3>
            <p className="text-gray-400">
              {searchTerm ? 'לא נמצאו תוצאות לחיפוש שלך' : 'הוסף אנשי צוות בעמוד ההגדרות'}
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredStaff.map((staff) => {
              const stats = calculateStaffStats(staff);
              const roleConfig = ROLE_CONFIG[staff.role] || { label: staff.role, icon: Users, color: 'text-gray-400' };
              const RoleIcon = roleConfig.icon;

              return (
                <Card key={staff.id} className="bg-gray-900/50 border-gray-800 backdrop-blur-sm hover:border-yellow-400/50 transition-all duration-300">
                  <CardHeader className="border-b border-gray-800 pb-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center">
                          <RoleIcon className="w-6 h-6 text-gray-900" />
                        </div>
                        <div>
                           <CardTitle className="text-white text-lg">{staff.name}</CardTitle>
                           <p className={`text-sm ${roleConfig.color} flex items-center gap-1`}>
                             {roleConfig.label}
                           </p>
                           {staff.email && (
                             <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                               <Mail className="w-3 h-3" />
                               {staff.email}
                             </p>
                           )}
                           {staff.phoneNumber && (
                             <p className="text-xs text-gray-500 flex items-center gap-1">
                               <Phone className="w-3 h-3" />
                               {staff.phoneNumber}
                             </p>
                           )}
                         </div>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="p-6 space-y-6">
                    {/* Quick Stats */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Calendar className="w-4 h-4 text-gray-400" />
                          <p className="text-xs text-gray-400">אירועים</p>
                        </div>
                        <p className="text-2xl font-bold text-white">{stats.totalEvents}</p>
                        <p className="text-xs text-gray-500 mt-1">השנה: {stats.totalEventsThisYear}</p>
                      </div>
                      <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <TrendingUp className="w-4 h-4 text-gray-400" />
                          <p className="text-xs text-gray-400">סה"כ הכנסות</p>
                        </div>
                        <p className="text-2xl font-bold text-yellow-400">₪{stats.totalEarned.toLocaleString()}</p>
                      </div>
                    </div>

                    {/* Payment Status */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-400">סטטוס תשלומים</span>
                        <span className="text-sm font-semibold text-yellow-400">{stats.paidPercentage}%</span>
                      </div>
                      <Progress value={stats.paidPercentage} className="h-2 bg-gray-800">
                        <div 
                          className="h-full bg-gradient-to-r from-green-400 to-green-500 rounded-full transition-all duration-300"
                          style={{ width: `${stats.paidPercentage}%` }}
                        />
                      </Progress>
                    </div>

                    {/* Financial Breakdown */}
                    <div className="space-y-2 pt-4 border-t border-gray-800">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                          <span className="text-sm text-gray-400">שולם</span>
                        </div>
                        <span className="text-sm font-semibold text-green-400">₪{stats.totalPaid.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-red-400 rounded-full"></div>
                          <span className="text-sm text-gray-400">נשאר לשלם</span>
                        </div>
                        <span className="text-sm font-semibold text-red-400">₪{stats.totalRemaining.toLocaleString()}</span>
                      </div>
                    </div>

                    {/* View All Events Button */}
                    {stats.totalEvents > 0 && (
                      <div className="pt-4 border-t border-gray-800">
                        <Button
                          onClick={() => handleViewEvents(staff)}
                          variant="outline"
                          className="w-full border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-yellow-400 hover:border-yellow-400"
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          צפה בכל האירועים ({stats.totalEvents})
                        </Button>
                      </div>
                    )}

                    {/* No Events Warning */}
                    {stats.totalEvents === 0 && (
                      <div className="pt-4 border-t border-gray-800">
                        <div className="flex items-center gap-2 text-gray-500">
                          <AlertCircle className="w-4 h-4" />
                          <p className="text-xs">לא עבד באירועים עדיין</p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Events Dialog */}
        <Dialog open={isEventsDialogOpen} onOpenChange={setIsEventsDialogOpen}>
          <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl">
                אירועים של {selectedStaff?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 mt-4">
              {selectedStaff && calculateStaffStats(selectedStaff).eventsList.map((event, idx) => (
                <Card key={idx} className="bg-gray-800/50 border-gray-700">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-white font-semibold">{event.coupleNames}</h3>
                          <Badge 
                            variant="outline" 
                            className={`${event.isPaid ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'} text-xs`}
                          >
                            {event.isPaid ? '✓ שולם' : '⏳ ממתין'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-gray-400">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {format(new Date(event.date), "d/M/yyyy")}
                          </div>
                          <div className="flex items-center gap-1">
                            <DollarSign className="w-3 h-3" />
                            ₪{event.cost.toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <Link to={createPageUrl(`EventDetails?id=${event.id}`)}>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-gray-400 hover:text-yellow-400"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}