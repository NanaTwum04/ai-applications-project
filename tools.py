"""
The rule-based progress-check tool (Section 7.2 / Section 8: TOOLS layer).

Applies the department's actual progression rules (see
data/knowledge_base/progression_rules.txt) to the synthetic student
records to classify each student as on_track, borderline, or at_risk,
with a plain-language reason attached.

This is deliberately NOT machine learning and NOT an LLM call: it is a
transparent, deterministic set of threshold checks that mirrors written
policy, which is what Section 7.2 of the report argues is the right
choice for this sub-problem.
"""

from pathlib import Path
import pandas as pd

PROJECT_ROOT = Path(__file__).parent
STUDENT_RECORDS = PROJECT_ROOT / "data" / "student_records.csv"

# Thresholds taken directly from data/knowledge_base/progression_rules.txt
MIN_GPA_TO_PROGRESS = 1.50
BORDERLINE_GPA_CEILING = 2.00
MAX_CREDIT_SHORTFALL_AT_RISK = 8
MAX_CREDIT_SHORTFALL_BORDERLINE = 4
GPA_DECLINE_THRESHOLD = 0.5  # semester_1 -> semester_4 drop considered a "declining trend"


def _load_students():
    return pd.read_csv(STUDENT_RECORDS, dtype={"student_id": str})


def classify_student(row):
    """Apply the rule-based classification to a single student record (a pandas Series)."""
    reasons = []
    status = "on_track"

    credits_behind = row["credits_required_to_date"] - row["credits_completed"]
    gpa_drop = row["semester_1_gpa"] - row["semester_4_gpa"]

    # --- AT RISK conditions (highest priority) ---
    if row["cumulative_gpa"] < MIN_GPA_TO_PROGRESS:
        status = "at_risk"
        reasons.append(
            f"Cumulative GPA {row['cumulative_gpa']:.2f} is below the "
            f"{MIN_GPA_TO_PROGRESS:.2f} progression threshold (academic probation)."
        )

    if row["num_failed_courses"] >= 2:
        status = "at_risk"
        reasons.append(
            f"{row['num_failed_courses']} core courses failed "
            f"({row['failed_courses'].replace(';', ', ')}); retake policy allows a maximum of two "
            f"attempts before Head of Department referral."
        )

    if credits_behind > MAX_CREDIT_SHORTFALL_AT_RISK:
        status = "at_risk"
        reasons.append(
            f"{credits_behind} credit hours behind the expected total for "
            f"Year {row['year']}, exceeding the {MAX_CREDIT_SHORTFALL_AT_RISK}-credit "
            f"threshold for delayed-graduation risk."
        )

    # --- BORDERLINE conditions (only apply if not already at_risk) ---
    if status != "at_risk":
        if row["cumulative_gpa"] < BORDERLINE_GPA_CEILING:
            status = "borderline"
            reasons.append(
                f"Cumulative GPA {row['cumulative_gpa']:.2f} is low enough to "
                f"warrant monitoring, though still above the probation threshold."
            )

        if row["num_failed_courses"] == 1:
            status = "borderline"
            reasons.append(
                f"One core course failed ({row['failed_courses']}); should be "
                f"retaken at the next opportunity."
            )

        if credits_behind > MAX_CREDIT_SHORTFALL_BORDERLINE:
            status = "borderline"
            reasons.append(
                f"{credits_behind} credit hours behind the expected total for Year {row['year']}."
            )

        if gpa_drop > GPA_DECLINE_THRESHOLD:
            status = "borderline"
            reasons.append(
                f"GPA has declined by {gpa_drop:.2f} points from semester 1 "
                f"({row['semester_1_gpa']:.2f}) to semester 4 ({row['semester_4_gpa']:.2f}), "
                f"a downward trend worth discussing even though the current GPA "
                f"is not yet critical."
            )

    if not reasons:
        reasons.append("No progression rule thresholds triggered; performance is on track.")

    return status, reasons


def check_student_progress(student_id):
    """TOOL: look up one student by ID and return their classification + reasons.

    This is the function the AI agent calls when a student or advisor asks
    something like "am I on track to graduate?" or "how is student 10910007 doing?"
    """
    df = _load_students()
    match = df[df["student_id"] == str(student_id)]
    if match.empty:
        return {"found": False, "error": f"No student found with ID {student_id}."}

    row = match.iloc[0]
    status, reasons = classify_student(row)

    return {
        "found": True,
        "student_id": row["student_id"],
        "name": f"{row['first_name']} {row['last_name']}",
        "year": int(row["year"]),
        "advisor": row["advisor"],
        "cumulative_gpa": float(row["cumulative_gpa"]),
        "status": status,
        "reasons": reasons,
    }


def list_at_risk_students(include_borderline=True):
    """TOOL: return every student flagged at_risk (and optionally borderline),
    for the advisor dashboard. Sorted worst-first by cumulative GPA.
    """
    df = _load_students()
    results = []
    for _, row in df.iterrows():
        status, reasons = classify_student(row)
        if status == "at_risk" or (include_borderline and status == "borderline"):
            results.append({
                "student_id": row["student_id"],
                "name": f"{row['first_name']} {row['last_name']}",
                "year": int(row["year"]),
                "advisor": row["advisor"],
                "cumulative_gpa": float(row["cumulative_gpa"]),
                "status": status,
                "reasons": reasons,
            })

    # Sort: at_risk before borderline, then lowest GPA first within each group
    status_order = {"at_risk": 0, "borderline": 1}
    results.sort(key=lambda r: (status_order[r["status"]], r["cumulative_gpa"]))
    return results


def list_all_students():
    """Return every student record with its classification, for the web
    dashboard (which needs the full roster, not just flagged students).
    """
    df = _load_students()
    students = []
    for _, row in df.iterrows():
        status, reasons = classify_student(row)
        failed = row["failed_courses"]
        students.append({
            "student_id": row["student_id"],
            "name": f"{row['first_name']} {row['last_name']}",
            "year": int(row["year"]),
            "advisor": row["advisor"],
            "sem_gpas": [float(row[f"semester_{i}_gpa"]) for i in range(1, 5)],
            "cumulative_gpa": float(row["cumulative_gpa"]),
            "failed_courses": failed.split(";") if isinstance(failed, str) and failed else [],
            "credits_completed": int(row["credits_completed"]),
            "credits_required_to_date": int(row["credits_required_to_date"]),
            "status": status,
            "reasons": reasons,
        })
    return students


if __name__ == "__main__":
    # Quick self-test: validate our rule-based flags against the ground-truth
    # profile_label baked into the synthetic dataset (see generate_student_data.py).
    df = _load_students()
    correct = 0
    for _, row in df.iterrows():
        status, _ = classify_student(row)
        # Treat "borderline" and "at_risk" both as "flagged" for a simplified check
        predicted_flagged = status in ("borderline", "at_risk")
        actual_flagged = row["profile_label"] in ("borderline", "at_risk")
        if predicted_flagged == actual_flagged:
            correct += 1

    print(f"Rule-based flagging agrees with ground-truth profile on "
          f"{correct}/{len(df)} students ({100*correct/len(df):.1f}%).")

    print("\nAt-risk / borderline students (advisor view):\n")
    for s in list_at_risk_students():
        print(f"- {s['name']} ({s['student_id']}, Year {s['year']}, {s['status'].upper()}, "
              f"GPA {s['cumulative_gpa']:.2f})")
        for r in s["reasons"]:
            print(f"    - {r}")
