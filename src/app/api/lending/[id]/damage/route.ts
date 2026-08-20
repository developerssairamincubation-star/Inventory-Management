import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { fromError, ok } from "@/lib/api/response";
import { applyWriteOff } from "@/lib/lendingWriteOff";
import { actorFrom } from "@/lib/stock";
import { parseBody, parseUuidParam, positiveQuantity, uuid } from "@/lib/validation";
import { requestIdFrom } from "@/lib/logger";

// The shared implementation (and the reasoning behind each fix) lives in
// src/lib/lendingWriteOff.ts — this route is the HTTP shell around it.
const schema = z.object({
  product_id: uuid,
  damaged_quantity: positiveQuantity,
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const { user, scope } = auth;

  try {
    const { id: rawId } = await params;
    const orderId = parseUuidParam(rawId);
    const body = await parseBody(request, schema);

    const result = await applyWriteOff({
      scope,
      actor: actorFrom(user, requestIdFrom(request)),
      orderId,
      productId: body.product_id,
      quantity: body.damaged_quantity,
      kind: "damaged",
    });

    return ok(result);
  } catch (error) {
    return fromError(error, {
      requestId: requestIdFrom(request),
      userId: user.user_id,
      route: "POST /api/lending/[id]/damage",
    });
  }
}
