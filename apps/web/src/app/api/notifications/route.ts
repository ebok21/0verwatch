import { NextRequest } from "next/server";
import { z } from "zod";
import { NotificationRecordSchema } from "@overwatch/shared";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveRequestOrDevUser } from "@/lib/auth/session";
import { errorResponse, jsonResponse, optionsResponse } from "@/lib/http";

const AckNotificationsSchema = z.object({
  notificationIds: z.array(z.string().min(1)).min(1),
});

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  try {
    const user = await resolveRequestOrDevUser(req);
    const pendingOnly =
      req.nextUrl.searchParams.get("pendingOnly") === "true";

    const db = getAdminDb();
    let query = db
      .collection("notifications")
      .where("userId", "==", user.userId);
    if (pendingOnly) {
      query = query.where("acknowledged", "==", false);
    }

    const snap = await query.get();
    const sorted = snap.docs
      .map((d) => NotificationRecordSchema.safeParse(d.data()))
      .filter((r) => r.success)
      .map((r) => r.data)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    // Cap to at most 3 notifications per market (and 6 overall)
    const countByMarket = new Map<string, number>();
    const notifications = sorted.filter((n) => {
      const c = countByMarket.get(n.marketId) ?? 0;
      if (c >= 3) return false;
      countByMarket.set(n.marketId, c + 1);
      return true;
    }).slice(0, 6);

    return jsonResponse({ notifications });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await resolveRequestOrDevUser(req);
    const body = AckNotificationsSchema.parse(await req.json());
    const db = getAdminDb();

    const batch = db.batch();
    for (const id of body.notificationIds) {
      const ref = db.collection("notifications").doc(id);
      const snap = await ref.get();
      if (snap.exists && snap.data()?.userId === user.userId) {
        batch.update(ref, {
          acknowledged: true,
          acknowledgedAt: new Date().toISOString(),
        });
      }
    }
    await batch.commit();

    return jsonResponse({ acknowledgedCount: body.notificationIds.length });
  } catch (err) {
    return errorResponse(err);
  }
}

