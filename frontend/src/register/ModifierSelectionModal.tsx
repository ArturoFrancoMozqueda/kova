import { useState } from "react";
import type { ModifierGroup, ModifierOption } from "../catalog/types";
import { copy } from "../i18n/messages";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export type SelectedModifier = {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDelta: string;
};

interface Props {
  productName: string;
  modifierGroups: ModifierGroup[];
  onConfirm: (selected: SelectedModifier[]) => void;
  onCancel: () => void;
}

function isGroupSatisfied(group: ModifierGroup, selections: Map<string, string[]>): boolean {
  if (!group.is_required) return true;
  const selected = selections.get(group.id) ?? [];
  return selected.length >= group.min_selections;
}

export function ModifierSelectionModal({ productName, modifierGroups, onConfirm, onCancel }: Props) {
  const [selections, setSelections] = useState<Map<string, string[]>>(new Map());

  const toggle = (group: ModifierGroup, option: ModifierOption) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const current = next.get(group.id) ?? [];
      if (group.max_selections === 1) {
        next.set(group.id, [option.id]);
      } else {
        if (current.includes(option.id)) {
          next.set(group.id, current.filter((id) => id !== option.id));
        } else if (current.length < group.max_selections) {
          next.set(group.id, [...current, option.id]);
        }
      }
      return next;
    });
  };

  const allRequiredSatisfied = modifierGroups.every((g) => isGroupSatisfied(g, selections));

  const handleConfirm = () => {
    const result: SelectedModifier[] = [];
    for (const group of modifierGroups) {
      const optionIds = selections.get(group.id) ?? [];
      for (const optId of optionIds) {
        const option = group.options.find((o) => o.id === optId);
        if (option) {
          result.push({
            groupId: group.id,
            groupName: group.name,
            optionId: option.id,
            optionName: option.name,
            priceDelta: option.price_delta,
          });
        }
      }
    }
    onConfirm(result);
  };

  return (
    <Dialog open onClose={onCancel} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{copy.modifierModal.title} — {productName}</DialogTitle>
      </DialogHeader>

      <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
        {modifierGroups.map((group) => {
          const groupSelections = selections.get(group.id) ?? [];
          return (
            <div key={group.id}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-semibold">{group.name}</span>
                {group.is_required && (
                  <Badge variant="warning" className="text-[10px]">
                    {copy.modifierModal.required}
                  </Badge>
                )}
              </div>
              <div className="space-y-1.5">
                {group.options.map((option) => {
                  const checked = groupSelections.includes(option.id);
                  const inputType = group.max_selections === 1 ? "radio" : "checkbox";
                  const inputId = `option-${option.id}`;
                  return (
                    <label
                      key={option.id}
                      htmlFor={inputId}
                      className={cn(
                        "relative flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-all cursor-pointer",
                        checked
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-input hover:border-primary/30 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <input
                        id={inputId}
                        type={inputType}
                        name={`group-${group.id}`}
                        checked={checked}
                        onChange={() => toggle(group, option)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer m-0"
                      />
                      <span
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all shrink-0",
                          checked ? "border-primary bg-primary text-white" : "border-input",
                        )}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <span className="flex-1 text-left font-medium">{option.name}</span>
                      {parseFloat(option.price_delta) > 0 && (
                        <span className="text-xs text-muted-foreground">
                          +MX${parseFloat(option.price_delta).toFixed(2)}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {copy.modifierModal.cancel}
        </Button>
        <Button disabled={!allRequiredSatisfied} onClick={handleConfirm}>
          {copy.modifierModal.addToCart}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
