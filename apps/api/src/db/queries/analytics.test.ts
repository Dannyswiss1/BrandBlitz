import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the query function
const mockQuery = vi.fn();
vi.mock("../../db/index", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Import after mocking
import { getBrandAnalytics } from "./analytics";

describe("getBrandAnalytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zero stats when brand has no challenges", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // No challenges

    const result = await getBrandAnalytics("brand-1");

    expect(result).toEqual({
      totalSessions: 0,
      completedSessions: 0,
      completionRate: 0,
      questionAccuracy: [],
      costPerSession: [],
    });
  });

  it("calculates completion rate correctly", async () => {
    // Mock challenge IDs
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "ch1" }, { id: "ch2" }],
    });

    // Mock session stats
    mockQuery.mockResolvedValueOnce({
      rows: [{ total_sessions: 100, completed_sessions: 75 }],
    });

    // Mock question accuracy
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Mock cost per session
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getBrandAnalytics("brand-1");

    expect(result.totalSessions).toBe(100);
    expect(result.completedSessions).toBe(75);
    expect(result.completionRate).toBe(75);
  });

  it("handles date range parameters", async () => {
    const from = new Date("2024-01-01");
    const to = new Date("2024-01-31");

    // Mock challenge IDs with date filters
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "ch1" }],
    });

    // Mock session stats
    mockQuery.mockResolvedValueOnce({
      rows: [{ total_sessions: 50, completed_sessions: 40 }],
    });

    // Mock question accuracy
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Mock cost per session
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getBrandAnalytics("brand-1", from, to);

    expect(result.totalSessions).toBe(50);
    expect(result.completedSessions).toBe(40);
    expect(result.completionRate).toBe(80);

    // Verify the first query includes date parameters
    const firstQuery = mockQuery.mock.calls[0];
    expect(firstQuery[1]).toContain(from.toISOString());
    expect(firstQuery[1]).toContain(to.toISOString());
  });

  it("returns question accuracy data", async () => {
    // Mock challenge IDs
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "ch1" }],
    });

    // Mock session stats
    mockQuery.mockResolvedValueOnce({
      rows: [{ total_sessions: 30, completed_sessions: 25 }],
    });

    // Mock question accuracy
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          round: 1,
          question_type: "which_brand",
          question_text: "Which brand uses this logo?",
          total_attempts: 25,
          correct_attempts: 20,
        },
      ],
    });

    // Mock cost per session
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getBrandAnalytics("brand-1");

    expect(result.questionAccuracy).toHaveLength(1);
    expect(result.questionAccuracy[0].accuracy).toBe(80);
    expect(result.questionAccuracy[0].totalAttempts).toBe(25);
    expect(result.questionAccuracy[0].correctAttempts).toBe(20);
  });

  it("returns cost per session time series", async () => {
    // Mock challenge IDs
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "ch1" }],
    });

    // Mock session stats
    mockQuery.mockResolvedValueOnce({
      rows: [{ total_sessions: 20, completed_sessions: 18 }],
    });

    // Mock question accuracy
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Mock cost per session
    mockQuery.mockResolvedValueOnce({
      rows: [
        { date: "2024-01-15", total_cost: 10.5, session_count: 10 },
        { date: "2024-01-16", total_cost: 8.4, session_count: 8 },
      ],
    });

    const result = await getBrandAnalytics("brand-1");

    expect(result.costPerSession).toHaveLength(2);
    expect(result.costPerSession[0].costPerSession).toBe(1.05);
    expect(result.costPerSession[1].costPerSession).toBe(1.05);
  });

  it("returns empty results when no date range matches", async () => {
    // Mock empty challenge IDs (no challenges in date range)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const from = new Date("2020-01-01");
    const to = new Date("2020-01-31");

    const result = await getBrandAnalytics("brand-1", from, to);

    expect(result).toEqual({
      totalSessions: 0,
      completedSessions: 0,
      completionRate: 0,
      questionAccuracy: [],
      costPerSession: [],
    });
  });
});
