import type { Brand } from "../db/queries/brands";
import type { ChallengeQuestion } from "../db/queries/challenges";

type QuestionDraft = Omit<ChallengeQuestion, "id">;

/**
 * Auto-generate 3 challenge questions from brand kit inputs.
 *
 * Round 1: Tagline recognition — show logo image, pick correct tagline
 * Round 2: USP match — show brand name, pick correct USP
 * Round 3: Product recognition — show product image, pick correct brand name
 *
 * Architecture decision: questions derived from content shown in warm-up,
 * so unknown brands work perfectly. Correct answers come from brand inputs.
 * Distractors are generated from other available brand data.
 */
export function generateChallengeQuestions(
  challengeId: string,
  brand: Brand,
  distractorPool: Pick<Brand, "name" | "tagline" | "usp">[]
): QuestionDraft[] {
  const questions: QuestionDraft[] = [];

  // — Round 1: Tagline recognition —
  if (brand.tagline) {
    const distractors = pickDistractors(
      distractorPool.map((d) => d.tagline).filter(Boolean) as string[],
      brand.tagline,
      3
    );
    const options = shuffle([brand.tagline, ...distractors]);
    const correctOption = optionLetter(options.indexOf(brand.tagline));

    questions.push({
      challenge_id: challengeId,
      round: 1,
      question_type: "tagline_recognition",
      prompt_type: "logo",
      question_text: `Which tagline belongs to this brand?`,
      correct_answer: brand.tagline,
      option_a: options[0],
      option_b: options[1],
      option_c: options[2],
      option_d: options[3],
      correct_option: correctOption,
    });
  }

  // — Round 2: USP match —
  if (brand.usp) {
    const distractors = pickDistractors(
      distractorPool.map((d) => d.usp).filter(Boolean) as string[],
      brand.usp,
      3
    );
    const options = shuffle([brand.usp, ...distractors]);
    const correctOption = optionLetter(options.indexOf(brand.usp));

    questions.push({
      challenge_id: challengeId,
      round: 2,
      question_type: "usp_match",
      prompt_type: "brandName",
      question_text: `What sets ${brand.name} apart from competitors?`,
      correct_answer: brand.usp,
      option_a: options[0],
      option_b: options[1],
      option_c: options[2],
      option_d: options[3],
      correct_option: correctOption,
    });
  }

  // — Round 3: Product recognition —
  if (brand.product_image_keys.length > 0) {
    const brandNames = pickDistractors(
      distractorPool.map((d) => d.name).filter(Boolean) as string[],
      brand.name,
      3
    );
    const options = shuffle([brand.name, ...brandNames]);
    const correctOption = optionLetter(options.indexOf(brand.name));

    questions.push({
      challenge_id: challengeId,
      round: 3,
      question_type: "product_recognition",
      prompt_type: "productImage1",
      question_text: `Which brand makes this product?`,
      correct_answer: brand.name,
      option_a: options[0],
      option_b: options[1],
      option_c: options[2],
      option_d: options[3],
      correct_option: correctOption,
    });
  }

  // Ensure exactly 3 rounds — fallback to brand name recognition if data is sparse
  while (questions.length < 3) {
    const round = (questions.length + 1) as 1 | 2 | 3;
    const distractors = pickDistractors(
      distractorPool.map((d) => d.name),
      brand.name,
      3
    );
    const options = shuffle([brand.name, ...distractors]);
    questions.push({
      challenge_id: challengeId,
      round,
      question_type: "brand_name_recognition",
      prompt_type: "logo",
      question_text: `What is the name of this brand?`,
      correct_answer: brand.name,
      option_a: options[0],
      option_b: options[1],
      option_c: options[2],
      option_d: options[3],
      correct_option: optionLetter(options.indexOf(brand.name)),
    });
  }

  return questions.slice(0, 3);
}

function pickDistractors(pool: string[], exclude: string, count: number): string[] {
  const filtered = pool.filter((item) => item !== exclude);
  const shuffled = shuffle(filtered);
  const result = shuffled.slice(0, count);

  // Pad with generic fallbacks if pool is too small
  const fallbacks = ["Option A", "Option B", "Option C", "Option D"];
  while (result.length < count) {
    result.push(fallbacks[result.length] ?? `Option ${result.length + 1}`);
  }

  return result;
}

function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function optionLetter(index: number): "A" | "B" | "C" | "D" {
  return (["A", "B", "C", "D"] as const)[index] ?? "A";
}
