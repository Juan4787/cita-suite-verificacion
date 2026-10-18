import { logServerFailure } from '$lib/server/platform/logging';
import {
  ClinicalFileHttpError,
  clinicalFileCacheHeaders,
  clinicalFileErrorBody,
  clinicalFileError,
  getClinicalFileRequestContext,
  isClinicalFileMime,
  requireClinicalFileUpload,
  verifyStoredClinicalImage,
  verifyStoredClinicalThumbnail,
  readClinicalJson,
} from "$lib/server/patients/public/clinical-files";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  event.setHeaders(clinicalFileCacheHeaders);
  let context: Awaited<
    ReturnType<typeof getClinicalFileRequestContext>
  > | null = null;

  try {
    context = await getClinicalFileRequestContext(event);
    requireClinicalFileUpload(context);
    const body = await readClinicalJson(event.request);

    const { data, error } = await context.supabase
      .from("patient_radiographs")
      .select(
        "id, status, storage_bucket, storage_path, thumbnail_path, bytes, mime_type, uploaded_by",
      )
      .eq("business_id", context.businessId)
      .eq("patient_id", event.params.id)
      .eq("id", event.params.radiographId)
      .eq("storage_provider", "supabase_storage")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("RADIOGRAPH_NOT_FOUND");
    if (data.uploaded_by !== context.userId)
      throw new Error("RADIOGRAPH_UPLOAD_OWNER_REQUIRED");
    if (data.status === "ready") return json({ id: data.id, ready: true });
    if (data.status !== "uploading")
      throw new Error("RADIOGRAPH_STATE_INVALID");
    if (
      !data.storage_bucket ||
      !data.storage_path ||
      !Number.isSafeInteger(Number(data.bytes)) ||
      !isClinicalFileMime(data.mime_type)
    ) {
      throw new Error("RADIOGRAPH_OBJECT_MISMATCH");
    }

    const verified = await verifyStoredClinicalImage({
      admin: context.admin,
      bucket: data.storage_bucket,
      path: data.storage_path,
      expectedBytes: Number(data.bytes),
      expectedMime: data.mime_type,
    });
    const thumbnailUploaded =
      body.thumbnailUploaded === true && data.thumbnail_path
        ? await verifyStoredClinicalThumbnail({
            admin: context.admin,
            bucket: data.storage_bucket,
            path: data.thumbnail_path,
          })
        : false;

    const completed = await context.admin.rpc(
      "complete_patient_radiograph_upload",
      {
        p_actor_id: context.userId,
        p_business_id: context.businessId,
        p_patient_id: event.params.id,
        p_radiograph_id: event.params.radiographId,
        p_actual_bytes: verified.bytes,
        p_actual_mime_type: verified.mimeType,
        p_thumbnail_uploaded: thumbnailUploaded,
      },
    );
    if (completed.error) throw completed.error;

    return json({
      id: event.params.radiographId,
      ready: true,
      thumbnail_ready: thumbnailUploaded,
    });
  } catch (error) {
    const safe = clinicalFileError(
      error,
      "No pudimos confirmar la carga. Probá de nuevo.",
    );
    if (
      context &&
      error instanceof ClinicalFileHttpError &&
      (error.status === 400 || error.status === 409)
    ) {
      try {
        await context.admin.rpc(
          "fail_patient_radiograph_upload",
          {
            p_actor_id: context.userId,
            p_business_id: context.businessId,
            p_patient_id: event.params.id,
            p_radiograph_id: event.params.radiographId,
            p_failure_code: "object_validation_failed",
          },
        );
      } catch {
        // La validación fallida sigue siendo la respuesta principal.
      }
    }
    logServerFailure("Error confirmando imagen clínica", error);
    return json(clinicalFileErrorBody(safe), { status: safe.status });
  }
};
