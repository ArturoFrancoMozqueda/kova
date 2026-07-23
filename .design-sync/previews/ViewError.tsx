import { ViewError } from "pos-frontend";

export function LoadFailure() {
  return (
    <div className="max-w-xl p-6">
      <ViewError
        message="No pudimos cargar tus reportes. Revisa tu conexión."
        retryLabel="Reintentar"
        onRetry={() => {}}
      />
    </div>
  );
}
