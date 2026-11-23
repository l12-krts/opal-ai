import { api } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { loadState } from "@/server/code/store";
import { sweepSettled } from "@/server/code/settle";

export const dynamic = "force-dynamic";

export const GET = api(
  async ({ user }) => {
    void sweepSettled(user.id);
    return loadState(user.id);
  },
  { limit: LIMITS.read },
);
