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
- **Interface** — `app.py` is a Streamlit app with two tabs: a student
  chat (talks to the agent) and an advisor dashboard (talks to the
  rule-based tool directly, no LLM involved).

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

Get a free key at https://aistudio.google.com/apikey, then set it for your
terminal session:

```powershell
$env:GEMINI_API_KEY="your-key-here"
```

This only lasts for the current terminal session — set it again next time
you open a new one.

## Running

Test each layer independently:

```powershell
python tools.py     # rule-based classifier self-test + at-risk list
python rag.py        # builds the Chroma index, runs a test retrieval
python agent.py      # runs the full agent on two sample questions
```

Run the full app:

```powershell
python -m streamlit run app.py
```

Opens at http://localhost:8501. The Advisor Dashboard tab works without a
Gemini API key (rule-based only); the Student Chat tab requires it.

## Project structure

```
agent.py                     # Gemini agent orchestrator (tool calling)
app.py                       # Streamlit interface
rag.py                       # Knowledge base indexing + retrieval
tools.py                     # Rule-based student progress classifier
generate_student_data.py     # Synthetic student dataset generator
requirements.txt             # Python dependencies
data/
  knowledge_base/*.txt       # Programme documents (source for RAG)
  student_records.csv        # Generated synthetic student data (gitignored)
chroma_db/                   # Generated vector index (gitignored)
```
