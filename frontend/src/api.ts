// api.ts
// Centralized API helpers for the PromptBuilder frontend.

export type Category = "app_dev" | "academics" | "general";

export type QuestionType =
  | "text"
  | "textarea"
  | "single_select"
  | "multi_select"
  | "boolean"
  | "number";

export type Question = {
  id: string;
  type: QuestionType;
  question: string;
  required?: boolean;
  placeholder?: string | null;
  choices?: string[] | null;
};

export type GenerateQuestionsResponse = {
  questions: Question[];
};

export type GeneratePromptRequest = {
  category: Category;
  idea: string;
  answers: Record<string, any>;
};

export type PromptResponse = {
  prompt: string;
};

// Suggest-answer request/response
export type SuggestAnswerRequest = {
  category: Category;
  idea: string;
  question: Question;
  current_answers: Record<string, any>;
};

export type SuggestAnswerResponse = {
  id: string;
  value: any;
};

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE?.toString()?.trim() || "http://127.0.0.1:8000";

async function request<T>(path: string, options: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Backend error (${res.status}): ${text || res.statusText}`);
  }

  return (await res.json()) as T;
}

/**
 * POST /generate-questions
 * Backend expects:
 *  { category: 'app_dev'|'academics'|'general', description: string }
 */
export async function generateQuestions(category: Category, description: string) {
  return request<GenerateQuestionsResponse>("/generate-questions", {
    method: "POST",
    body: JSON.stringify({
      category,
      description,
    }),
  });
}

/**
 * POST /generate-prompt
 * Backend expects:
 *  { category, idea, answers }
 */
export async function generatePrompt(payload: GeneratePromptRequest) {
  return request<PromptResponse>("/generate-prompt", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * POST /suggest-answer
 * Backend expects:
 *  { category, idea, question, current_answers }
 */
export async function suggestAnswer(payload: SuggestAnswerRequest) {
  return request<SuggestAnswerResponse>("/suggest-answer", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
