# UGBS Advising Assistant

An AI-powered academic advising assistant for the Data Science and Business
Analytics Department at the University of Ghana Business School (UGBS).

Built for the OMIS 404 term project (Scenario 12: Departmental Academic
Advising and Student Progress Support).

## How it works

- **Knowledge base (RAG)** — `rag.py` chunks the department's programme
  documents (`data/knowledge_base/*.txt`) and indexes them in a local
  ChromaDB vector store, so the assistant can retrieve real prerequisite,
  credit, and progression rules instead of guessing.
- **Rule-based progress tool** — `tools.py` applies the department's actual
  progression thresholds to student records (`data/student_records.csv`) to
  classify each student as `on_track`, `borderline`, or `at_risk`, with
  plain-language reasons. This is deterministic, not an LLM call, by design.
- **Agent orchestrator** — `agent.py` uses the Gemini API with function
  calling to decide, per question, whether to retrieve from the knowledge
  base, check a specific student's progress, list at-risk students, or some
  combination, then composes a final answer.
- **Interface** — `server.py` is a FastAPI server that serves the web app in
  `web/` and exposes the layers above as a JSON API. The web app has a
  student view (chat with the agent, which knows the signed-in student's ID)
  and an advisor dashboard (roster, risk ranking, analytics and an advisor
  chat console). The dashboard data comes straight from the rule-based tool;
  only the chat uses the LLM.

  | Endpoint | Backed by |
  |---|---|
  | `GET /api/students` | `tools.list_all_students` |
  | `GET /api/students/{id}` | `tools.check_student_progress` |
  | `GET /api/at-risk` | `tools.list_at_risk_students` |
  | `GET /api/knowledge-base` | `data/knowledge_base/*.txt` |
  | `POST /api/chat` | `agent.ask_with_sources` |
  | `GET /api/health` | whether `GEMINI_API_KEY` is set |

## Setup

### 1. Install dependencies

```powershell
pip install -r requirements.txt
```

### 2. Generate the synthetic student dataset

```powershell
python generate_student_data.py
```

This creates `data/student_records.csv` (60 fictional students; no real
student data is used).

### 3. Knowledge base documents

Programme documents already live in `data/knowledge_base/`:
`course_descriptions.txt`, `programme_structure.txt`, `progression_rules.txt`.
`rag.py` builds the vector index from these automatically on first run.

### 4. Get a Gemini API key

Get a free key at https://aistudio.google.com/apikey, then copy
`.env.example` to `.env` in the project root and put your key in it:

```
GEMINI_API_KEY=your-key-here
```

`.env` is gitignored, so the key never gets committed. It's loaded
automatically by `agent.py` (and so by `server.py`).

## Running

Test each layer independently:

```powershell
python tools.py     # rule-based classifier self-test + at-risk list
python rag.py        # builds the Chroma index, runs a test retrieval
python agent.py      # runs the full agent on two sample questions
```

Run the full app:

```powershell
python server.py
```

Then open http://localhost:8000. If `data/student_records.csv` doesn't exist
yet, the server generates it on startup.

Demo sign-ins:

- **Student** — any student ID from `data/student_records.csv`
  (e.g. `10910001`), password `ugbs2026`
- **Advisor** — username `zaydan`, password `advisor2026`

The advisor dashboard works without a Gemini API key (rule-based only); the
chat requires it.

## Deploying (Render free tier)

The app fits in Render's free 512 MB instance: embeddings run through ONNX
Runtime rather than PyTorch (about 270 MB in use).

1. On render.com, create a **Web Service** from this GitHub repo.
2. Settings: runtime **Python 3**, build command
   `pip install -r requirements.txt`, start command `python server.py`,
   instance type **Free**.
3. Environment variables: `GEMINI_API_KEY` (your key) and
   `PYTHON_VERSION` = `3.13.5`.

Render sets `PORT`, and the server listens on it automatically. Free
instances sleep after 15 minutes idle; the first visit afterwards takes
about a minute.

## Project structure

```
agent.py                     # Gemini agent orchestrator (tool calling)
server.py                    # FastAPI server: JSON API + serves web/
web/                         # Web interface (HTML/CSS/JS)
rag.py                       # Knowledge base indexing + retrieval
tools.py                     # Rule-based student progress classifier
generate_student_data.py     # Synthetic student dataset generator
requirements.txt             # Python dependencies
data/
  knowledge_base/*.txt       # Programme documents (source for RAG)
  student_records.csv        # Generated synthetic student data (gitignored)
chroma_db/                   # Generated vector index (gitignored)
```
