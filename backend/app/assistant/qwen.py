"""Fixed non-thinking Qwen profile and fail-closed metering verification."""

from decimal import ROUND_CEILING, Decimal, InvalidOperation

MODEL = "@cf/qwen/qwen3.8-27b"
PROFILE = "qwen3.8-grounded-no-thinking-v1"
PLANNING_TOKENS = 256
PASSAGE_TOKENS = 128
ANSWER_TOKENS = 384


def verified_charge(receipt, usage, *, complete=False):
    """Return conservative actual neurons only for the exact completed profile.

    Public per-million prices: input .45, cached input .05, output 3.20 USD;
    1,000 neurons cost .011 USD. Check the independent token and neuron meters.
    Missing, new, partial or contradictory telemetry keeps the entire reservation.
    """
    if (complete is not True or receipt.get("model") != MODEL
            or receipt.get("usage_profile") != PROFILE or not isinstance(usage, dict)
            or set(usage) - {"prompt_tokens", "completion_tokens", "total_tokens", "neurons",
                             "prompt_tokens_details", "completion_tokens_details"}):
        return None
    counts = [usage.get(k) for k in ("prompt_tokens", "completion_tokens", "total_tokens")]
    if (not all(type(v) is int and v >= 0 for v in counts) or counts[0] <= 0
            or counts[2] != counts[0] + counts[1]
            or counts[0] > receipt["input_tokens"] or counts[1] > receipt["output_tokens"]):
        return None
    details = usage.get("prompt_tokens_details", {})
    output_details = usage.get("completion_tokens_details", {})
    if (not isinstance(details, dict) or set(details) - {"cached_tokens"}
            or not isinstance(output_details, dict)
            or set(output_details) - {"reasoning_tokens"}
            or type(output_details.get("reasoning_tokens", 0)) is not int
            or output_details.get("reasoning_tokens", 0) != 0):
        return None
    cached = details.get("cached_tokens", 0)
    neurons = usage.get("neurons")
    if (type(cached) is not int or not 0 <= cached <= counts[0]
            or type(neurons) not in (int, float) or neurons <= 0):
        return None
    try:
        metered = Decimal(str(neurons))
        if not metered.is_finite():
            return None
        expected = ((Decimal("0.45") * (counts[0] - cached) + Decimal("0.05") * cached
                     + Decimal("3.20") * counts[1]) / Decimal(1_000_000)
                    * Decimal(1000) / Decimal("0.011"))
        if abs(metered - expected) > Decimal("0.02"):
            return None
        charged = int((max(expected, metered) * Decimal("1.15")).to_integral_value(
            rounding=ROUND_CEILING))
        return charged if 0 < charged <= receipt["amount"] else None
    except (InvalidOperation, ValueError, OverflowError):
        return None
