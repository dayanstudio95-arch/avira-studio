import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { isAdmin, isAlbumManagerRole } from "@/lib/permissions";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { BookImage, Plus, Edit, Trash2, Layers, Frame, Sparkles, Palette, Type } from "lucide-react";

// Catalog management for the Wedding Albums module (album_products / album_covers /
// album_addons) -- see CLAUDE.md's "Wedding Albums module" section. No seed data is
// shipped on purpose: the studio fills in real prices here. Every row saved from this
// page is later snapshotted (name + price) into album_order_selections/
// album_order_addons at the moment a couple selects it, so editing a price here never
// retroactively changes an existing order's total.

const CATALOGS = {
  products: {
    entity: "AlbumProduct",
    queryKey: ["albumProducts"],
    label: "מוצרים",
    singular: "מוצר",
    icon: Layers,
    emptyFields: { name: "", description: "", basePrice: 0, albumCount: 1, active: true, sortOrder: 0 },
  },
  covers: {
    entity: "AlbumCover",
    queryKey: ["albumCovers"],
    label: "כריכות",
    singular: "כריכה",
    icon: Frame,
    emptyFields: {
      name: "",
      description: "",
      coverType: "other",
      previewImageUrl: "",
      priceDelta: 0,
      active: true,
      sortOrder: 0,
    },
  },
  addons: {
    entity: "AlbumAddon",
    queryKey: ["albumAddons"],
    label: "תוספות",
    singular: "תוספת",
    icon: Sparkles,
    emptyFields: {
      name: "",
      description: "",
      category: "other",
      previewImageUrl: "",
      allowsMultipleImages: false,
      requiresUpload: false,
      price: 0,
      active: true,
      sortOrder: 0,
    },
  },
  engravingColors: {
    entity: "AlbumEngravingColor",
    queryKey: ["albumEngravingColors"],
    label: "צבעי הטבעה",
    singular: "צבע הטבעה",
    icon: Palette,
    emptyFields: { name: "", description: "", hexColor: "#FFFFFF", previewImageUrl: "", active: true, sortOrder: 0 },
  },
  engravingFonts: {
    entity: "AlbumEngravingFont",
    queryKey: ["albumEngravingFonts"],
    label: "פונטים להטבעה",
    singular: "פונט הטבעה",
    icon: Type,
    emptyFields: {
      name: "",
      description: "",
      cssFontFamily: "",
      previewImageUrl: "",
      previewImageDeboss: "",
      previewImageColor: "",
      active: true,
      sortOrder: 0,
    },
  },
};

const COVER_TYPE_LABELS = {
  denim: "ג'ינס",
  linen: "פשתן",
  faux_leather: "עור סינטטי",
  other: "אחר",
};

const ADDON_CATEGORY_LABELS = {
  glass: "זכוכית",
  canvas: "קנבס",
  mini_album: "מיני אלבום",
  parent_album: "אלבום הורים",
  extra_pages: "עמודים נוספים",
  other: "אחר",
};

function CatalogTab({ catalogKey, canManage }) {
  const config = CATALOGS[catalogKey];
  const Entity = base44.entities[config.entity];
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState(config.emptyFields);

  const { data: items = [], isLoading } = useQuery({
    queryKey: config.queryKey,
    queryFn: () => Entity.list("sortOrder"),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: config.queryKey });

  const createMutation = useMutation({
    mutationFn: (data) => Entity.create(data),
    onSuccess: () => {
      invalidate();
      handleCloseDialog();
      toast.success(`${config.singular} נוסף בהצלחה`);
    },
    onError: (err) => toast.error(err.message || "שגיאה בשמירה"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => Entity.update(id, data),
    onSuccess: () => {
      invalidate();
      handleCloseDialog();
      toast.success(`${config.singular} עודכן בהצלחה`);
    },
    onError: (err) => toast.error(err.message || "שגיאה בעדכון"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => Entity.delete(id),
    onSuccess: () => {
      invalidate();
      toast.success(`${config.singular} נמחק`);
    },
    onError: (err) => toast.error(err.message || "שגיאה במחיקה"),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }) => Entity.update(id, { active }),
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message || "שגיאה בעדכון"),
  });

  const handleOpenDialog = (item = null) => {
    setEditingItem(item);
    setFormData(item ? { ...config.emptyFields, ...item } : config.emptyFields);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingItem(null);
    setFormData(config.emptyFields);
  };

  const handleSubmit = () => {
    if (!formData.name?.trim()) {
      toast.error("יש להזין שם");
      return;
    }
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id) => {
    if (confirm(`האם למחוק ${config.singular} זה? הזמנות קיימות ששייכות אליו לא ייפגעו (הנתונים שלהן שמורים בנפרד).`)) {
      deleteMutation.mutate(id);
    }
  };

  const priceLabel = (item) => {
    if (catalogKey === "products") return `₪${Number(item.basePrice || 0).toLocaleString()}`;
    if (catalogKey === "covers") return `${item.priceDelta > 0 ? "+" : ""}₪${Number(item.priceDelta || 0).toLocaleString()}`;
    if (catalogKey === "addons") return `₪${Number(item.price || 0).toLocaleString()}`;
    return null;
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3 mt-4">
        {Array(3).fill(0).map((_, i) => (
          <div key={i} className="h-20 bg-gray-800 rounded-xl"></div>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => handleOpenDialog()} className="bg-yellow-400 text-gray-900 hover:bg-yellow-500">
            <Plus className="w-4 h-4 mr-2" />
            {config.singular} חדש
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <Card className="bg-gray-900/50 border-gray-800 text-center p-10">
          <config.icon className="w-12 h-12 mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400">אין עדיין {config.label} בקטלוג</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((item) => (
            <Card key={item.id} className={`bg-gray-900/50 border-gray-800 ${!item.active ? "opacity-50" : ""}`}>
              <CardContent className="p-4 flex items-start justify-between gap-3">
                <div className="min-w-0 flex items-start gap-3">
                  {(catalogKey === "covers" || catalogKey === "addons" || catalogKey === "engravingColors" || catalogKey === "engravingFonts") && item.previewImageUrl ? (
                    <img src={item.previewImageUrl} alt={item.name} className="w-12 h-12 rounded-lg object-cover shrink-0 border border-gray-700" />
                  ) : catalogKey === "engravingColors" && item.hexColor ? (
                    <div className="w-12 h-12 rounded-lg shrink-0 border border-gray-700" style={{ backgroundColor: item.hexColor }} />
                  ) : null}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-semibold truncate">{item.name}</span>
                      {!item.active && <Badge variant="outline" className="border-gray-700 bg-gray-800 text-gray-500 text-xs">מוסתר</Badge>}
                      {catalogKey === "covers" && item.coverType && (
                        <Badge variant="outline" className="border-gray-700 bg-gray-800 text-gray-400 text-xs">{COVER_TYPE_LABELS[item.coverType] || item.coverType}</Badge>
                      )}
                      {catalogKey === "addons" && item.category && (
                        <Badge variant="outline" className="border-gray-700 bg-gray-800 text-gray-400 text-xs">{ADDON_CATEGORY_LABELS[item.category] || item.category}</Badge>
                      )}
                    </div>
                    {item.description && <p className="text-gray-400 text-sm mt-1">{item.description}</p>}
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      {priceLabel(item) && <span className="text-yellow-400 font-bold">{priceLabel(item)}</span>}
                      {catalogKey === "products" && item.albumCount ? (
                        <span className="text-gray-500 text-xs">{item.albumCount} אלבומים</span>
                      ) : null}
                      {catalogKey === "addons" && item.requiresUpload ? (
                        <span className="text-gray-500 text-xs">דורש העלאת תמונה{item.allowsMultipleImages ? " (כמה תמונות)" : ""}</span>
                      ) : null}
                      {catalogKey === "engravingFonts" && item.cssFontFamily ? (
                        <span className="text-gray-500 text-xs" style={{ fontFamily: item.cssFontFamily }}>{item.cssFontFamily}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
                {canManage && (
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(item)} className="text-gray-400 hover:text-yellow-400 hover:bg-yellow-500/10">
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)} className="text-gray-400 hover:text-red-400 hover:bg-red-500/10">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <Switch
                      checked={!!item.active}
                      onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: item.id, active: checked })}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="bg-gray-900 border-gray-800 text-white">
          <DialogHeader>
            <DialogTitle>{editingItem ? `עריכת ${config.singular}` : `${config.singular} חדש`}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-400 mb-2 block">שם</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="bg-gray-800 border-gray-700 text-white"
              />
            </div>

            {catalogKey === "products" && (
              <>
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">תיאור</label>
                  <Textarea
                    value={formData.description || ""}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="bg-gray-800 border-gray-700 text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">מחיר בסיס (₪)</label>
                    <Input
                      type="number"
                      value={formData.basePrice}
                      onChange={(e) => setFormData({ ...formData, basePrice: Number(e.target.value) })}
                      className="bg-gray-800 border-gray-700 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">מספר אלבומים</label>
                    <Input
                      type="number"
                      min="1"
                      value={formData.albumCount}
                      onChange={(e) => setFormData({ ...formData, albumCount: Number(e.target.value) })}
                      className="bg-gray-800 border-gray-700 text-white"
                    />
                  </div>
                </div>
              </>
            )}

            {catalogKey === "covers" && (
              <>
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">תיאור</label>
                  <Textarea
                    value={formData.description || ""}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="bg-gray-800 border-gray-700 text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">סוג כריכה</label>
                    <Select
                      value={formData.coverType || "other"}
                      onValueChange={(v) => setFormData({ ...formData, coverType: v })}
                    >
                      <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(COVER_TYPE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">תוספת מחיר (₪, אפשר 0 או שלילי)</label>
                    <Input
                      type="number"
                      value={formData.priceDelta}
                      onChange={(e) => setFormData({ ...formData, priceDelta: Number(e.target.value) })}
                      className="bg-gray-800 border-gray-700 text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">קישור לתמונת תצוגה מקדימה</label>
                  <Input
                    value={formData.previewImageUrl || ""}
                    onChange={(e) => setFormData({ ...formData, previewImageUrl: e.target.value })}
                    className="bg-gray-800 border-gray-700 text-white"
                    dir="ltr"
                  />
                </div>
              </>
            )}

            {catalogKey === "addons" && (
              <>
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">תיאור</label>
                  <Textarea
                    value={formData.description || ""}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="bg-gray-800 border-gray-700 text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">קטגוריה</label>
                    <Select
                      value={formData.category || "other"}
                      onValueChange={(v) => setFormData({ ...formData, category: v })}
                    >
                      <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ADDON_CATEGORY_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">מחיר (₪)</label>
                    <Input
                      type="number"
                      value={formData.price}
                      onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                      className="bg-gray-800 border-gray-700 text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">קישור לתמונת תצוגה מקדימה</label>
                  <Input
                    value={formData.previewImageUrl || ""}
                    onChange={(e) => setFormData({ ...formData, previewImageUrl: e.target.value })}
                    className="bg-gray-800 border-gray-700 text-white"
                    dir="ltr"
                  />
                </div>
                <div className="flex items-center justify-between bg-gray-800/50 p-3 rounded-lg">
                  <span className="text-sm text-gray-300">מאפשר העלאת כמה תמונות</span>
                  <Switch
                    checked={!!formData.allowsMultipleImages}
                    onCheckedChange={(checked) => setFormData({ ...formData, allowsMultipleImages: checked })}
                  />
                </div>
                <div className="flex items-center justify-between bg-gray-800/50 p-3 rounded-lg">
                  <span className="text-sm text-gray-300">דורש העלאת תמונה מהזוג</span>
                  <Switch
                    checked={!!formData.requiresUpload}
                    onCheckedChange={(checked) => setFormData({ ...formData, requiresUpload: checked })}
                  />
                </div>
              </>
            )}

            {catalogKey === "engravingColors" && (
              <>
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">תיאור</label>
                  <Textarea
                    value={formData.description || ""}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="bg-gray-800 border-gray-700 text-white"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">צבע (hex)</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={/^#[0-9A-Fa-f]{6}$/.test(formData.hexColor) ? formData.hexColor : "#ffffff"}
                      onChange={(e) => setFormData({ ...formData, hexColor: e.target.value })}
                      className="w-10 h-10 rounded border border-gray-700 bg-gray-800 cursor-pointer"
                    />
                    <Input
                      value={formData.hexColor || ""}
                      onChange={(e) => setFormData({ ...formData, hexColor: e.target.value })}
                      className="bg-gray-800 border-gray-700 text-white"
                      dir="ltr"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">קישור לתמונת תצוגה מקדימה</label>
                  <Input
                    value={formData.previewImageUrl || ""}
                    onChange={(e) => setFormData({ ...formData, previewImageUrl: e.target.value })}
                    className="bg-gray-800 border-gray-700 text-white"
                    dir="ltr"
                  />
                </div>
              </>
            )}

            {catalogKey === "engravingFonts" && (
              <>
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">תיאור</label>
                  <Textarea
                    value={formData.description || ""}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="bg-gray-800 border-gray-700 text-white"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">CSS font-family (ריק = ללא טקסט, לדוגמה סמלים)</label>
                  <Input
                    value={formData.cssFontFamily || ""}
                    onChange={(e) => setFormData({ ...formData, cssFontFamily: e.target.value })}
                    className="bg-gray-800 border-gray-700 text-white"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">תמונת תצוגה מקדימה</label>
                  <Input
                    value={formData.previewImageUrl || ""}
                    onChange={(e) => setFormData({ ...formData, previewImageUrl: e.target.value })}
                    className="bg-gray-800 border-gray-700 text-white"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">תמונת תצוגה מקדימה — הבלטה (Deboss)</label>
                  <Input
                    value={formData.previewImageDeboss || ""}
                    onChange={(e) => setFormData({ ...formData, previewImageDeboss: e.target.value })}
                    className="bg-gray-800 border-gray-700 text-white"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">תמונת תצוגה מקדימה — צבע</label>
                  <Input
                    value={formData.previewImageColor || ""}
                    onChange={(e) => setFormData({ ...formData, previewImageColor: e.target.value })}
                    className="bg-gray-800 border-gray-700 text-white"
                    dir="ltr"
                  />
                </div>
              </>
            )}

            <div>
              <label className="text-sm text-gray-400 mb-2 block">סדר תצוגה</label>
              <Input
                type="number"
                value={formData.sortOrder}
                onChange={(e) => setFormData({ ...formData, sortOrder: Number(e.target.value) })}
                className="bg-gray-800 border-gray-700 text-white"
              />
            </div>

            <div className="flex items-center justify-between bg-gray-800/50 p-3 rounded-lg">
              <span className="text-sm text-gray-300">פעיל (מוצג לזוגות)</span>
              <Switch
                checked={!!formData.active}
                onCheckedChange={(checked) => setFormData({ ...formData, active: checked })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog} className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700">
              ביטול
            </Button>
            <Button onClick={handleSubmit} className="bg-yellow-400 text-gray-900 hover:bg-yellow-500">
              {editingItem ? "עדכן" : "צור"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AlbumCatalogSettings() {
  const { user } = useAuth();
  const canManage = isAdmin(user) || isAlbumManagerRole(user);

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8" dir="rtl">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 flex items-center gap-3">
            <BookImage className="w-8 h-8 text-yellow-400" />
            קטלוג אלבומים
          </h1>
          <p className="text-gray-400">ניהול מוצרים, כריכות ותוספות שהזוגות בוחרים מהם באשף הרכישה</p>
        </div>

        <Tabs defaultValue="products" dir="rtl">
          <TabsList className="bg-gray-900 border border-gray-800 flex-wrap h-auto">
            <TabsTrigger value="products">מוצרים</TabsTrigger>
            <TabsTrigger value="covers">כריכות</TabsTrigger>
            <TabsTrigger value="addons">תוספות</TabsTrigger>
            <TabsTrigger value="engravingColors">צבעי הטבעה</TabsTrigger>
            <TabsTrigger value="engravingFonts">פונטים להטבעה</TabsTrigger>
          </TabsList>
          <TabsContent value="products">
            <CatalogTab catalogKey="products" canManage={canManage} />
          </TabsContent>
          <TabsContent value="covers">
            <CatalogTab catalogKey="covers" canManage={canManage} />
          </TabsContent>
          <TabsContent value="addons">
            <CatalogTab catalogKey="addons" canManage={canManage} />
          </TabsContent>
          <TabsContent value="engravingColors">
            <CatalogTab catalogKey="engravingColors" canManage={canManage} />
          </TabsContent>
          <TabsContent value="engravingFonts">
            <CatalogTab catalogKey="engravingFonts" canManage={canManage} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
