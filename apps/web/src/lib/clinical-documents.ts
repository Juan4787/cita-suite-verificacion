export const CLINICAL_DOCUMENT_MAX_BYTES = 5_000_000;
export const CLINICAL_DOCUMENT_MIMES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
] as const;
export type ClinicalDocumentMime = (typeof CLINICAL_DOCUMENT_MIMES)[number];
export const hasPdfHeader = (bytes: Uint8Array) =>
  /^%PDF-(?:1\.[0-7]|2\.0)(?:[\r\n\t ]|$)/.test(
    new TextDecoder("ascii").decode(bytes.slice(0, 16)),
  );
export const hasPdfEof = (bytes: Uint8Array) =>
  /(?:^|[\r\n])%%EOF[\t\r\n ]*$/.test(new TextDecoder("ascii").decode(bytes));
export const clinicalDownloadName = (
  name: string,
  date: string,
  title: string,
  mime: string,
) => {
  const safe = (value: string) =>
    value
      .normalize("NFC")
      .replace(/[^\p{L}\p{N}_-]+/gu, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 70);
  return `${safe(name) || "Paciente"}_${safe(date) || "documento"}_${safe(title) || "estudio"}.${mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg"}`;
};
