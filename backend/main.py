import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

api_key = os.getenv("OPENAI_API_KEY")
model = os.getenv("OPENAI_MODEL", "gpt-5.2")

if not api_key:
    raise RuntimeError("Missing OPENAI_API_KEY. Add it to backend/.env")

client = OpenAI(api_key=api_key)
app = FastAPI()


class Idea(BaseModel):
    description: str


class GenerateQuestionsResponse(BaseModel):
    idea: str
    questions: list[str]


@app.post("/generate-questions", response_model=GenerateQuestionsResponse)
def generate_questions(idea: Idea):
    """
    Turn a user's vague app/software idea into a short list of parameter questions.
    """
    try:
        resp = client.responses.create(
            model=model,
            input=[
                {
                    "role": "developer",
                    "content": (
                        "You are a prompt engineer for app/software building. "
                        "Given an app idea, output 8-12 concise questions that help gather "
                        "requirements (platform, users, features, UI style, data, auth, etc.). "
                        "Return ONLY a JSON array of strings."
                    ),
                },
                {"role": "user", "content": idea.description},
            ],
        )
        text = resp.output_text.strip()

        # Very lightweight parsing: expect JSON array string like ["Q1", "Q2", ...]
        # We'll avoid heavy dependencies; just use json.
        import json

        questions = json.loads(text)
        if not isinstance(questions, list) or not all(isinstance(q, str) for q in questions):
            raise ValueError("Model did not return a JSON array of strings.")

        return {"idea": idea.description, "questions": questions}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI error: {e}")


class PromptRequest(BaseModel):
    idea: str
    answers: dict  # question -> answer, or parameter -> value


class PromptResponse(BaseModel):
    prompt: str


@app.post("/generate-prompt", response_model=PromptResponse)
def generate_prompt(data: PromptRequest):
    """
    Turn the idea + filled parameters into a final copy/paste prompt.
    """
    try:
        resp = client.responses.create(
            model=model,
            input=[
                {
                    "role": "developer",
                    "content": (
                        "You are a prompt engineer. Create ONE excellent copy/paste prompt "
                        "that the user can paste into an AI to generate a full app/software plan "
                        "and starter implementation guidance. The prompt should include:\n"
                        "- Role/instructions for the AI\n"
                        "- Clear requirements\n"
                        "- Deliverables list\n"
                        "- Constraints and assumptions\n"
                        "Be specific, structured, and professional.\n"
                        "Return ONLY the prompt text (no markdown fences)."
                    ),
                },
                {
                    "role": "user",
                    "content": f"App idea: {data.idea}\n\nUser parameters/answers:\n{data.answers}",
                },
            ],
        )

        prompt_text = resp.output_text.strip()
        if not prompt_text:
            raise ValueError("Empty response from model.")

        return {"prompt": prompt_text}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI error: {e}")


@app.get("/")
def health():
    return {"status": "ok", "service": "promptbuilder-backend"}
