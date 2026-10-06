import type { CfdiConnection } from "./cfdiApi";

/** Production readiness also requires a matching issuer and a certificate still valid now. */
export function liveCfdiReady(
  connection: CfdiConnection | undefined,
  storageAvailable: boolean,
  issuerRfc?: string,
): boolean {
  const expires = connection?.certificate_expires_at
    ? Date.parse(connection.certificate_expires_at)
    : Number.NaN;
  return Boolean(
    storageAvailable &&
      connection?.connected &&
      connection.environment === "live" &&
      connection.production_ready &&
      issuerRfc &&
      connection.issuer_rfc &&
      issuerRfc.toUpperCase() === connection.issuer_rfc.toUpperCase() &&
      Number.isFinite(expires) &&
      expires > Date.now(),
  );
}
