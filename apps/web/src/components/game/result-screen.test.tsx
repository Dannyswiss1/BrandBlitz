import type { AnchorHTMLAttributes } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResultScreen } from "./result-screen";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === "string" ? href : undefined} {...props}>
      {children}
    </a>
  ),
}));

// Stub requestAnimationFrame for jsdom (animation is disabled in test env)
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
  cb(Date.now());
  return 0;
});

describe("ResultScreen", () => {
  let clipboardWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, "", "/challenge/challenge-123/results");

    if (!navigator.clipboard) {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => undefined,
        } as unknown as Clipboard,
      });
    }

    clipboardWrite = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
  });

  it("renders the total score, rank, and estimated earnings when provided", () => {
    render(
      <ResultScreen
        totalScore={12345}
        rank={7}
        estimatedUsdc="42.5"
        challengeId="challenge-123"
      />
    );

    expect(screen.getByText(/\b12,345\b/)).toBeInTheDocument();
    expect(screen.getByText("Rank #7")).toBeInTheDocument();
    expect(screen.getByText("Estimated earnings")).toBeInTheDocument();
    expect(screen.getByText("42.50 USDC")).toBeInTheDocument();
  });

  it("hides optional rank and earnings details when they are not provided", () => {
    render(<ResultScreen totalScore={9000} challengeId="challenge-123" />);

    expect(screen.getByText(/\b9,000\b/)).toBeInTheDocument();
    expect(screen.queryByText(/Rank #/)).not.toBeInTheDocument();
    expect(screen.queryByText("Estimated earnings")).not.toBeInTheDocument();
    expect(screen.queryByText(/USDC/)).not.toBeInTheDocument();
  });

  it("uses the Web Share API when it is available", async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });

    render(<ResultScreen totalScore={1500} estimatedUsdc="10" challengeId="challenge-123" />);

    await user.click(screen.getByRole("button", { name: "Share Result" }));

    expect(share).toHaveBeenCalledWith({
      text: "I just scored 1,500 in a BrandBlitz challenge and earned ~10.00 USDC! 🏆",
      url: "http://localhost:3000/challenge/challenge-123/results",
    });
    expect(clipboardWrite).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("falls back to the clipboard and shows a success toast when Web Share is unavailable", async () => {
    const user = userEvent.setup();

    render(<ResultScreen totalScore={2000} challengeId="challenge-123" />);

    await user.click(screen.getByRole("button", { name: "Share Result" }));

    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledWith("I just scored 2,000 in a BrandBlitz challenge! 🏆");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Result copied to clipboard.");
  });

  it("links to the challenge leaderboard", () => {
    render(<ResultScreen totalScore={1234} challengeId="challenge-123" />);

    expect(screen.getByRole("link", { name: "View Leaderboard" })).toHaveAttribute(
      "href",
      "/challenge/challenge-123"
    );
  });

  it("animates score from 0 to total and shows confetti for rank <= 10", () => {
    render(
      <ResultScreen totalScore={5000} rank={3} estimatedUsdc="25" challengeId="challenge-123" />
    );

    expect(screen.getByText(/\b5,000\b/)).toBeInTheDocument();
  });

  it("does not show confetti when rank is undefined", () => {
    const { container } = render(<ResultScreen totalScore={500} challengeId="challenge-123" />);

    expect(container.querySelector(".confetti-piece")).toBeNull();
  });
});
