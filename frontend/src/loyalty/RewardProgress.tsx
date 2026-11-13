import { Meter } from "@/components/visual";
import type { Reward } from "./rewards/api";

const points = (value: number) => new Intl.NumberFormat("es-MX").format(value);

/** Progress toward the business's saved reward; only when one is active. */
export function RewardProgress({ reward, balance, size = "md" }: { reward: Reward | null; balance: number; size?: "sm" | "md" }) {
  if (!reward?.enabled || reward.points_cost <= 0) return null;
  const reached = balance >= reward.points_cost;
  return (
    <Meter
      label={`Avance para ${reward.title}`}
      value={Math.max(0, balance)}
      max={reward.points_cost}
      valueLabel={reached ? `${points(reward.points_cost)} de ${points(reward.points_cost)} puntos · disponible` : `${points(Math.max(0, balance))} de ${points(reward.points_cost)} puntos`}
      tone={reached ? "growth" : "blue"}
      size={size}
      showLabel
    />
  );
}
