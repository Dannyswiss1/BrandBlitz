import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LoginPage from "./page";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null }),
  signIn: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
  usePathname: () => "/login",
}));

describe("LoginPage", () => {
  it("renders without throwing and shows the BrandBlitz heading", () => {
    render(<LoginPage />);
    expect(screen.getByText("Welcome to BrandBlitz")).toBeTruthy();
  });

  it("renders the terms paragraph", () => {
    render(<LoginPage />);
    expect(screen.getByText(/by signing in you agree/i)).toBeTruthy();
  });
});
