// Upload one composer attachment (multipart field "file"). Returns a link the message can use.
import { api, ApiError } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { ATTACHMENT_LIMITS, saveUpload } from "@/server/attachments";

export const POST = api(
  async ({ req, user }) => {
    if (Number(req.headers.get("content-length") ?? 0) > ATTACHMENT_LIMITS.maxBytes + 64 * 1024) {
      throw new ApiError(413, "too_large", "Files can be up to 20 MB");
    }
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob)) throw new ApiError(400, "no_file", "Attach a file");
    const name = file instanceof File ? file.name : "file";
    return { attachment: await saveUpload(user.id, file, name) };
  },
  { limit: LIMITS.attachments, limitKey: "attach" },
);
