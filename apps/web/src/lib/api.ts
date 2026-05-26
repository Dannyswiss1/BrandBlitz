import axios from "axios";
import type { AxiosInstance } from "axios";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost/api";

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
  status: "pending_deposit" | "active" | "ended" | "settled" | "payout_failed";
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
  displayName: string;
  username: string;
  league: "bronze" | "silver" | "gold" | null;
  totalEarned: string;
  totalChallenges: number;
  avatarUrl: string | null;
  bestScore?: number;
  recentSessions?: Array<{
    id: string;
    brandName: string;
    totalScore: number;
    rank?: number;
    completedAt: string;
  }>;
}
