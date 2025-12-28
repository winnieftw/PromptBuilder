
import { useState } from "react";
import { generateQuestions, type Question } from "./api";

export default function App() {
  const [idea, setIdea] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onGenerate() {
    setError(null);
    setQuestions([]);
    setLoading(true);
    try {
      const data = await generateQuestions(idea.trim());
      setQuestions(data.questions);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1>PromptBuilder (Web Prototype)</h1>
      <p>Type an app/software idea → generate structured questions.</p>

      <textarea
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder="e.g., I want to build a budgeting app for college students..."
        rows={4}
        style={{ width: "100%", padding: 12, borderRadius: 8 }}
      />

      <button
        onClick={onGenerate}
        disabled={loading || idea.trim().length < 3}
        style={{ marginTop: 12, padding: "10px 14px" }}
      >
        {loading ? "Generating..." : "Generate Questions"}
      </button>

      {error && <div style={{ color: "red", marginTop: 12 }}>{error}</div>}

      <div style={{ marginTop: 24 }}>
        {questions.map((q) => (
          <div key={q.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <strong>{q.question}</strong>
            <div style={{ fontSize: 12, color: "#555" }}>
              type: {q.type} · id: {q.id}
            </div>
            {q.placeholder && <div style={{ marginTop: 6 }}>placeholder: {q.placeholder}</div>}
            {q.choices && (
              <ul>
                {q.choices.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
