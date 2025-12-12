from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class Idea(BaseModel):
    description: str

@app.post("/generate-questions")
def generate_questions(idea: Idea):
    return {
        "idea": idea.description,
        "questions": [
            "Who is the target user?",
            "What platform should the app run on?",
            "What are the core features?",
        ],
    }

class PromptRequest(BaseModel):
    parameters: dict

@app.post("/generate-prompt")
def generate_prompt(data: PromptRequest):
    return {
        "prompt": f"Build an app with these parameters: {data.parameters}"
    }
