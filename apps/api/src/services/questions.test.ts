import { describe, expect, it } from "vitest";
import { generateChallengeQuestions } from "./questions";

describe("Questions Generation Engine", () => {
  const brand = {
    name: "BrandX",
    tagline: "Best product ever",
    usp: "Fast and reliable",
    product_image_keys: ["img1.png", "img2.png"],
  };

  const distractorPool = Array.from({ length: 20 }).map((_, i) => ({
    name: `Brand${i}`,
  }));

  // -------------------------
  // BASIC GENERATION
  // -------------------------
  it("generates exactly 3 questions when full brand data is provided", () => {
    const result = generateChallengeQuestions("challenge-1", brand as any, distractorPool);

    expect(result.length).toBe(3);

    const types = result.map((q) => q.question_type);
    expect(types).toContain("which_tagline");
    expect(types).toContain("which_brand");
    expect(types).toContain("which_product");
  });

  // -------------------------
  // FALLBACK TAGLINE
  // -------------------------
  it("falls back to brand name when tagline is missing", () => {
    const result = generateChallengeQuestions(
      "challenge-1",
      { ...brand, tagline: undefined } as any,
      distractorPool,
    );

    const fallbackQ = result.find((q) => q.question_text === "What is the name of this brand?");

    expect(fallbackQ?.correct_answer).toBe(brand.name);
  });

  // -------------------------
  // DISTRACTOR LOGIC
  // -------------------------
  it("uses distractors from pool without duplicates or correct answer", () => {
    const result = generateChallengeQuestions("challenge-1", brand as any, distractorPool);

    result.forEach((q) => {
      const options = [q.option_a, q.option_b, q.option_c, q.option_d];

      // no duplicates
      const unique = new Set(options);
      expect(unique.size).toBe(options.length);

      // correct answer not duplicated in distractors
      const occurrences = options.filter((o) => o === q.correct_answer);
      expect(occurrences.length).toBe(1);
    });
  });

  // -------------------------
  // EMPTY POOL HANDLING
  // -------------------------
  it("falls back to Option A/B/C when distractor pool is empty", () => {
    const result = generateChallengeQuestions("challenge-1", brand as any, []);

    result.forEach((q) => {
      const options = [q.option_a, q.option_b, q.option_c, q.option_d];
      expect(options).toContain("Option A");
      expect(options).toContain("Option B");
      expect(options).toContain("Option C");
    });
  });

  // -------------------------
  // CORRECT OPTION SHUFFLING
  // -------------------------
  it("assigns correct_option consistently after shuffle", () => {
    const result = generateChallengeQuestions("challenge-1", brand as any, distractorPool);

    result.forEach((q) => {
      const options = [q.option_a, q.option_b, q.option_c, q.option_d];
      const correctIndex = options.indexOf(q.correct_answer);
      expect(q.correct_option).toBe(["A", "B", "C", "D"][correctIndex]);
    });
  });
});
