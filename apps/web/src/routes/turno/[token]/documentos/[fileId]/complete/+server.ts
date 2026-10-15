import { json } from "@sveltejs/kit";
import { informationContext } from "$lib/server/booking-information";
import {
  clinicalFileCacheHeaders,
  clinicalFileError,
  clinicalFileErrorBody,
  verifyStoredClinicalImage,
  isClinicalFileMime,
} from "$lib/server/clinical-files";
import type { RequestHandler } from "./$types";
export const POST: RequestHandler = async (event) => {
  try {
    const { admin, token } = await informationContext(event);
    const { data, error } = await admin.rpc(
      "get_public_patient_document_upload" as never,
      { p_token: token, p_file_id: event.params.fileId } as never,
    );
    if (error) throw error;
    const file = data as any;
    if (file.status === "ready") return json({ ready: true, id: file.id });
    if (!isClinicalFileMime(file.mime_type))
      throw new Error("RADIOGRAPH_FORMAT_INVALID");
    const verified = await verifyStoredClinicalImage({
      admin,
      bucket: file.storage_bucket,
      path: file.storage_path,
      expectedBytes: Number(file.bytes),
      expectedMime: file.mime_type,
    });
    const result = await admin.rpc(
      "complete_public_patient_document_upload" as never,
      {
        p_token: token,
        p_file_id: file.id,
        p_bytes: verified.bytes,
        p_mime: verified.mimeType,
      } as never,
    );
    if (result.error) throw result.error;
    return json({ ready: true, id: file.id });
  } catch (cause) {
    const safe = clinicalFileError(
      cause,
      "No pudimos confirmar el archivo. Tu turno se conserva; podés volver a intentar.",
    );
    return json(clinicalFileErrorBody(safe), { status: safe.status });
  }
};
