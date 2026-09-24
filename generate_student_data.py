"""
Generates a synthetic student records dataset for the OMIS 404 project
(Scenario 12: Departmental Academic Advising and Student Progress Support).

This is entirely made-up data: realistic Ghanaian names and UGBS-style
student IDs, but no real student is represented here.
"""

import random
import csv
from pathlib import Path

SEED = 42  # reproducible output

OUTPUT = Path(__file__).parent / "data" / "student_records.csv"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

# --- Name pools (realistic Ghanaian first/last names) -----------------
FIRST_NAMES = [
    "Kwame", "Ama", "Kofi", "Akosua", "Yaw", "Abena", "Kwabena", "Efua",
    "Kwaku", "Adjoa", "Kwadwo", "Akua", "Kwesi", "Esi", "Nana", "Adwoa",
    "Kojo", "Afia", "Yaa", "Fiifi", "Nii", "Naa", "Selorm", "Elorm",
    "Mawusi", "Delali", "Sena", "Dzifa", "Kekeli", "Enam", "Kwamena",
    "Araba", "Ohemaa", "Baaba", "Aku", "Serwaa", "Adom", "Nhyira",
]

LAST_NAMES = [
    "Osei", "Mensah", "Boateng", "Owusu", "Asante", "Agyeman", "Appiah",
    "Adjei", "Amankwah", "Darko", "Frimpong", "Sarpong", "Yeboah",
    "Antwi", "Oduro", "Amoah", "Tetteh", "Addo", "Bonsu", "Ofori",
    "Twum", "Nkrumah", "Prempeh", "Danso", "Acheampong", "Ampofo",
    "Gyamfi", "Kusi", "Sackey", "Lartey", "Aidoo", "Quaye", "Kumi",
]

# --- Programme structure -----------------------------------------------
# Core courses by year for the Data Science & Business Analytics programme
CORE_COURSES = {
    1: ["OMIS 101", "OMIS 104", "STAT 111", "ACCT 101"],
    2: ["OMIS 201", "OMIS 204", "STAT 212", "OMIS 210"],
    3: ["OMIS 301", "OMIS 305", "OMIS 308", "STAT 314"],
    4: ["OMIS 401", "OMIS 404", "OMIS 407", "OMIS 410"],
}

ADVISORS = [
    "Dr. Ohene-Asare", "Dr. Nyarko", "Dr. Ansah", "Mrs. Aryeetey",
]

def make_student_id(index):
    # UGBS-style numeric ID, e.g. 10912345
    return f"109{10000 + index}"

def generate_gpa_trend(profile):
    """Generate a semester-by-semester GPA list based on a student's profile."""
    if profile == "on_track":
        base = random.uniform(3.0, 3.9)
        return [round(min(4.0, max(0.0, base + random.uniform(-0.2, 0.2))), 2) for _ in range(4)]
    elif profile == "at_risk":
        base = random.uniform(1.2, 1.9)
        return [round(min(4.0, max(0.0, base + random.uniform(-0.3, 0.3))), 2) for _ in range(4)]
    else:  # borderline
        base = random.uniform(2.0, 2.5)
        # declining trend to make it a genuinely ambiguous/complex case
        trend = [round(min(4.0, max(0.0, base - i * 0.15 + random.uniform(-0.1, 0.1))), 2) for i in range(4)]
        return trend

def generate_student(index, profile, year):
    first = random.choice(FIRST_NAMES)
    last = random.choice(LAST_NAMES)
    student_id = make_student_id(index)
    advisor = random.choice(ADVISORS)

    gpa_trend = generate_gpa_trend(profile)
    cumulative_gpa = round(sum(gpa_trend) / len(gpa_trend), 2)

    # Determine failed/retaken courses based on profile
    eligible_courses = [c for y in range(1, year + 1) for c in CORE_COURSES[y]]
    if profile == "at_risk":
        failed_courses = random.sample(eligible_courses, k=min(2, len(eligible_courses)))
    elif profile == "borderline":
        failed_courses = random.sample(eligible_courses, k=min(1, len(eligible_courses)))
    else:
        failed_courses = []

    credits_required = year * 32  # assume 32 credits/year target
    if profile == "on_track":
        credits_completed = credits_required - random.randint(0, 4)
    elif profile == "at_risk":
        credits_completed = credits_required - random.randint(10, 20)
    else:
        credits_completed = credits_required - random.randint(4, 10)
    credits_completed = max(0, credits_completed)

    return {
        "student_id": student_id,
        "first_name": first,
        "last_name": last,
        "year": year,
        "advisor": advisor,
        "semester_1_gpa": gpa_trend[0],
        "semester_2_gpa": gpa_trend[1],
        "semester_3_gpa": gpa_trend[2],
        "semester_4_gpa": gpa_trend[3],
        "cumulative_gpa": cumulative_gpa,
        "failed_courses": ";".join(failed_courses) if failed_courses else "",
        "num_failed_courses": len(failed_courses),
        "credits_completed": credits_completed,
        "credits_required_to_date": credits_required,
        "profile_label": profile,  # ground-truth label, for us to validate flagging logic against
    }

def main():
    # Seed here rather than at import time: when the server imports this
    # module, other libraries imported afterwards consume random numbers,
    # which would otherwise produce a different dataset on each host.
    random.seed(SEED)
    rows = []
    index = 1

    # 60 students total, spread across years 1-4, with a realistic mix:
    # ~70% on_track, ~18% borderline, ~12% at_risk
    total_students = 60
    n_at_risk = round(total_students * 0.12)
    n_borderline = round(total_students * 0.18)
    n_on_track = total_students - n_at_risk - n_borderline

    profiles = (["on_track"] * n_on_track) + (["borderline"] * n_borderline) + (["at_risk"] * n_at_risk)
    random.shuffle(profiles)

    for profile in profiles:
        year = random.choice([1, 2, 3, 4])
        rows.append(generate_student(index, profile, year))
        index += 1

    with open(OUTPUT, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)

    print(f"Generated {len(rows)} synthetic student records -> {OUTPUT}")
    print(f"  on_track: {n_on_track}, borderline: {n_borderline}, at_risk: {n_at_risk}")

if __name__ == "__main__":
    main()
