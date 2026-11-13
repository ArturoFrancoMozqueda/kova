import { resolveApiErrorMessage } from "@/lib/apiError";
export class BookingError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function publicBookingRequest<T>(
  path: string,
  body?: unknown,
  key?: string,
  signal?: AbortSignal,
): Promise<T> {
  try {
    const response = await fetch(`/api/v1/public/bookings${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new BookingError(
        resolveApiErrorMessage(
          { status: response.status },
          typeof payload?.detail === "string"
            ? payload.detail
            : "No pudimos confirmar la reserva. Vuelve a consultar antes de enviarla otra vez.",
        ),
        response.status,
      );
    }
    return (await response.json()) as T;
  } catch (failure) {
    if (failure instanceof BookingError || signal?.aborted) throw failure;
    throw new BookingError(
      "No pudimos conectar con la agenda. Tus datos siguen aquí; vuelve a consultar antes de enviar otra reserva.",
      0,
    );
  }
}
