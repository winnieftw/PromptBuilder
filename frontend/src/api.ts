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
  required: boolean;
  placeholder: string | null;
  choices: string[] | null;
};

export type GenerateQuestionsResponse = {
  questions: Question[];
};

export type GeneratePromptRequest = {
  idea: string;
  answers: Record<string, any>;
};

export type GeneratePromptResponse = {
  prompt: string;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

export async function generateQuestions(description: string) {
  const res = await fetch(`${API_BASE}/generate-questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend error (${res.status}): ${text}`);
  }

  return (await res.json()) as GenerateQuestionsResponse;
}

export async function generatePrompt(payload: GeneratePromptRequest) {
  const res = await fetch(`${API_BASE}/generate-prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend error (${res.status}): ${text}`);
  }

  return (await res.json()) as GeneratePromptResponse;
}
