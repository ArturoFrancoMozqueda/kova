import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CircleDollarSign } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { copy } from "@/i18n/messages";
import { listMissingRecipeCosts, type MissingRecipeCost } from "./api";

/** Ingredients without cost used by recipes in force, each with a direct path to fix it. */
export function RecipeCostReview() {
  const [rows, setRows] = useState<MissingRecipeCost[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    listMissingRecipeCosts().then(
      (data) => { if (alive) setRows(data); },
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; };
  }, []);

  return (
    <Card className="mb-6" data-testid="recipe-cost-review">
      <CardContent className="space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <CircleDollarSign className="h-5 w-5 text-kova-blue" aria-hidden="true" />
          {copy.recipeCostReview.title}
        </h2>
        {failed ? (
          <p className="text-sm text-destructive" role="alert">{copy.recipeCostReview.loadError}</p>
        ) : rows === null ? (
          <p className="text-sm text-muted-foreground" role="status">{copy.recipeCostReview.loading}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.recipeCostReview.empty}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{copy.recipeCostReview.body}</p>
            <ul className="divide-y rounded-lg border">
              {rows.map((row) => (
                <li key={row.ingredient_product_id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span className="min-w-0">
                    <span className="block font-medium break-words">{row.ingredient_name}</span>
                    <span className="block text-xs text-muted-foreground break-words">{copy.recipeCostReview.usedIn(row.used_in)}</span>
                  </span>
                  <Link className="inline-flex min-h-11 items-center text-sm font-medium text-kova-blue underline-offset-2 hover:underline" to={`/catalog?edit=${encodeURIComponent(row.ingredient_product_id)}`}>
                    {copy.recipeCostReview.complete}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
