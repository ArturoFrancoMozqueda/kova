/** Matches the backend's format-aware hash without using file metadata. */
export async function catalogImportFingerprint(file: File): Promise<string> {
  const content = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("No se pudo leer el archivo."));
    reader.readAsArrayBuffer(file);
  });
  const prefix = file.name.toLowerCase().endsWith(".xlsx") ? new TextEncoder().encode("xlsx\0") : new Uint8Array();
  const bytes = new Uint8Array(prefix.length + content.byteLength);
  bytes.set(prefix);
  bytes.set(new Uint8Array(content), prefix.length);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
