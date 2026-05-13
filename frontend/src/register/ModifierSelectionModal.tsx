import { useState } from "react";
import type { ModifierGroup, ModifierOption } from "../catalog/types";
import { copy } from "../i18n/messages";

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
  // groupId → list of selected optionIds
  const [selections, setSelections] = useState<Map<string, string[]>>(new Map());

  const toggle = (group: ModifierGroup, option: ModifierOption) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const current = next.get(group.id) ?? [];
      if (group.max_selections === 1) {
        // radio: replace
        next.set(group.id, [option.id]);
      } else {
        // checkbox: toggle
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
    <div className="modal">
      <h2>{copy.modifierModal.title} — {productName}</h2>
      {modifierGroups.map((group) => {
        const groupSelections = selections.get(group.id) ?? [];
        return (
          <fieldset key={group.id} style={{ marginBottom: "1.25rem" }}>
            <legend>
              {group.name}
              {group.is_required && (
                <span className="status-warn" style={{ marginLeft: "0.5rem", fontSize: "0.8rem" }}>
                  {copy.modifierModal.required}
                </span>
              )}
            </legend>
            {group.options.map((option) => {
              const checked = groupSelections.includes(option.id);
              const inputType = group.max_selections === 1 ? "radio" : "checkbox";
              return (
                <label key={option.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.25rem" }}>
                  <input
                    type={inputType}
                    name={`group-${group.id}`}
                    checked={checked}
                    onChange={() => toggle(group, option)}
                  />
                  <span>{option.name}</span>
                  {parseFloat(option.price_delta) > 0 && (
                    <span className="muted" style={{ marginLeft: "auto" }}>
                      +MX${parseFloat(option.price_delta).toFixed(2)}
                    </span>
                  )}
                </label>
              );
            })}
          </fieldset>
        );
      })}
      <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end", marginTop: "1.5rem" }}>
        <button type="button" onClick={onCancel}>
          {copy.modifierModal.cancel}
        </button>
        <button type="button" disabled={!allRequiredSatisfied} onClick={handleConfirm}>
          {copy.modifierModal.addToCart}
        </button>
      </div>
    </div>
  );
}
