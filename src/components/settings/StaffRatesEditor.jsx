import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, Plus } from 'lucide-react';
import { EVENT_TEAM_ROLES } from '@/lib/staffRoles';

const AVAILABLE_ROLES = EVENT_TEAM_ROLES;

export default function StaffRatesEditor({ staff, onChange }) {
  const [ratesByRole, setRatesByRole] = useState(staff?.ratesByRole || []);

  const handleRateChange = (index, rate) => {
    const updated = [...ratesByRole];
    updated[index].rate = parseFloat(rate) || 0;
    setRatesByRole(updated);
    onChange({ ...staff, ratesByRole: updated });
  };

  const handleRemoveRole = (index) => {
    const updated = ratesByRole.filter((_, i) => i !== index);
    setRatesByRole(updated);
    onChange({ ...staff, ratesByRole: updated });
  };

  const handleAddRole = (role) => {
    if (!ratesByRole.find(r => r.role === role)) {
      const updated = [...ratesByRole, { role, rate: 0 }];
      setRatesByRole(updated);
      onChange({ ...staff, ratesByRole: updated });
    }
  };

  const availableRolesToAdd = AVAILABLE_ROLES.filter(
    r => !ratesByRole.find(rate => rate.role === r.value)
  );

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-gray-300 font-medium mb-3 block">תעריפים לפי תפקיד</Label>
        
        {ratesByRole.length === 0 ? (
          <p className="text-gray-500 text-sm mb-3">לא הוגדרו תעריפים עדיין</p>
        ) : (
          <div className="space-y-2 mb-4">
            {ratesByRole.map((rate, idx) => {
              const roleLabel = AVAILABLE_ROLES.find(r => r.value === rate.role)?.label;
              return (
                <div key={idx} className="flex items-center gap-2 bg-gray-800/30 p-2 rounded-lg">
                  <span className="text-gray-400 text-sm min-w-24">{roleLabel}</span>
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      type="number"
                      value={rate.rate}
                      onChange={(e) => handleRateChange(idx, e.target.value)}
                      className="bg-gray-800 border-gray-700 text-white flex-1"
                      placeholder="0"
                    />
                    <span className="text-gray-400">₪</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveRole(idx)}
                    className="text-red-400 hover:text-red-500 hover:bg-red-900/20"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {availableRolesToAdd.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {availableRolesToAdd.map(role => (
              <Button
                key={role.value}
                size="sm"
                variant="outline"
                onClick={() => handleAddRole(role.value)}
                className="border-gray-700 text-gray-400 hover:bg-yellow-400/10 hover:text-yellow-400 hover:border-yellow-400"
              >
                <Plus className="w-4 h-4 mr-1" />
                הוסף {role.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}