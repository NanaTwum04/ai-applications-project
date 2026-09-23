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

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Something went wrong: {e}")


# Mounted last so the /api routes above take precedence.
app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
