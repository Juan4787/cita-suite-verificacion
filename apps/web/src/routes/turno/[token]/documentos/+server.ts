import { isUuid } from '@cita-suite/shared/uuid';
import { json } from "@sveltejs/kit";
import { informationContext } from "$lib/server/patients/public/booking-information";
import {
  clinicalFileCacheHeaders,
  clinicalFileError,
  clinicalFileErrorBody,
  createClinicalFileUploadUrls,
  CLINICAL_FILE_MAX_BYTES,
  isClinicalFileMime,
  normalizeClinicalFilename,
  normalizeClinicalNote,
  readClinicalJson,
} from "$lib/server/patients/public/clinical-files";
import { enforceRateLimits } from "$lib/server/platform/rate-limits";
import type { RequestHandler } from "./$types";
export const POST: RequestHandler = async (event) => {
  try {
    const { admin, token } = await informationContext(event);
    const body = await readClinicalJson(event.request);
    await enforceRateLimits(
      [
        {
          action: "radiograph_upload_by_user",
          subject: "patient-ip:" + event.getClientAddress(),
          limit: 20,
          windowSeconds: 3600,
          message: "Se iniciaron muchas cargas desde tu conexión.",
        },
        {
          action: "radiograph_upload_by_user",
          subject: "patient-ip:" + event.getClientAddress(),
          limit: 100,
          windowSeconds: 86400,
          message: "Se alcanzó el límite diario de cargas desde tu conexión.",
        },
      ],
      event.fetch,
    );
    const filename = normalizeClinicalFilename(body.filename);
    const note = normalizeClinicalNote(body.note);
    const bytes = Number(body.bytes);
    if (
      !filename ||
      note === undefined ||
      !isClinicalFileMime(body.mime) ||
      !Number.isSafeInteger(bytes) ||
      bytes < 1 ||
      bytes > CLINICAL_FILE_MAX_BYTES ||
      typeof body.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.sha256) ||
      typeof body.requestId !== 'string' || !isUuid(body.requestId)
    )
      throw new Error("RADIOGRAPH_UPLOAD_INVALID");
    const { data, error } = await admin.rpc(
      "begin_public_patient_document_upload",
      {
        p_token: token,
        p_request_id: body.requestId,
        p_filename: filename,
        p_mime: body.mime,
        p_bytes: bytes,
        p_sha256: body.sha256,
        p_note: note,
      },
    );
    if (error) throw error;
    const file = data;
    if (!file) throw new Error("RADIOGRAPH_NOT_FOUND");
    if (file.status === "ready")
      return json({ id: file.id, already_complete: true });
    if (file.status !== "uploading") throw new Error("RADIOGRAPH_UPLOAD_EXPIRED");
    if (!file.storage_bucket || !file.storage_path) throw new Error("RADIOGRAPH_UPLOAD_INVALID");
    const existing = await admin.storage
      .from(file.storage_bucket)
      .info(file.storage_path);
    if (!existing.error && existing.data)
      return json({ id: file.id, object_present: true });
    const urls = await createClinicalFileUploadUrls(admin, {
      original: file.storage_path,
      thumbnail: null,
    });
    return json({ id: file.id, upload_url: urls.originalUrl });
  } catch (cause) {
    const safe = clinicalFileError(
      cause,
      "No pudimos preparar el archivo. Revisá el enlace de tu turno y probá nuevamente.",
    );
    return json(clinicalFileErrorBody(safe), { status: safe.status });
  }
};
