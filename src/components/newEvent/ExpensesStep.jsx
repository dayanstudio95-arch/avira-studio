import React, { useState, useEffect } from 'react';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, Video, Scissors, Users, ChevronsUpDown, Video as Video2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const StaffSelector = ({ role, value, staff, onUpdate }) => {
    const [open, setOpen] = useState(false);
    const [searchName, setSearchName] = useState('');

    useEffect(() => {
        if (open) {
            setSearchName(value?.staffMemberName || '');
        }
    }, [open, value?.staffMemberName]);

    const handleSelect = (currentValue) => {
        const selectedStaff = staff.find(s => s.name.toLowerCase() === currentValue.toLowerCase());
        const newName = selectedStaff ? selectedStaff.name : currentValue;
        onUpdate({ staffMemberName: newName, cost: selectedStaff?.defaultRate ?? value?.cost ?? 0 });
        setOpen(false);
    };

    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className="w-[180px] justify-between bg-gray-800/50 border-gray-700 text-white hover:bg-gray-800"
                    >
                        {value?.staffMemberName || `בחר ${role.label}...`}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-0 bg-gray-900 border-gray-700 text-white">
                    <Command>
                        <CommandInput 
                            placeholder={`חפש או הוסף...`} 
                            value={searchName}
                            onValueChange={setSearchName}
                            className="text-white"
                        />
                        <CommandList>
                            <CommandEmpty>
                                <Button variant="ghost" className="w-full" onMouseDown={() => handleSelect(searchName)}>
                                    הוסף: "{searchName}"
                                </Button>
                            </CommandEmpty>
                            <CommandGroup>
                                {staff.map((s) => (
                                    <CommandItem
                                        key={s.id}
                                        value={s.name}
                                        onSelect={handleSelect}
                                    >
                                        {s.name}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
            <Input
                type="number"
                min="0"
                step="50"
                placeholder="סכום (₪)"
                value={value?.cost || ''}
                onChange={(e) => onUpdate({ cost: e.target.value })}
                className="bg-gray-800/50 border-gray-700 text-white placeholder-gray-500 w-32"
            />
            <div className="flex items-center space-x-2 space-x-reverse">
                <Checkbox
                    id={`paid-${role.key}`}
                    checked={value?.isPaid || false}
                    onCheckedChange={(checked) => onUpdate({ isPaid: checked })}
                    className="data-[state=checked]:bg-green-500 border-gray-600"
                />
                <Label htmlFor={`paid-${role.key}`} className="text-sm font-medium text-gray-300">שולם</Label>
            </div>
        </div>
    );
};


export default function ExpensesStep({ eventData, updateTeamMember, staffMembers }) {
  const photographers = staffMembers.filter(s => s.role === 'photographer');
  const videographers = staffMembers.filter(s => s.role === 'videographer');
  const editors = staffMembers.filter(s => s.role === 'editor');
  
  // When editor is auto-added with videographer, set a default rate if no editor is selected yet
  const editorOnTeam = (eventData.team || []).find(m => m.role === 'editor');
  const defaultEditorRate = editors.length > 0 ? (editors[0]?.defaultRate || 0) : 0;
  
  const expenseFields = [
    { key: 'photographer1', label: 'צלם/ת 1', icon: Camera, staff: photographers },
    { key: 'photographer2', label: 'צלם/ת 2', icon: Users, staff: photographers },
    { key: 'videographer', label: 'צלם/ת וידאו 1', icon: Video, staff: videographers },
    { key: 'videographer2', label: 'צלם/ת וידאו 2', icon: Video2, staff: videographers },
    { key: 'editor', label: 'עורך/ת', icon: Scissors, staff: editors }
  ];

  const totalExpenses = (eventData.team || []).reduce((sum, member) => sum + (member.cost || 0), 0);

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <p className="text-gray-400">
          בחר איש צוות והזן את העלות. ניתן להוסיף שם חדש על ידי הקלדה ולחיצה על "הוסף".
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-8">
        {expenseFields.map((field) => (
          <div key={field.key} className="space-y-2">
            <Label className="text-gray-300 font-medium flex items-center gap-2">
              <field.icon className="w-4 h-4 text-yellow-400" />
              {field.label}
            </Label>
            <StaffSelector
                role={field}
                value={(eventData.team || []).find(m => m.role === field.key)}
                staff={field.staff}
                onUpdate={(updates) => updateTeamMember(field.key, updates)}
            />
          </div>
        ))}
      </div>

      <div className="bg-gray-800/30 rounded-xl p-6 border border-gray-700 mt-8">
        <h3 className="text-lg font-semibold text-white mb-4">סך כל ההוצאות</h3>
        <div className="text-3xl font-bold text-red-400">
          ₪{totalExpenses.toLocaleString()}
        </div>
      </div>
    </div>
  );
}