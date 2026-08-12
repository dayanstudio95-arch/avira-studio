import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Heart, Calendar, CheckCircle2, AlertCircle } from "lucide-react";
import { format } from "date-fns";

const STATUS_CONFIG = {
  pending: { label: 'ממתין', icon: AlertCircle, color: 'text-red-400', bgColor: 'bg-red-500/20' },
  sent: { label: 'נשלח', icon: CheckCircle2, color: 'text-green-400', bgColor: 'bg-green-500/20' }
};

const ROLE_LABELS = {
  photographer1: 'צלם 1',
  photographer2: 'צלם 2',
  videographer: 'וידאו 1',
  videographer2: 'וידאו 2',
  editor: 'עורך'
};

export default function ClientCard({ event }) {
  const team = event.team || [];
  const totalSteps = team.length;
  const completedSteps = team.filter(m => m.progressStatus === 'sent').length;
  const progressPercentage = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return (
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
      <CardHeader className="border-b border-gray-800">
        <CardTitle className="text-white flex items-center gap-2">
          <Heart className="w-5 h-5 text-yellow-400" />
          כרטיסית לקוח
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        {/* Client Info */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Heart className="w-5 h-5 text-gray-400" />
            <div>
              <p className="text-sm text-gray-400">שם הזוג</p>
              <p className="text-white font-medium text-lg">{event.coupleNames}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-gray-400" />
            <div>
              <p className="text-sm text-gray-400">תאריך האירוע</p>
              <p className="text-white font-medium">{format(new Date(event.date), "d/M/yyyy")}</p>
            </div>
          </div>
        </div>

        {/* Progress Status */}
        <div className="pt-4 border-t border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-300">סטטוס התקדמות</h3>
            <span className="text-sm font-bold text-yellow-400">{progressPercentage}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 mb-4">
            <div 
              className="bg-gradient-to-r from-yellow-400 to-yellow-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>

        {/* Timeline */}
        <div className="pt-4 border-t border-gray-800">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">ציר זמן התקדמות</h3>
          <div className="space-y-3">
            {team.map((member, index) => {
              const statusConfig = STATUS_CONFIG[member.progressStatus || 'pending'];
              const StatusIcon = statusConfig.icon;
              const isLast = index === team.length - 1;
              
              return (
                <div key={index} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full ${statusConfig.bgColor} flex items-center justify-center`}>
                      <StatusIcon className={`w-4 h-4 ${statusConfig.color}`} />
                    </div>
                    {!isLast && (
                      <div className={`w-0.5 h-8 ${member.progressStatus === 'sent' ? 'bg-green-500/30' : 'bg-gray-700'}`} />
                    )}
                  </div>
                  <div className="flex-1 pb-4">
                    <p className="text-white font-medium">{ROLE_LABELS[member.role] || member.role}</p>
                    <p className="text-sm text-gray-400">{member.staffMemberName || 'לא הוגדר'}</p>
                    <Badge 
                      variant="outline" 
                      className={`mt-1 ${statusConfig.bgColor} ${statusConfig.color} border-none text-xs`}
                    >
                      {statusConfig.label}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Albums (Bonus) */}
        {event.albums && event.albums.length > 0 && (
          <div className="pt-4 border-t border-gray-800">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">אלבומים (בונוס)</h3>
            <div className="space-y-2">
              {event.albums.map((album, index) => (
                <div key={index} className="flex items-center justify-between p-2 bg-gray-800/50 rounded-lg">
                  <span className="text-white text-sm">{album.name}</span>
                  <Badge 
                    variant="outline"
                    className={`text-xs ${
                      album.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                      album.status === 'in_progress' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    {album.status === 'completed' ? 'הושלם' : album.status === 'in_progress' ? 'בתהליך' : 'ממתין'}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}