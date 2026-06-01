import axios from "axios";
import type { AxiosInstance } from "axios";

let BASE_URL = process.env.NEXT_PUBLIC_API_URL;

if (!BASE_URL) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_API_URL is required in production");
  }
  BASE_URL = "http://localhost:3001/api";
}

try {
  const parsedUrl = new URL(BASE_URL);
  if (!parsedUrl.pathname.endsWith("/api")) {
    throw new Error("NEXT_PUBLIC_API_URL must end with /api");
  }
} catch (error) {
  if (error instanceof TypeError) {
    throw new Error("NEXT_PUBLIC_API_URL must be a valid URL");
  }
  throw error;
}

export function createApiClient(token?: string): AxiosInstance {
  return axios.create({
    baseURL: BASE_URL,
    withCredentials: true,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    timeout: 10_000,
  });
}

// Unauthenticated client for public endpoints
export const api = createApiClient();

// Types matching API responses
export interface Challenge {
  id: string;
  brand_id: string;
  challenge_id: string;
  pool_amount_stroops: string;
  pool_amount_usdc: string;
  status:
    | "pending_deposit"
    | "active"
    | "ended"
    | "settled"
    | "payout_failed"
    | "cancelled"
    | "refunded";
  starts_at: string;
  ends_at: string | null;
  // joined fields
  brand_name?: string;
  tagline?: string;
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
}

export interface ChallengeQuestion {
  id: string;
  challenge_id: string;
  round: 1 | 2 | 3;
  question_type: string;
  prompt_type: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  // correct_option and correct_answer are NOT returned by the API
}

export interface LeaderboardEntry {
  rank: number;
  userId?: string;
  username: string;
  displayName?: string;
  league?: "bronze" | "silver" | "gold" | null;
  avatarUrl: string | null;
  totalScore: number;
  totalEarned?: string;
  endedAt: string | null;
}

export interface UserProfile {
  userId?: string;
  displayName: string;
  username: string;
  league: "bronze" | "silver" | "gold" | null;
  totalEarned: string;
  totalChallenges: number;
  avatarUrl: string | null;
  streak?: number;
  bestScore?: number;
  recentSessions?: Array<{
    id: string;
    brandName: string;
    totalScore: number;
    rank?: number;
    completedAt: string;
  }>;
}

export interface StreakResponse {
  streak: number;
  lastPlayDay?: string | null;
  repairAvailable?: boolean;
  nextMilestone: number;
  progress: number;
  milestoneJustHit: boolean;
}
