import { useMemo, useState } from "react";
import { generatePrompt, generateQuestions, suggestAnswer, type Question } from "./api";


type Answers = Record<string, any>;

function cleanAnswers(answers: Answers): Answers {
  return Object.fromEntries(
    Object.entries(answers).filter(([_, v]) => {
      if (Array.isArray(v)) return v.length > 0;
      return v !== "" && v !== null && v !== undefined;
    })
  );
}

export default function App() {
  const [idea, setIdea] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Answers>({});
  const [finalPrompt, setFinalPrompt] = useState<string>("");

  // Suggestion Options States
  const [autoFillLoading, setAutoFillLoading] = useState(false);
  const [autoFillProgress, setAutoFillProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });


  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  

  async function onGenerateQuestions() {
    setError(null);
    setQuestions([]);
    setAnswers({});
    setFinalPrompt("");
    setLoadingQuestions(true);

    try {
      const data = await generateQuestions(idea.trim());
      setQuestions(data.questions);

      // Initialize answer shapes so inputs are controlled
      const initial: Answers = {};
      for (const q of data.questions) {
        if (q.type === "multi_select") initial[q.id] = [];
        else if (q.type === "boolean") initial[q.id] = null;
        else initial[q.id] = "";
      }
      setAnswers(initial);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoadingQuestions(false);
    }
  }

  function setAnswer(id: string, value: any) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function toggleMulti(id: string, choice: string) {
    setAnswers((prev) => {
      const current: string[] = Array.isArray(prev[id]) ? prev[id] : [];
      const exists = current.includes(choice);
      const next = exists ? current.filter((c) => c !== choice) : [...current, choice];
      return { ...prev, [id]: next };
    });
  }

  const requiredMissing = useMemo(() => {
    const missing: string[] = [];
    for (const q of questions) {
      if (!q.required) continue;
      const val = answers[q.id];

      if (q.type === "multi_select") {
        if (!Array.isArray(val) || val.length === 0) missing.push(q.id);
      } else if (q.type === "boolean") {
        // Treat required boolean as not missing (it's always set to true/false)
      } else {
        if (val === null || val === undefined || String(val).trim() === "") missing.push(q.id);
      }
    }
    return missing;
  }, [questions, answers]);

  function renderInput(q: Question) {
    const val = answers[q.id];

    switch (q.type) {
      case "text":
        return (
          <input
            value={val ?? ""}
            onChange={(e) => setAnswer(q.id, e.target.value)}
            placeholder={q.placeholder ?? ""}
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
          />
        );

      case "textarea":
        return (
          <textarea
            value={val ?? ""}
            onChange={(e) => setAnswer(q.id, e.target.value)}
            placeholder={q.placeholder ?? ""}
            rows={3}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 8,
              border: "1px solid #ccc",
              resize: "vertical",
            }}
          />
        );

      case "number":
        return (
          <input
            type="number"
            value={val ?? ""}
            onChange={(e) => setAnswer(q.id, e.target.value === "" ? "" : Number(e.target.value))}
            placeholder={q.placeholder ?? ""}
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
          />
        );

      case "boolean":
        return (
          <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={Boolean(val)}
              onChange={(e) => setAnswer(q.id, e.target.checked)}
            />
            <span>{Boolean(val) ? "Yes" : "No"}</span>
          </label>
        );

      case "single_select":
        return (
          <select
            value={val ?? ""}
            onChange={(e) => setAnswer(q.id, e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
          >
            <option value="" disabled>
              Select one…
            </option>
            {(q.choices ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        );

      case "multi_select":
        return (
          <div style={{ display: "grid", gap: 8 }}>
            {(q.choices ?? []).map((c) => {
              const checked = Array.isArray(val) ? val.includes(c) : false;
              return (
                <label key={c} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleMulti(q.id, c)} />
                  <span>{c}</span>
                </label>
              );
            })}
          </div>
        );

      default:
        return <div style={{ color: "red" }}>Unsupported question type: {q.type}</div>;
    }
  }

  async function onGeneratePrompt() {
    setError(null);
    setFinalPrompt("");
    setLoadingPrompt(true);

    try {
      const cleaned = cleanAnswers(answers);
      const res = await generatePrompt({
        idea: idea.trim(),
        answers: cleaned,
      });
      setFinalPrompt(res.prompt);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoadingPrompt(false);
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(finalPrompt);
    } catch {
      // If clipboard fails, user can still manually select/copy
    }
  }

  // For "suggest me"/"autofill"
  async function onAutoFillAll() {
    if (!idea.trim() || questions.length === 0) return;

    setError(null);
    setAutoFillLoading(true);
    setAutoFillProgress({ done: 0, total: questions.length });

    try {
      // We'll build up answers gradually so each next suggestion sees prior selections.
      let workingAnswers = { ...answers };

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];

        // optional: skip if already answered (comment out if you want overwrite behavior)
        const existing = workingAnswers[q.id];
        const hasValue =
          q.type === "boolean"
            ? false // always allow autofill to set it
            : (Array.isArray(existing) && existing.length > 0) ||
              (!Array.isArray(existing) && existing !== "" && existing !== null && existing !== undefined);

        if (!hasValue) {
          const res = await suggestAnswer({
            idea: idea.trim(),
            question: q,
            current_answers: cleanAnswers(workingAnswers),
          });

          workingAnswers = { ...workingAnswers, [res.id]: res.value };
          setAnswers(workingAnswers); // update UI as we go
        }

        setAutoFillProgress({ done: i + 1, total: questions.length });
      }
    } catch (e: any) {
      setError(e?.message ?? "Unknown error during auto-fill");
    } finally {
      setAutoFillLoading(false);
    }
  }


  return (
    <div style={{ maxWidth: 950, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1 style={{ marginBottom: 8 }}>IdeaDraft AI (Web Prototype)</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        Step 1: write your idea → Step 2: answer questions → Step 3: generate a perfect prompt.
      </p>

      {/* Step 1 */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="e.g., I want to build a budgeting app for students..."
          rows={4}
          style={{
            flex: 1,
            padding: 12,
            borderRadius: 8,
            border: "1px solid #ccc",
            resize: "vertical",
          }}
        />
        <button
          onClick={onGenerateQuestions}
          disabled={loadingQuestions || idea.trim().length < 3}
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            border: "1px solid #222",
            background: loadingQuestions ? "#ddd" : "#222",
            color: loadingQuestions ? "#222" : "#fff",
            cursor: loadingQuestions ? "default" : "pointer",
            minWidth: 170,
          }}
        >
          {loadingQuestions ? "Generating..." : "Generate Questions"}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: "#ffe5e5" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Step 2 */}
      {questions.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ margin: "10px 0 16px", display: "flex", gap: 12, alignItems: "center" }}>
            <button
              onClick={onAutoFillAll}
              disabled={autoFillLoading}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid #222",
                background: autoFillLoading ? "#ddd" : "#fff",
                cursor: autoFillLoading ? "default" : "pointer",
                fontSize: 13,
              }}
            >
              {autoFillLoading ? "Auto-filling..." : "Auto-fill all"}
            </button>

            {autoFillLoading && (
              <span style={{ fontSize: 13, color: "#555" }}>
                {autoFillProgress.done}/{autoFillProgress.total}
              </span>
            )}
          </div>



          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <h2 style={{ marginBottom: 8 }}>Answer the questions</h2>
            <div style={{ fontSize: 12, color: "#666" }}>
              Missing required: {requiredMissing.length}
            </div>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            {questions.map((q) => {
              const isMissing = requiredMissing.includes(q.id);
              return (
                <div
                  key={q.id}
                  style={{
                    border: `1px solid ${isMissing ? "#ff7a7a" : "#ddd"}`,
                    borderRadius: 10,
                    padding: 14,
                    background: "#fafafa",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ fontWeight: 600 }}>
                      {q.question} {q.required ? <span style={{ color: "#c00" }}>*</span> : null}
                    </div>
                    <div style={{ fontSize: 12, color: "#444" }}>
                      <code>{q.type}</code> · <code>{q.id}</code>
                    </div>
                  </div>

                  <div style={{ marginTop: 10 }}>{renderInput(q)}</div>

                  {isMissing && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#c00" }}>
                      Required field
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Step 3 */}
          <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
            <button
              onClick={onGeneratePrompt}
              disabled={loadingPrompt || requiredMissing.length > 0}
              style={{
                padding: "12px 16px",
                borderRadius: 8,
                border: "1px solid #222",
                background: loadingPrompt || requiredMissing.length > 0 ? "#ddd" : "#0b5",
                color: "#111",
                cursor: loadingPrompt || requiredMissing.length > 0 ? "not-allowed" : "pointer",
              }}
            >
              {loadingPrompt ? "Generating prompt..." : "Generate Prompt"}
            </button>

            {requiredMissing.length > 0 && (
              <span style={{ color: "#666", fontSize: 13 }}>
                Fill required fields to generate the prompt.
              </span>
            )}
          </div>

          {/* Debug (optional) */}
          <div style={{ marginTop: 20 }}>
            <h3 style={{ marginBottom: 8 }}>Answers JSON (debug)</h3>
            <pre style={{ background: "#111", color: "#eee", padding: 12, borderRadius: 10, overflowX: "auto" }}>
              {JSON.stringify(cleanAnswers(answers), null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* Prompt output */}
      {finalPrompt && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ marginBottom: 8 }}>Your Generated Prompt</h2>
          <textarea
            readOnly
            value={finalPrompt}
            rows={14}
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 10,
              border: "1px solid #ccc",
              resize: "vertical",
            }}
          />
          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            <button onClick={copyPrompt} style={{ padding: "10px 14px", borderRadius: 8 }}>
              Copy Prompt
            </button>
            <button
              onClick={() => setFinalPrompt("")}
              style={{ padding: "10px 14px", borderRadius: 8 }}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}