import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

/**
 * POST /api/revalidate/leaderboard
 * On-demand ISR revalidation for the leaderboard page.
 * Triggered by the API when new scores are committed.
 *
 * Requires REVALIDATE_SECRET in request body for security.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { secret } = body;

    const expectedSecret = process.env.REVALIDATE_SECRET;

    if (!expectedSecret) {
      return NextResponse.json(
        { error: "Server misconfigured: REVALIDATE_SECRET not set" },
        { status: 500 }
      );
    }

    if (!secret || secret !== expectedSecret) {
      return NextResponse.json(
        { error: "Unauthorized: invalid or missing secret" },
        { status: 401 }
      );
    }

    revalidatePath("/leaderboard");

    return NextResponse.json({
      revalidated: true,
      path: "/leaderboard",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
