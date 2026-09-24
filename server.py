"""
Web server (Section 8: INTERFACE layer).

Serves the advising web app in web/ and exposes the RAG knowledge base,
the Gemini agent, and the rule-based progress tool to it as a small JSON API:

  GET  /api/health                → whether GEMINI_API_KEY is configured
  GET  /api/students              → every student with status + reasons
  GET  /api/students/{student_id} → one student's progress check
  GET  /api/at-risk               → flagged students, worst first
  GET  /api/knowledge-base        → the programme documents used for RAG
  POST /api/chat                  → ask the agent a question

Run with:  python server.py   then open http://localhost:8000
"""

import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from google.genai import errors as genai_errors
from pydantic import BaseModel

import generate_student_data
from agent import ask_with_sources
from rag import KB_FOLDER, source_title
from tools import (
    STUDENT_RECORDS as STUDENT_RECORDS_CSV,
    check_student_progress,
    list_all_students,
    list_at_risk_students,
)

WEB_DIR = Path(__file__).parent / "web"

# The dataset is gitignored, so create it on first run.
if not STUDENT_RECORDS_CSV.exists():
    generate_student_data.main()

app = FastAPI(title="UGBS Advising Assistant")
log = logging.getLogger("advising")

# Plain-language messages for Gemini API failures, by HTTP status. Users see
# these; the full error goes to the server log.
AI_ERROR_MESSAGES = {
    429: "The assistant has reached its usage limit for now. Please try again "
         "in a minute, or later today if the daily limit has been used up.",
    401: "The assistant isn't configured correctly (the AI service rejected "
         "its API key). Please let the project team know.",
    403: "The assistant isn't configured correctly (the AI service refused "
         "access). Please let the project team know.",
}
AI_UNAVAILABLE = "The assistant is temporarily unavailable. Please try again shortly."


class ChatTurn(BaseModel):
    role: str
    text: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatTurn] = []
    student_id: str | None = None


@app.get("/api/health")
def health():
    return {"gemini_configured": bool(os.environ.get("GEMINI_API_KEY"))}


@app.get("/api/students")
def students():
    return list_all_students()


@app.get("/api/students/{student_id}")
def student(student_id: str):
    result = check_student_progress(student_id)
    if not result["found"]:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@app.get("/api/at-risk")
def at_risk():
    return list_at_risk_students()


@app.get("/api/knowledge-base")
def knowledge_base():
    return [
        {"source": source_title(f.stem), "text": f.read_text(encoding="utf-8")}
        for f in sorted(KB_FOLDER.glob("*.txt"))
    ]


@app.post("/api/chat")
def chat(req: ChatRequest):
    if not os.environ.get("GEMINI_API_KEY"):
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY is not set on the server, so I can't reach the AI model. "
                   "Set it and restart server.py.",
        )
    try:
        return ask_with_sources(
            req.message,
            history=[t.model_dump() for t in req.history],
            student_id=req.student_id,
        )
    except genai_errors.APIError as e:
        log.error("Gemini API error %s: %s", e.code, e)
        status = e.code if e.code in AI_ERROR_MESSAGES else 503
        raise HTTPException(status_code=status, detail=AI_ERROR_MESSAGES.get(e.code, AI_UNAVAILABLE))
    except Exception:
        log.exception("Chat request failed")
        raise HTTPException(status_code=500, detail="Something went wrong while answering. Please try again.")


# Mounted last so the /api routes above take precedence.
app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")


if __name__ == "__main__":
    import uvicorn
    # Hosting platforms (e.g. Render) set PORT and need the server reachable
    # from outside; locally this still runs on http://localhost:8000.
    port = int(os.environ.get("PORT", 8000))
    host = "0.0.0.0" if "PORT" in os.environ else "127.0.0.1"
    uvicorn.run(app, host=host, port=port)
