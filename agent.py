"""
The AI System / Agent Orchestrator (Section 8).

Uses the Gemini API with function calling (tool use) to decide, per message,
whether to:
  (a) retrieve a passage from the knowledge base (RAG),
  (b) call the rule-based progress-check tool on real student data, or
  (c) both,
before composing a final natural-language answer.

Requires a GEMINI_API_KEY environment variable (get one free at
https://aistudio.google.com/apikey).
"""

import os
import json
from google import genai
from google.genai import types

from rag import retrieve
from tools import check_student_progress, list_at_risk_students

MODEL_NAME = "gemini-3.6-flash"

SYSTEM_INSTRUCTION = """You are the academic advising assistant for the Data Science
and Business Analytics Department at the University of Ghana Business School (UGBS).

You help students with questions about courses, prerequisites, progression rules,
and their own academic standing. You help advisors identify students who need
attention.

CRITICAL RULES:
1. Never guess or make up prerequisite, credit, or progression information. Always
   call retrieve_knowledge_base first to look it up in the real programme documents,
   then answer based on what it returns.
2. If a question is about a SPECIFIC student's own progress, GPA, or whether they
   are on track, call check_student_progress with their student ID. Never guess a
   student's academic standing.
3. If asked for a list of students needing attention (an advisor-style question),
   call list_at_risk_students.
4. If the knowledge base retrieval does not contain an answer to the question,
   say so honestly rather than inventing an answer. Do not fabricate rules,
   course codes, or numbers that were not returned by a tool.
5. Keep answers concise, direct, and in plain language a student or advisor would
   actually want to read.
"""

TOOLS = [
    types.Tool(function_declarations=[
        types.FunctionDeclaration(
            name="retrieve_knowledge_base",
            description=(
                "Search the department's programme documents (course structure, "
                "prerequisites, progression rules, course descriptions) for "
                "passages relevant to a question."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query, based on the user's question."}
                },
                "required": ["query"],
            },
        ),
        types.FunctionDeclaration(
            name="check_student_progress",
            description=(
                "Look up a specific student's academic standing (GPA, failed "
                "courses, credits, and whether they are on_track, borderline, "
                "or at_risk with reasons) by their student ID."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "student_id": {"type": "string", "description": "The student's ID number."}
                },
                "required": ["student_id"],
            },
        ),
        types.FunctionDeclaration(
            name="list_at_risk_students",
            description=(
                "Return the full list of students currently flagged as "
                "at_risk or borderline, sorted worst-first, each with reasons. "
                "Use this for advisor-facing questions like 'who needs my "
                "attention this week?'"
            ),
            parameters={"type": "object", "properties": {}},
        ),
    ])
]


def _call_tool(name, args):
    if name == "retrieve_knowledge_base":
        hits = retrieve(args["query"])
        return {"results": [{"source": h["source"], "text": h["text"]} for h in hits]}
    elif name == "check_student_progress":
        return check_student_progress(args["student_id"])
    elif name == "list_at_risk_students":
        return {"students": list_at_risk_students()}
    else:
        return {"error": f"Unknown tool {name}"}


def ask(user_message, history=None):
    """Send a message to the agent, letting it call tools as needed, and
    return the final natural-language answer.

    `history` is an optional list of prior {"role": ..., "text": ...} turns
    for basic conversational context.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY environment variable is not set. "
            "Get a free key at https://aistudio.google.com/apikey"
        )

    client = genai.Client(api_key=api_key)

    contents = []
    if history:
        for turn in history:
            role = "user" if turn["role"] == "user" else "model"
            contents.append(types.Content(role=role, parts=[types.Part(text=turn["text"])]))
    contents.append(types.Content(role="user", parts=[types.Part(text=user_message)]))

    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION,
        tools=TOOLS,
    )

    # Allow a few rounds of tool calling before forcing a final answer.
    for _ in range(5):
        response = client.models.generate_content(
            model=MODEL_NAME, contents=contents, config=config
        )
        candidate = response.candidates[0]
        function_calls = [
            part.function_call for part in candidate.content.parts if part.function_call
        ]

        if not function_calls:
            return response.text

        contents.append(candidate.content)
        tool_response_parts = []
        for fc in function_calls:
            result = _call_tool(fc.name, dict(fc.args))
            tool_response_parts.append(
                types.Part.from_function_response(name=fc.name, response=result)
            )
        contents.append(types.Content(role="user", parts=tool_response_parts))

    return "I wasn't able to complete that request after several tool calls. Please rephrase your question."


if __name__ == "__main__":
    print(ask("What are the prerequisites for OMIS 301?"))
    print()
    print(ask("Is student 10910040 on track to graduate?"))
