import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChallenge } from "./use-challenge";

const getMock = vi.fn();

vi.mock("@/lib/api", () => ({
  createApiClient: () => ({ get: getMock }),
}));

describe("useChallenge", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("returns challenge data on success", async () => {
    getMock.mockResolvedValue({
      data: { challenge: { id: "c1" }, questions: [{ id: "q1" }] },
    });

    const { result } = renderHook(() => useChallenge("c1", "token"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.challenge).toEqual({ id: "c1" });
    expect(result.current.questions).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("surfaces message and code from a 400 server error", async () => {
    getMock.mockRejectedValue({
      response: {
        status: 400,
        data: { error: { message: "Challenge has ended", code: "CHALLENGE_ENDED" } },
      },
    });

    const { result } = renderHook(() => useChallenge("c1", "token"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error?.message).toBe("Challenge has ended");
    expect(result.current.error?.code).toBe("CHALLENGE_ENDED");
    expect(result.current.challenge).toBeNull();
  });

  it("surfaces message from a 404 server error without a code", async () => {
    getMock.mockRejectedValue({
      response: {
        status: 404,
        data: { error: { message: "Challenge not found" } },
      },
    });

    const { result } = renderHook(() => useChallenge("c1", "token"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error?.message).toBe("Challenge not found");
    expect(result.current.error?.code).toBeUndefined();
  });

  it("falls back to generic message on a 503 with no error body", async () => {
    getMock.mockRejectedValue({
      response: { status: 503, data: {} },
    });

    const { result } = renderHook(() => useChallenge("c1", "token"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error?.message).toBe("Failed to load challenge");
    expect(result.current.error?.code).toBeUndefined();
  });

  it("returns 'Couldn’t reach the server' when there is no response (network down)", async () => {
    getMock.mockRejectedValue({ message: "Network Error" });

    const { result } = renderHook(() => useChallenge("c1", "token"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error?.message).toBe("Couldn't reach the server");
    expect(result.current.error?.code).toBeUndefined();
  });
});
