import json
import os
from typing import Literal, Optional, Dict, Any, List

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, ValidationError

# OpenAI SDK
from openai import OpenAI

#CORS for fastapi
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="PromptBuilder Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


load_dotenv()

# ---- Config ----
API_KEY = os.getenv("OPENAI_API_KEY", "")
MODEL = os.getenv("OPENAI_MODEL", "gpt-5.2")

# If DEV_MODE=true, the server will return mock data instead of calling OpenAI.
DEV_MODE = os.getenv("DEV_MODE", "false").lower() in ("1", "true", "yes")

client = OpenAI(api_key=API_KEY) if API_KEY else None

QuestionType = Literal[
    "text",
    "textarea",
    "single_select",
    "multi_select",
    "boolean",
    "number",
]

Category = Literal["app_dev", "academics", "general"]


class Idea(BaseModel):
    category: Category = "app_dev"
    description: str = Field(..., min_length=3)



class Question(BaseModel):
    id: str = Field(..., min_length=1, description="Stable key used to store answers, e.g., 'platform'")
    type: QuestionType
    question: str = Field(..., min_length=1)
    required: bool = False
    placeholder: Optional[str] = None
    choices: Optional[List[str]] = None

    # Light validation rules:
    # - select types should have choices
    # - non-select types should not require choices
    def model_post_init(self, __context: Any) -> None:
        if self.type in ("single_select", "multi_select"):
            if not self.choices or not isinstance(self.choices, list) or len(self.choices) < 2:
                raise ValueError("Select questions must include a 'choices' list with at least 2 items.")
        else:
            # For non-select, ignore choices if provided
            pass


class GenerateQuestionsResponse(BaseModel):
    questions: List[Question]


class PromptRequest(BaseModel):
    category: Category = "app_dev"
    idea: str
    answers: Dict[str, Any]



class PromptResponse(BaseModel):
    prompt: str

# For Auto-complete button
class SuggestAnswerRequest(BaseModel):
    category: Category = "app_dev"
    idea: str
    question: Question
    current_answers: Dict[str, Any] = {}


class SuggestAnswerResponse(BaseModel):
    id: str
    type: QuestionType
    value: Any


def category_instructions(category: str) -> str:
    if category == "academics":
        return (
            "Context: The user is working on an academic task (study guide, practice plan, summary, etc.).\n"
            "Focus questions on: subject/topic scope, course level, exam date/time horizon, format of output "
            "(study guide outline, flashcards, practice questions), difficulty level, length, and learning goals.\n"
        )
    if category == "general":
        return (
            "Context: The user has a general request.\n"
            "Focus questions on: goal, audience, tone, constraints, desired format (bullets, table, steps), "
            "length, and examples.\n"
        )
    # default app_dev
    return (
        "Context: The user is building an app/software product.\n"
        "Focus questions on: platform, target users, core features, UI style, data/storage, auth, integrations, constraints.\n"
    )


def mock_questions_for_app_idea(_: str) -> GenerateQuestionsResponse:
    # A solid default set for app/software ideas
    return GenerateQuestionsResponse(
        questions=[
            Question(
                id="platform",
                type="single_select",
                question="Which platform(s) should this support?",
                choices=["Web", "iOS", "Android", "Desktop"],
                required=True,
            ),
            Question(
                id="target_user",
                type="text",
                question="Who is the target user?",
                placeholder="e.g., college students, small business owners, gym beginners",
                required=True,
            ),
            Question(
                id="core_features",
                type="multi_select",
                question="Which core features should be included?",
                choices=[
                    "User authentication",
                    "Dashboard / Home screen",
                    "Search",
                    "Notifications",
                    "Payments",
                    "Settings",
                    "Offline mode",
                    "Analytics / charts",
                ],
                required=True,
            ),
            Question(
                id="ui_style",
                type="single_select",
                question="What UI style do you want?",
                choices=["Minimal", "Modern", "Playful", "Professional", "iOS-like", "Dark mode"],
                required=False,
            ),
            Question(
                id="data_storage",
                type="single_select",
                question="How should data be stored?",
                choices=["Local only", "Cloud database", "Local + cloud sync"],
                required=False,
            ),
            Question(
                id="notes",
                type="textarea",
                question="Anything else we should consider?",
                placeholder="e.g., accessibility, specific libraries, must-have screens, constraints",
                required=False,
            ),
        ]
    )


def parse_model_json(text: str) -> dict:
    """
    Tries to parse the model output as JSON.
    If the model accidentally wraps JSON with extra text, we attempt to extract the first JSON object.
    """
    text = text.strip()

    # First try direct JSON parse
    try:
        return json.loads(text)
    except Exception:
        pass

    # Try to extract the first {...} block
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidate = text[start : end + 1]
        return json.loads(candidate)

    raise ValueError("Could not parse JSON from model output.")


'''
    API Endpoints
'''

@app.get("/")
def health():
    return {"status": "ok", "service": "promptbuilder-backend", "dev_mode": DEV_MODE}


@app.post("/generate-questions", response_model=GenerateQuestionsResponse)
def generate_questions(payload: Idea):
    """
    Generate structured clarification questions based on the user's idea + selected category.

    Input (Idea):
      - category: "app_dev" | "academics" | "general"
      - description: str

    Output (GenerateQuestionsResponse):
      - questions: List[Question] (each has id, type, question, required, placeholder, choices)
    """
    # Choose category-specific fallback (optional: you can make mocks per category later)
    if DEV_MODE or not client:
        # If you haven't built mocks for other categories yet, this is fine for now.
        return mock_questions_for_app_idea(payload.description)

    # Category-specific “lens” injected into the model instructions
    cat_context = category_instructions(payload.category)

    try:
        resp = client.responses.create(
            model=MODEL,
            input=[
                {
                    "role": "developer",
                    "content": (
                        cat_context
                        + "\n"
                        + "You generate form questions to help a non-technical user clarify their request.\n\n"
                        "Return ONLY valid JSON matching this schema:\n"
                        "{\n"
                        '  "questions": [\n'
                        "    {\n"
                        '      "id": string (snake_case stable key like \"platform\" or \"core_features\"),\n'
                        '      "type": one of [\"text\",\"textarea\",\"single_select\",\"multi_select\",\"boolean\",\"number\"],\n'
                        '      "question": string,\n'
                        '      "required": boolean,\n'
                        '      "placeholder": string | null,\n'
                        '      "choices": [string, ...] | null\n'
                        "    }\n"
                        "  ]\n"
                        "}\n\n"
                        "IMPORTANT RULES:\n"
                        "- Produce 8–12 questions.\n"
                        "- Use 'single_select' when exactly one option is allowed.\n"
                        "- Use 'multi_select' when multiple options are allowed.\n"
                        "- Include 'choices' ONLY for single_select or multi_select; otherwise choices must be null.\n"
                        "- Include 'placeholder' ONLY for 'text' or 'textarea'; otherwise placeholder must be null.\n"
                        "- A placeholder is an example of a good answer and MUST start with 'e.g.,'.\n"
                        "- Keep questions concise and beginner-friendly.\n"
                        "- Do NOT include markdown, comments, or extra keys.\n"
                    ),
                },
                {"role": "user", "content": payload.description},
            ],
        )

        raw = resp.output_text.strip()
        data = parse_model_json(raw)

        # Validate against Pydantic models
        return GenerateQuestionsResponse(**data)

    except (ValidationError, ValueError):
        # Model returned malformed JSON or schema mismatch -> fallback keeps UI working
        return mock_questions_for_app_idea(payload.description)
    except Exception:
        # Quota / network / etc. -> fallback for MVP
        return mock_questions_for_app_idea(payload.description)



@app.post("/generate-prompt", response_model=PromptResponse)
def generate_prompt(payload: PromptRequest):
    """
    Input: category + idea + answers keyed by question.id
    Output: final copy/paste prompt OR a clear service-unavailable message
    """

    # Dev-only fallback so you can keep building UI
    def dev_fallback_prompt() -> str:
        return (
            "[DEV MODE]\n\n"
            "OpenAI is not connected, so this is a placeholder prompt.\n\n"
            f"Idea:\n{payload.idea}\n\n"
            "User parameters (id -> value):\n"
            f"{json.dumps(payload.answers, indent=2)}\n\n"
            "This prompt is shown only because DEV_MODE=true."
        )

    # 🚨 Production behavior: be explicit if OpenAI is unavailable
    if not client:
        if DEV_MODE:
            return {"prompt": dev_fallback_prompt()}
        return {
            "prompt": (
                "⚠️ AI service unavailable.\n\n"
                "The app is currently unable to connect to the AI service needed to generate prompts.\n\n"
                "Please check:\n"
                "- Your internet connection\n"
                "- Your OpenAI API key configuration\n"
                "- That the AI service is available\n\n"
                "Once the connection is restored, try again."
            )
        }

    cat_context = category_instructions(payload.category)

    # Category-specific goal
    if payload.category == "academics":
        prompt_goal = (
            "Create ONE excellent copy/paste prompt that the user can paste into an AI to generate "
            "a high-quality academic deliverable (study guide, practice questions, summaries, or a study plan)."
        )
        deliverables_hint = (
            "Ask the AI to produce: a structured study guide, key concepts, practice questions with answers, "
            "common pitfalls, and (optionally) a study schedule."
        )
    elif payload.category == "general":
        prompt_goal = (
            "Create ONE excellent copy/paste prompt that the user can paste into an AI to get a high-quality response "
            "for their general request."
        )
        deliverables_hint = (
            "Ask the AI to provide a structured response, step-by-step guidance if relevant, examples/templates, "
            "and clearly stated assumptions."
        )
    else:
        prompt_goal = (
            "Create ONE excellent copy/paste prompt that the user can paste into an AI to get "
            "a full app/software plan and implementation guidance."
        )
        deliverables_hint = (
            "Ask the AI to produce an MVP plan, feature list, UI/screens, data model, "
            "recommended tech stack, and a step-by-step build plan."
        )

    try:
        resp = client.responses.create(
            model=MODEL,
            input=[
                {
                    "role": "developer",
                    "content": (
                        cat_context + "\n\n"
                        + prompt_goal + "\n"
                        "The prompt must be structured, specific, and incorporate the user's answers.\n"
                        + deliverables_hint + "\n\n"
                        "Return ONLY the prompt text (no markdown fences)."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Idea:\n{payload.idea}\n\n"
                        "Parameters (id -> value):\n"
                        f"{json.dumps(payload.answers, indent=2)}"
                    ),
                },
            ],
        )

        out = resp.output_text.strip()

        if not out:
            raise RuntimeError("Empty AI response")

        return {"prompt": out}

    except Exception:
        # If OpenAI errors mid-request
        if DEV_MODE:
            return {"prompt": dev_fallback_prompt()}
        return {
            "prompt": (
                "⚠️ AI service error.\n\n"
                "The app encountered an error while generating your prompt.\n"
                "Please try again in a moment."
            )
        }



    
@app.post("/suggest-answer", response_model=SuggestAnswerResponse)
def suggest_answer(payload: SuggestAnswerRequest):
    # DEV fallback so your UI works even if OpenAI fails
    def fallback_value():
        q = payload.question
        if q.type == "single_select":
            return (q.choices or [""])[0]
        if q.type == "multi_select":
            return (q.choices or [])[:2]
        if q.type == "boolean":
            return True
        if q.type == "number":
            return 1
        if q.type == "textarea":
            return "e.g., Keep it simple and beginner-friendly."
        return "e.g., College students building their first app."

    if DEV_MODE or not client:
        return {"id": payload.question.id, "type": payload.question.type, "value": fallback_value()}

    try:
        q = payload.question

        constraints = ""
        if q.type in ("single_select", "multi_select"):
            constraints = (
                f"Allowed choices: {q.choices}\n"
                "You MUST choose only from allowed choices.\n"
            )

        resp = client.responses.create(
            model=MODEL,
            input=[
                {
                    "role": "developer",
                    "content": (
                        "You suggest an answer for ONE form question.\n"
                        "Return ONLY valid JSON: {\"value\": <suggested_value>}.\n\n"
                        "Rules by type:\n"
                        "- text/textarea: value is a short helpful string.\n"
                        "- number: value is a number.\n"
                        "- boolean: value is true/false.\n"
                        "- single_select: value is ONE string from allowed choices.\n"
                        "- multi_select: value is an array of strings from allowed choices.\n"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"App idea: {payload.idea}\n\n"
                        f"Question: {q.question}\n"
                        f"Type: {q.type}\n"
                        f"{constraints}\n"
                        f"Current answers:\n{json.dumps(payload.current_answers, indent=2)}"
                    ),
                },
            ],
        )

        raw = resp.output_text.strip()
        data = parse_model_json(raw)
        value = data.get("value", None)

        # Shape enforcement
        if q.type == "single_select":
            if not isinstance(value, str) or not q.choices or value not in q.choices:
                value = (q.choices or [""])[0]
        elif q.type == "multi_select":
            if not isinstance(value, list):
                value = []
            value = [v for v in value if isinstance(v, str) and (q.choices is None or v in q.choices)]
            if q.choices and len(value) == 0:
                value = q.choices[:2]
        elif q.type == "boolean":
            value = bool(value)
        elif q.type == "number":
            try:
                value = float(value)
            except Exception:
                value = 1
        else:
            if not isinstance(value, str) or not value.strip():
                value = fallback_value()

        return {"id": q.id, "type": q.type, "value": value}

    except Exception:
        return {"id": payload.question.id, "type": payload.question.type, "value": fallback_value()}

