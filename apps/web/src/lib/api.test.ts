import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApiClient, parseLeaderboardEntries } from "./api";

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));

describe("createApiClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets withCredentials to true so cookies are sent on cross-origin requests", () => {
    const client = createApiClient();
    expect(client.defaults.withCredentials).toBe(true);
  });

  it("sets withCredentials to true even when a bearer token is provided", () => {
    const client = createApiClient("test-token");
    expect(client.defaults.withCredentials).toBe(true);
  });

  it("includes the Authorization header when a token is provided", () => {
    const client = createApiClient("my-jwt");
    expect(client.defaults.headers.Authorization).toBe("Bearer my-jwt");
  });

  it("does not include an Authorization header when no token is provided", () => {
    const client = createApiClient();
    expect(client.defaults.headers.Authorization).toBeUndefined();
  });

  it("attaches a 401 response interceptor for authenticated clients", () => {
    const client = createApiClient("token");
    const interceptors = client.interceptors.response as unknown as {
      handlers: Array<{ fulfilled: unknown; rejected: unknown }>;
    };
    expect(interceptors.handlers.length).toBe(1);
  });

  it("does not attach a response interceptor for unauthenticated clients", () => {
    const client = createApiClient();
    const interceptors = client.interceptors.response as unknown as {
      handlers: Array<{ fulfilled: unknown; rejected: unknown }>;
    };
    expect(interceptors.handlers.length).toBe(0);
  });
});

describe("parseLeaderboardEntries", () => {
  it("parses a valid leaderboard entry array", () => {
    const data = [
      {
        rank: 1,
        userId: "user-1",
        username: "alice",
        displayName: "Alice",
        league: "gold",
        avatarUrl: "https://example.com/avatar.png",
        totalScore: 1500,
        totalEarned: "100.00",
        endedAt: null,
      },
      {
        rank: 2,
        username: "bob",
        avatarUrl: null,
        totalScore: 1200,
        endedAt: "2026-05-30T00:00:00Z",
      },
    ];

    const result = parseLeaderboardEntries(data);
    expect(result).toHaveLength(2);
    expect(result[0].rank).toBe(1);
    expect(result[0].league).toBe("gold");
    expect(result[1].username).toBe("bob");
    expect(result[1].league).toBeUndefined();
  });

  it("throws on invalid data", () => {
    const data = [{ rank: "not-a-number", username: 123 }];
    expect(() => parseLeaderboardEntries(data)).toThrow();
  });
});
