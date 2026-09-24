/* =========================================================
   UGBS Academic Advising & Student Progress Support
   Front end for the Python backend (server.py):
     - GET  /api/students        → tools.py rule-based classifier
                                   over data/student_records.csv
     - GET  /api/knowledge-base  → the programme documents rag.py indexes
     - POST /api/chat            → agent.py (Gemini + RAG + tools)
   ========================================================= */

(function () {
  "use strict";

  /* =========================================================
     1-4. BACKEND API
     Student records, their classification, the knowledge base
     and all question answering come from the server.
     ========================================================= */

  // Filled in by boot() from the API.
  let STUDENT_RECORDS = [];
  let KB_DOCS = [];

  async function apiGet(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return res.json();
  }

  // Classification is done server-side by tools.classify_student; each
  // record already carries its status and reasons.
  function classifyStudent(s) {
    return { status: s.status, reasons: s.reasons };
  }

  // Ask the agent. `history` is this thread's prior {role, text} turns;
  // `studentId` is the signed-in student, if any.
  async function answerQuestion(question, history, studentId) {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, history: history || [], student_id: studentId || null })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          text: data.detail || `The advising service returned an error (${res.status}).`,
          sources: [],
          declined: true
        };
      }
      return { text: data.answer || "", sources: data.sources || [], declined: false };
    } catch (e) {
      return {
        text: "I couldn't reach the advising server. Make sure server.py is running.",
        sources: [],
        declined: true
      };
    }
  }

  function recordTurn(history, question, answer) {
    if (answer.declined) return;
    history.push({ role: "user", text: question }, { role: "assistant", text: answer.text });
  }

  /* =========================================================
     5. ICONS
     ========================================================= */
  const ICONS = {
    bot: '<svg class="icon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M9 4h6M9 14h.01M15 14h.01"/></svg>',
    user: '<svg class="icon" viewBox="0 0 24 24"><path d="M20 21a8 8 0 1 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg>',
    doc: '<svg class="icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    alert: '<svg class="icon" viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0ZM12 9v4M12 17h.01"/></svg>',
    check: '<svg class="icon" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    cross: '<svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    chevron: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    sparkle: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2"/></svg>'
  };

  /* =========================================================
     6. AUTHENTICATION
     ========================================================= */
  // Students sign in with their student ID from student_records.csv and
  // the shared demo password; advisors use the fixed demo accounts.
  const STUDENT_PASSWORD = "ugbs2026";
  const ACCOUNTS = {
    advisor: [
      { username: "zaydan", password: "advisor2026", name: "Zaydan Abass", title: "Academic Advisor" },
      { username: "admin",  password: "advisor2026", name: "Demo Advisor", title: "Senior Advisor" }
    ]
  };

  const SESSION_KEY = "ugbs.advising.session";
  const AUTH_ICONS = {
    student: '<svg class="icon" viewBox="0 0 24 24"><path d="M20 21a8 8 0 1 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg>',
    advisor: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 17l5-5 4 4 8-8M14 8h6v6"/></svg>'
  };

  let pendingRole = null;

  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); }
    catch { return null; }
  }
  function saveSession(s) { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
  function clearSession() { sessionStorage.removeItem(SESSION_KEY); }

  function enterRoleView(session) {
    if (!session || !session.role) return;
    if (session.role === "student") {
      const sel = document.getElementById("student-identity");
      if (sel) { sel.value = session.name; sel.disabled = true; }
      showScreen("student");
    } else {
      const nameEl = document.getElementById("advisor-name");
      const titleEl = document.getElementById("advisor-title");
      const avatarEl = document.getElementById("advisor-avatar");
      if (nameEl) nameEl.textContent = session.name;
      if (titleEl) titleEl.textContent = session.title || "Academic Advisor";
      if (avatarEl) {
        avatarEl.textContent = (session.name || "AD")
          .split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
      }
      try { renderRiskList(); } catch (e) {}
      try { renderLogTable(); } catch (e) {}
      showScreen("advisor");
    }
  }

  const roleChooser = document.getElementById("role-chooser");
  const loginPanel  = document.getElementById("login-panel");
  const loginForm   = document.getElementById("login-form");
  const loginUser   = document.getElementById("login-username");
  const loginPass   = document.getElementById("login-password");
  const loginError  = document.getElementById("login-error");
  const loginTitle  = document.getElementById("login-title");
  const loginSub    = document.getElementById("login-sub");
  const loginAvatar = document.getElementById("login-avatar");
  const loginDemo   = document.getElementById("login-demo");
  const pwToggle    = document.getElementById("pw-toggle");
  const loginBack   = document.getElementById("login-back");

  function showLogin(role) {
    pendingRole = role;
    loginTitle.textContent = role === "student" ? "Student sign in" : "Advisor sign in";
    loginSub.textContent = role === "student"
      ? "Sign in with your UGBS student credentials."
      : "Sign in with your departmental advisor credentials.";
    loginAvatar.innerHTML = AUTH_ICONS[role];
    loginUser.previousElementSibling.textContent = role === "student" ? "Student ID" : "Username";
    const demoStudent = STUDENT_RECORDS[0] ? STUDENT_RECORDS[0].student_id : "10910001";
    loginDemo.innerHTML = role === "student"
      ? `Demo credentials &mdash; any student ID, e.g. <code>${demoStudent}</code> &middot; password <code>${STUDENT_PASSWORD}</code>`
      : `Demo credentials &mdash; username <code>zaydan</code> &middot; password <code>advisor2026</code>`;
    loginError.textContent = "";
    loginError.classList.remove("show");
    loginForm.reset();
    roleChooser.classList.add("hidden");
    loginPanel.classList.remove("hidden");
    setTimeout(() => loginUser && loginUser.focus(), 50);
  }

  function showRoleChooser() {
    pendingRole = null;
    loginPanel.classList.add("hidden");
    roleChooser.classList.remove("hidden");
  }

  document.getElementById("enter-student").addEventListener("click", () => showLogin("student"));
  document.getElementById("enter-advisor").addEventListener("click", () => showLogin("advisor"));
  loginBack.addEventListener("click", showRoleChooser);

  pwToggle.addEventListener("click", () => {
    const show = loginPass.type === "password";
    loginPass.type = show ? "text" : "password";
    pwToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    loginError.classList.remove("show");

    const u = (loginUser.value || "").trim().toLowerCase();
    const p = loginPass.value || "";
    if (!u || !p) {
      loginError.textContent = "Please enter both username and password.";
      loginError.classList.add("show");
      return;
    }

    let account;
    if (pendingRole === "student") {
      const rec = STUDENT_RECORDS.find(s => s.student_id === u);
      if (rec && p === STUDENT_PASSWORD) {
        account = { username: rec.student_id, name: rec.name, studentId: rec.student_id };
      }
    } else {
      account = (ACCOUNTS[pendingRole] || [])
        .find(a => a.username.toLowerCase() === u && a.password === p);
    }
    if (!account) {
      loginError.textContent = "Incorrect username or password. Please try again.";
      loginError.classList.add("show");
      loginPass.select();
      return;
    }

    const session = {
      role: pendingRole,
      username: account.username,
      name: account.name,
      title: account.title || null,
      studentId: account.studentId || null,
      since: Date.now()
    };
    saveSession(session);
    enterRoleView(session);
  });

  document.querySelectorAll("[data-signout]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      clearSession();
      const sel = document.getElementById("student-identity");
      if (sel) sel.disabled = false;
      showRoleChooser();
      showScreen("landing");
    });
  });

    document.querySelectorAll("[data-switch-role]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      // Same behaviour as sign-out: clear session and return to the chooser.
      clearSession();
      const sel = document.getElementById("student-identity");
      if (sel) sel.disabled = false;
      showRoleChooser();
      showScreen("landing");
    });
  });

  /* =========================================================
     7. SCREEN SWITCHING
     ========================================================= */
  const screens = {
    landing: document.getElementById("landing-screen"),
    student: document.getElementById("student-screen"),
    advisor: document.getElementById("advisor-screen")
  };

  function showScreen(name) {
    Object.values(screens).forEach((el) => el.classList.add("hidden"));
    screens[name].classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  /* =========================================================
     8. STUDENT SCREEN
     ========================================================= */
  const identitySelect = document.getElementById("student-identity");
  function populateIdentitySelect() {
    STUDENT_RECORDS.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.name;
      opt.textContent = `${s.name} \u2014 ${s.student_id}`;
      identitySelect.appendChild(opt);
    });
  }

  const QUICK_FILLS = [
    { label: "Normal: probation CGPA", icon: ICONS.check,
      question: "What CGPA do I need to stay off academic probation?" },
    { label: "Complex: prerequisite + retake", icon: ICONS.sparkle,
      question: "I already failed OMIS 204 once \u2014 can I still register for OMIS 308 next semester, and how many times am I allowed to retake OMIS 204?" },
    { label: "Student lookup", icon: ICONS.user,
      question: "Is student 10910006 on track to graduate?" },
    { label: "Failure case: outside policy", icon: ICONS.alert,
      question: "Can I get a refund if I lose my student ID card?" }
  ];

  const quickfillRow = document.getElementById("quickfill-row");
  QUICK_FILLS.forEach((q) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quickfill-btn";
    btn.innerHTML = `${q.icon}<span>${q.label}</span>`;
    btn.addEventListener("click", () => {
      chatInput.value = q.question;
      chatInput.focus();
    });
    quickfillRow.appendChild(btn);
  });

  const chatThread = document.getElementById("chat-thread");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");

  function addMessage(role, html, extraClass) {
    const wrap = document.createElement("div");
    wrap.className = `msg ${role}`;
    wrap.innerHTML = `
      <span class="msg-avatar">${role === "user" ? ICONS.user : ICONS.bot}</span>
      <div class="msg-bubble${extraClass ? " " + extraClass : ""}">${html}</div>
    `;
    chatThread.appendChild(wrap);
    chatThread.scrollTop = chatThread.scrollHeight;
    return wrap;
  }

  function greet() {
    addMessage("assistant",
      "Hello! I'm the departmental advising assistant. Ask me about courses, prerequisites, " +
      "credits, retakes, probation, deferment or electives \u2014 I'll answer strictly from UGBS " +
      "programme documents. You can also ask about a specific student by ID " +
      "(e.g. \"Is student 10910006 on track?\").");
  }
  greet();

  // Minimal markdown for agent answers: **bold**, headings, bullet and
  // numbered lists, paragraphs. Input is escaped before any tags are added.
  function renderMarkdown(text) {
    const inline = s => escapeHTML(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const out = [];
    let list = null; // "ul" | "ol"
    let para = [];
    const flushPara = () => { if (para.length) { out.push(`<p class="md-p">${para.join("<br>")}</p>`); para = []; } };
    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

    String(text).split("\n").forEach(line => {
      const bullet = line.match(/^\s*[*-]\s+(.*)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
      if (bullet || numbered) {
        const type = bullet ? "ul" : "ol";
        flushPara();
        if (list !== type) { closeList(); out.push(`<${type} class="md-list">`); list = type; }
        out.push(`<li>${inline((bullet || numbered)[1])}</li>`);
      } else if (heading) {
        flushPara(); closeList();
        out.push(`<p class="md-p"><strong>${inline(heading[1])}</strong></p>`);
      } else if (!line.trim()) {
        flushPara(); closeList();
      } else {
        closeList();
        para.push(inline(line));
      }
    });
    flushPara(); closeList();
    return out.join("");
  }

  function renderBubble(text, sources, declined) {
    let html = renderMarkdown(text);
    if (sources && sources.length) {
      html += `<div class="msg-source">${ICONS.doc} Source${sources.length > 1 ? "s" : ""}: ${sources.join(" &amp; ")}</div>`;
    }
    return html;
  }

  const studentChatHistory = [];

  chatForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    const question = chatInput.value.trim();
    if (!question) return;
    const studentName = identitySelect.value;

    addMessage("user", escapeHTML(question));
    chatInput.value = "";
    const pending = addMessage("assistant", "Thinking…");

    const session = loadSession();
    const answer = await answerQuestion(question, studentChatHistory, session && session.studentId);
    pending.remove();
    addMessage("assistant", renderBubble(answer.text, answer.sources, answer.declined),
               answer.declined ? "declined" : "");
    recordTurn(studentChatHistory, question, answer);

    questionLog.unshift({
      studentName,
      question,
      status: answer.declined ? "declined" : "answered",
      sourceTitles: answer.sources
    });

    renderRiskList();
    renderLogTable();
  });

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /* =========================================================
     9. ADVISOR — risk list + log table
     The web risk list uses the *same* rule-based classifier
     as the Python tool, so both sides agree.
     ========================================================= */
  const questionLog = [];
  const riskListEl = document.getElementById("risk-list");
  const logBodyEl = document.getElementById("log-body");

  function computeRisk(student) {
    // Map the Python classifier output into the web prototype's scoring shape.
    const rec = STUDENT_RECORDS.find(r => r.name === student.name) || null;
    let tier = "low";
    let score = 0;
    const reasons = [];

    if (rec) {
      const { status, reasons: pyReasons } = classifyStudent(rec);
      reasons.push(...pyReasons);
      if (status === "at_risk") { tier = "high"; score = 60; }
      else if (status === "borderline") { tier = "watch"; score = 30; }
      else { tier = "low"; score = 5; }
    }

    // Small boost for repeat-fail asks in the question log
    const repeatCount = questionLog.filter(l =>
      l.studentName === student.name && /\b(fail|failed|retake|retaking)\b/i.test(l.question)
    ).length;
    if (repeatCount >= 2) {
      score += 10;
      reasons.push(`Asked ${repeatCount} questions this session about failing/retaking a course.`);
      if (tier === "low") tier = "watch";
    }

    return { score, tier, reasons };
  }

  function statusOf(student) {
    const rec = STUDENT_RECORDS.find(r => r.name === student.name);
    if (!rec) return "On Track";
    const { status } = classifyStudent(rec);
    return status === "at_risk" ? "Needs Review"
         : status === "borderline" ? "Watch"
         : "On Track";
  }
  function statusClass(s) {
    return s === "On Track" ? "on-track" : s === "Watch" ? "watch" : "review";
  }

  function renderRiskList() {
    if (!riskListEl) return;
    const ranked = STUDENT_RECORDS
      .map(rec => {
        const fakeStudent = { name: rec.name };
        return { rec, risk: computeRisk(fakeStudent) };
      })
      .sort((a, b) => b.risk.score - a.risk.score);

    riskListEl.innerHTML = "";
    ranked.forEach((entry, index) => {
      const { rec, risk } = entry;
      const item = document.createElement("div");
      item.className = "risk-item";

      const reasonsHTML = risk.reasons.length
        ? risk.reasons.map(r => `<li>${ICONS.alert}<span>${r}</span></li>`).join("")
        : `<li class="none">No active risk factors currently.</li>`;

      item.innerHTML = `
        <button class="risk-summary" type="button" aria-expanded="false">
          <span class="risk-rank">${index + 1}</span>
          <span class="risk-name-block">
            <span class="name">${rec.name}</span>
            <span class="meta">${rec.student_id} &middot; Year ${rec.year} &middot; CGPA ${rec.cumulative_gpa.toFixed(2)}</span>
          </span>
          <span class="risk-score-badge ${risk.tier === "high" ? "high" : risk.tier === "watch" ? "watch" : "low"}">Score ${risk.score}</span>
          <span class="risk-chevron">${ICONS.chevron}</span>
        </button>
        <div class="risk-detail">
          <p>Why this score</p>
          <ul class="risk-reasons">${reasonsHTML}</ul>
        </div>
      `;

      const summaryBtn = item.querySelector(".risk-summary");
      summaryBtn.addEventListener("click", () => {
        const isOpen = item.classList.toggle("open");
        summaryBtn.setAttribute("aria-expanded", String(isOpen));
      });

      riskListEl.appendChild(item);
    });
  }

  function renderLogTable() {
    if (!logBodyEl) return;
    if (questionLog.length === 0) {
      logBodyEl.innerHTML = `<tr class="log-empty"><td colspan="4">No questions asked yet this session.</td></tr>`;
      return;
    }
    logBodyEl.innerHTML = questionLog.map((entry) => {
      const statusHTML = entry.status === "answered"
        ? `<span class="status-chip answered">${ICONS.check} Answered from policy</span>`
        : `<span class="status-chip declined">${ICONS.cross} Declined</span>`;
      const sources = entry.sourceTitles.length ? entry.sourceTitles.join(" & ") : "\u2014";
      return `
        <tr>
          <td>${escapeHTML(entry.studentName)}</td>
          <td>${escapeHTML(entry.question)}</td>
          <td>${statusHTML}</td>
          <td class="log-sources">${escapeHTML(sources)}</td>
        </tr>
      `;
    }).join("");
  }

  /* =========================================================
     10. ADVISOR DASHBOARD
     ========================================================= */
  function renderStatCards() {
    const grid = document.getElementById("stat-grid");
    if (!grid) return;
    const total = STUDENT_RECORDS.length;
    const counts = { "On Track": 0, "Watch": 0, "Needs Review": 0 };
    STUDENT_RECORDS.forEach(s => {
      const st = statusOf({ name: s.name });
      counts[st] = (counts[st] || 0) + 1;
    });
    const pct = n => (total ? (n / total) * 100 : 0).toFixed(1) + "%";

    const cards = [
      { label: "Total Students", value: total, foot: `<span class="stat-up">in student records</span>`, cls: "", icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/>' },
      { label: "On Track", value: counts["On Track"], foot: `<span class="stat-dot green"></span>${pct(counts["On Track"])}`, cls: "green", icon: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1 3 3 6 3s6-2 6-3v-5"/>' },
      { label: "Watch List", value: counts["Watch"], foot: `<span class="stat-dot amber"></span>${pct(counts["Watch"])}`, cls: "amber", icon: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0ZM12 9v4M12 17h.01"/>' },
      { label: "Needs Review", value: counts["Needs Review"], foot: `<span class="stat-dot red"></span>${pct(counts["Needs Review"])}`, cls: "red", icon: '<path d="M12 8v5M12 16h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>' }
    ];

    grid.innerHTML = cards.map(c => `
      <article class="stat-card ${c.cls}">
        <span class="stat-icon"><svg class="icon" viewBox="0 0 24 24">${c.icon}</svg></span>
        <span class="stat-label">${c.label}</span>
        <span class="stat-value">${c.value}</span>
        <span class="stat-foot">${c.foot}</span>
      </article>`).join("");
  }

  function barChart(host, data) {
    if (!host) return;
    const W = 320, H = 170, P = { t: 14, r: 8, b: 26, l: 30 };
    const max = Math.max(...data.map(d => d.value)) || 1;
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const bw = iw / data.length * 0.62;
    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="mini-chart">`;
    for (let i = 0; i <= 4; i++) {
      const y = P.t + (ih * i / 4);
      svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" stroke="#eef1f6" stroke-width="1"/>`;
      svg += `<text x="${P.l - 6}" y="${y + 3}" text-anchor="end" font-size="8" fill="#8c8577">${Math.round(max - (max * i / 4))}</text>`;
    }
    data.forEach((d, i) => {
      const x = P.l + (iw * i / data.length) + (iw / data.length - bw) / 2;
      const h = (d.value / max) * ih;
      const y = P.t + ih - h;
      svg += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="2" fill="#24365e"/>`;
      svg += `<text x="${x + bw / 2}" y="${y - 4}" text-anchor="middle" font-size="9" fill="#4a5578">${d.value}</text>`;
      svg += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="8" fill="#8c8577">${d.label}</text>`;
    });
    svg += `</svg>`;
    host.innerHTML = svg;
  }

  function donutChart(host, data) {
    if (!host) return;
    const W = 320, H = 180, cx = 110, cy = H / 2, r = 62, inner = 40;
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    let angle = -Math.PI / 2, paths = "";
    data.forEach(d => {
      const slice = (d.value / total) * Math.PI * 2;
      const a1 = angle, a2 = angle + slice;
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      const xi2 = cx + inner * Math.cos(a2), yi2 = cy + inner * Math.sin(a2);
      const xi1 = cx + inner * Math.cos(a1), yi1 = cy + inner * Math.sin(a1);
      const large = slice > Math.PI ? 1 : 0;
      paths += `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${inner} ${inner} 0 ${large} 0 ${xi1} ${yi1} Z" fill="${d.color}"/>`;
      angle = a2;
    });
    let legend = data.map((d, i) => `
      <g transform="translate(200 ${40 + i * 26})">
        <circle cx="5" cy="5" r="5" fill="${d.color}"/>
        <text x="18" y="9" font-size="10" fill="#131c33">${d.label}</text>
        <text x="115" y="9" font-size="10" fill="#6a7490">${((d.value / total) * 100).toFixed(1)}%</text>
      </g>`).join("");
    host.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="mini-chart">
        ${paths}
        <text x="${cx}" y="${cy + 2}" text-anchor="middle" font-size="20" font-family="Georgia,serif" fill="#131c33">${total}</text>
        <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="9" fill="#6a7490">Total Students</text>
        ${legend}
      </svg>`;
  }

  function lineChart(host, data) {
    if (!host) return;
    const W = 320, H = 170, P = { t: 16, r: 14, b: 26, l: 30 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const min = 2.0, max = 4.0;
    const pts = data.map((d, i) => ({
      x: P.l + (iw * i / (data.length - 1)),
      y: P.t + ih - ((d.value - min) / (max - min)) * ih,
      ...d
    }));
    const path = pts.map((p, i) => (i ? "L" : "M") + p.x + " " + p.y).join(" ");
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="mini-chart">`;
    for (let i = 0; i <= 4; i++) {
      const y = P.t + (ih * i / 4);
      const v = (max - (max - min) * i / 4).toFixed(1);
      svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" stroke="#eef1f6"/>`;
      svg += `<text x="${P.l - 6}" y="${y + 3}" text-anchor="end" font-size="8" fill="#8c8577">${v}</text>`;
    }
    svg += `<path d="${path}" fill="none" stroke="#24365e" stroke-width="2"/>`;
    pts.forEach(p => {
      svg += `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#fff" stroke="#24365e" stroke-width="2"/>`;
      svg += `<text x="${p.x}" y="${p.y - 9}" text-anchor="middle" font-size="9" fill="#4a5578">${p.value.toFixed(2)}</text>`;
      svg += `<text x="${p.x}" y="${H - 8}" text-anchor="middle" font-size="8" fill="#8c8577">${p.label}</text>`;
    });
    svg += `</svg>`;
    host.innerHTML = svg;
  }

  function gpaBuckets() {
    return [
      { label: "0.0\u20131.9", test: g => g < 2.0 },
      { label: "2.0\u20132.4", test: g => g >= 2.0 && g < 2.5 },
      { label: "2.5\u20132.9", test: g => g >= 2.5 && g < 3.0 },
      { label: "3.0\u20133.4", test: g => g >= 3.0 && g < 3.5 },
      { label: "3.5\u20134.0", test: g => g >= 3.5 }
    ];
  }

  function renderCharts() {
    barChart(document.getElementById("chart-gpa"), gpaBuckets().map(b => ({
      label: b.label,
      value: STUDENT_RECORDS.filter(s => b.test(s.cumulative_gpa)).length
    })));

    const counts = { "On Track": 0, "Watch": 0, "Needs Review": 0 };
    STUDENT_RECORDS.forEach(s => {
      const st = statusOf({ name: s.name });
      counts[st] = (counts[st] || 0) + 1;
    });
    donutChart(document.getElementById("chart-status"), [
      { label: "On Track",     value: counts["On Track"],     color: "#2f6d4f" },
      { label: "Watch List",   value: counts["Watch"],        color: "#c8992c" },
      { label: "Needs Review", value: counts["Needs Review"], color: "#a23b3b" }
    ]);

    const years = [1, 2, 3, 4];
    lineChart(document.getElementById("chart-level"), years.map(y => {
      const set = STUDENT_RECORDS.filter(s => s.year === y);
      const avg = set.length ? set.reduce((a, s) => a + s.cumulative_gpa, 0) / set.length : 0;
      return { label: "Year " + y, value: avg || 2 + y / 4 };
    }));
  }

  function renderStudentTable() {
    const tbody = document.getElementById("student-list-body");
    if (!tbody) return;
    const q = (document.getElementById("student-search")?.value || "").toLowerCase().trim();
    const lv = document.getElementById("filter-level")?.value || "";
    const st = document.getElementById("filter-status")?.value || "";

    const rows = STUDENT_RECORDS.filter(s => {
      const matchQ = !q || s.name.toLowerCase().includes(q) || s.student_id.includes(q);
      const matchL = !lv || ("Level " + (s.year * 100)) === lv || ("Level " + s.year) === lv;
      const status = statusOf({ name: s.name });
      const matchS = !st || status === st;
      return matchQ && matchL && matchS;
    });

    if (!rows.length) {
      tbody.innerHTML = `<tr class="log-empty"><td colspan="9">No students match the current filters.</td></tr>`;
    } else {
      tbody.innerHTML = rows.map((s, i) => {
        const stat = statusOf({ name: s.name });
        return `
          <tr>
            <td>${i + 1}</td>
            <td>${s.name}</td>
            <td>${s.student_id}</td>
            <td>Year ${s.year}</td>
            <td>Level ${s.year * 100}</td>
            <td>${s.cumulative_gpa.toFixed(2)}</td>
            <td>${s.credits_completed} / ${s.credits_required_to_date}</td>
            <td><span class="chip ${statusClass(stat)}">${stat}</span></td>
            <td><button class="btn-view" type="button" data-student="${s.student_id}">View</button></td>
          </tr>`;
      }).join("");
    }
    const countEl = document.getElementById("table-count");
    if (countEl) countEl.textContent = `Showing ${rows.length} of ${STUDENT_RECORDS.length} students`;
  }

  function downloadCSV(filename, header, rows) {
    const csv = [header, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function exportCSV() {
    const header = ["Name", "Student ID", "Year", "GPA", "Credits Completed", "Credits Expected", "Status"];
    const rows = STUDENT_RECORDS.map(s => [
      s.name, s.student_id, s.year, s.cumulative_gpa.toFixed(2),
      s.credits_completed, s.credits_required_to_date, statusOf({ name: s.name })
    ]);
    downloadCSV("ugbs-advisees.csv", header, rows);
  }

  function exportRiskReport() {
    const header = ["Rank", "Name", "ID", "Year", "CGPA", "Score", "Tier", "Reasons"];
    const ranked = STUDENT_RECORDS
      .map(rec => ({ rec, risk: computeRisk({ name: rec.name }) }))
      .sort((a, b) => b.risk.score - a.risk.score);
    const rows = ranked.map((e, i) => [
      i + 1, e.rec.name, e.rec.student_id, e.rec.year, e.rec.cumulative_gpa.toFixed(2),
      e.risk.score, e.risk.tier, e.risk.reasons.join(" | ")
    ]);
    downloadCSV("ugbs-risk-report.csv", header, rows);
  }

  function exportSessionLog() {
    const header = ["Student", "Question", "Status", "Source(s)"];
    const rows = questionLog.length ? questionLog.map(e => [
      e.studentName, e.question, e.status, e.sourceTitles.join(" | ") || "\u2014"
    ]) : [["\u2014", "No questions this session", "\u2014", "\u2014"]];
    downloadCSV("ugbs-session-log.csv", header, rows);
  }

  function showDashPage(name) {
    document.querySelectorAll(".dash-page").forEach(p => p.classList.remove("active"));
    const page = document.querySelector(`.dash-page[data-page="${name}"]`);
    if (page) page.classList.add("active");
    document.querySelectorAll(".dash-nav-link").forEach(l => {
      l.classList.toggle("active", l.dataset.page === name);
    });
    document.querySelector(".dash-main")?.scrollTo({ top: 0 });
  }

  function renderKBGrid() {
    const host = document.getElementById("kb-grid");
    if (!host) return;
    host.innerHTML = KB_DOCS.map(d => `
      <article class="kb-card">
        <span class="kb-id">${d.source}</span>
        <h4>${d.source}</h4>
        <p>${d.text.slice(0, 200)}&hellip;</p>
      </article>`).join("");
  }

  function renderProgressStats() {
    const host = document.getElementById("progress-stats");
    if (!host) return;
    const totalCredits = STUDENT_RECORDS.reduce((a, s) => a + s.credits_required_to_date, 0);
    const earned = STUDENT_RECORDS.reduce((a, s) => a + s.credits_completed, 0);
    const onTrack = STUDENT_RECORDS.filter(s => statusOf({ name: s.name }) === "On Track").length;
    const nearGrad = STUDENT_RECORDS.filter(s => s.credits_completed / s.credits_required_to_date >= 0.9).length;

    const cards = [
      { label: "Credits earned", value: earned, cls: "green" },
      { label: "Credits remaining", value: totalCredits - earned, cls: "amber" },
      { label: "On-track students", value: onTrack, cls: "" },
      { label: "Near graduation", value: nearGrad, cls: "green" }
    ];
    host.innerHTML = cards.map(c => `
      <article class="stat-card ${c.cls}">
        <span class="stat-icon"><svg class="icon" viewBox="0 0 24 24"><path d="M22 10 12 5 2 10l10 5 10-5Z"/></svg></span>
        <span class="stat-label">${c.label}</span>
        <span class="stat-value">${c.value}</span>
      </article>`).join("");
  }

  function renderProgressList() {
    const host = document.getElementById("progress-list");
    if (!host) return;
    host.innerHTML = STUDENT_RECORDS.map(s => {
      const pct = Math.round((s.credits_completed / s.credits_required_to_date) * 100);
      return `
        <div class="progress-row">
          <div class="p-name">${s.name}<small>Year ${s.year} &middot; ${s.advisor}</small></div>
          <div class="progress-bar"><i style="width:${pct}%"></i></div>
          <div class="p-pct">${s.credits_completed} / ${s.credits_required_to_date} &middot; ${pct}%</div>
        </div>`;
    }).join("");
  }

  function renderAnalytics() {
    const gpaHost = document.getElementById("analytics-gpa");
    if (!gpaHost) return;
    barChart(gpaHost, gpaBuckets().map(b => ({
      label: b.label,
      value: STUDENT_RECORDS.filter(s => b.test(s.cumulative_gpa)).length
    })));

    const counts = { "On Track": 0, "Watch": 0, "Needs Review": 0 };
    STUDENT_RECORDS.forEach(s => {
      const st = statusOf({ name: s.name });
      counts[st] = (counts[st] || 0) + 1;
    });
    donutChart(document.getElementById("analytics-status"), [
      { label: "On Track",     value: counts["On Track"],     color: "#2f6d4f" },
      { label: "Watch List",   value: counts["Watch"],        color: "#c8992c" },
      { label: "Needs Review", value: counts["Needs Review"], color: "#a23b3b" }
    ]);

    lineChart(document.getElementById("analytics-level"), [1, 2, 3, 4].map(y => {
      const set = STUDENT_RECORDS.filter(s => s.year === y);
      const avg = set.length ? set.reduce((a, s) => a + s.cumulative_gpa, 0) / set.length : 0;
      return { label: "Year " + y, value: avg || 2 + y / 4 };
    }));

    const body = document.getElementById("analytics-prog-body");
    if (body) {
      body.innerHTML = [1, 2, 3, 4].map(y => {
        const set = STUDENT_RECORDS.filter(s => s.year === y);
        if (!set.length) return "";
        const avg = set.reduce((a, s) => a + s.cumulative_gpa, 0) / set.length;
        const counts = { "On Track": 0, "Watch": 0, "Needs Review": 0 };
        set.forEach(s => counts[statusOf({ name: s.name })]++);
        return `<tr>
          <td>Year ${y}</td>
          <td>${set.length}</td>
          <td>${avg.toFixed(2)}</td>
          <td>${counts["On Track"]}</td>
          <td>${counts["Watch"]}</td>
          <td>${counts["Needs Review"]}</td>
        </tr>`;
      }).join("");
    }
  }

  function renderCoursesPage() {
    const body = document.getElementById("courses-body");
    if (!body) return;
    body.innerHTML = [1, 2, 3, 4].map(y => {
      const set = STUDENT_RECORDS.filter(s => s.year === y);
      return `<tr>
        <td>Year ${y}</td>
        <td>L${y}00</td>
        <td>${set.length}</td>
        <td>32</td>
      </tr>`;
    }).join("");
  }

  function renderStudentsPage() {
    const body = document.getElementById("students-full-body");
    if (!body) return;
    const q = (document.getElementById("students-search")?.value || "").toLowerCase().trim();
    const lv = document.getElementById("students-level")?.value || "";

    const rows = STUDENT_RECORDS.filter(s => {
      const matchQ = !q || s.name.toLowerCase().includes(q) || s.student_id.includes(q);
      const matchL = !lv || ("Level " + (s.year * 100)) === lv;
      return matchQ && matchL;
    });

    body.innerHTML = rows.length ? rows.map((s, i) => {
      const stat = statusOf({ name: s.name });
      return `<tr>
        <td>${i + 1}</td>
        <td>${s.name}</td>
        <td>${s.student_id}</td>
        <td>Year ${s.year}</td>
        <td>Level ${s.year * 100}</td>
        <td>${s.cumulative_gpa.toFixed(2)}</td>
        <td><span class="chip ${statusClass(stat)}">${stat}</span></td>
      </tr>`;
    }).join("") : `<tr class="log-empty"><td colspan="7">No students match the filters.</td></tr>`;
  }

  function renderReportsPage() {
    document.querySelectorAll(".report-card").forEach(card => {
      card.onclick = () => {
        const r = card.dataset.report;
        if (r === "session-log") exportSessionLog();
        if (r === "risk") exportRiskReport();
        if (r === "students") exportCSV();
      };
    });
  }

  function initSettings() {
    const map = {
      "set-compact": { apply: v => document.getElementById("advisor-screen").classList.toggle("compact-tables", v) },
      "set-name":    { apply: v => { const el = document.querySelector(".user-info strong"); if (el) el.textContent = v; } },
      "set-title":   { apply: v => { const el = document.querySelector(".user-info em"); if (el) el.textContent = v; } }
    };
    Object.entries(map).forEach(([id, def]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const evt = el.type === "checkbox" ? "change" : "input";
      el.addEventListener(evt, () => def.apply(el.type === "checkbox" ? el.checked : el.value));
      def.apply(el.type === "checkbox" ? el.checked : el.value);
    });

    const expandRisk = document.getElementById("set-expand-risk");
    if (expandRisk) {
      expandRisk.addEventListener("change", () => {
        document.querySelectorAll(".risk-item").forEach(item => {
          item.classList.toggle("open", expandRisk.checked);
          item.querySelector(".risk-summary")?.setAttribute("aria-expanded", String(expandRisk.checked));
        });
      });
    }
  }

  function initPageChat() {
    const form = document.getElementById("page-chat-form");
    const input = document.getElementById("page-chat-input");
    const thread = document.getElementById("page-chat-thread");
    if (!form || !thread) return;

    const welcome = document.createElement("div");
    welcome.className = "msg assistant";
    welcome.innerHTML = `<span class="msg-avatar">${ICONS.bot}</span><div class="msg-bubble">Welcome to the AI Academic Advisor console. Ask any policy question, check a specific student by ID, or ask who needs attention — every answer comes from the programme documents or the rule-based progress tool.</div>`;
    thread.appendChild(welcome);

    function appendMsg(role, html, cls) {
      const wrap = document.createElement("div");
      wrap.className = "msg " + role;
      wrap.innerHTML = `<span class="msg-avatar">${role === "user" ? ICONS.user : ICONS.bot}</span><div class="msg-bubble ${cls || ""}">${html}</div>`;
      thread.appendChild(wrap);
      thread.scrollTop = thread.scrollHeight;
      return wrap;
    }

    const history = [];
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      appendMsg("user", escapeHTML(q));
      input.value = "";
      const pending = appendMsg("assistant", "Thinking…");
      const a = await answerQuestion(q, history);
      pending.remove();
      appendMsg("assistant", renderBubble(a.text, a.sources, a.declined), a.declined ? "declined" : "");
      recordTurn(history, q, a);
      questionLog.unshift({
        studentName: "Advisor console",
        question: q,
        status: a.declined ? "declined" : "answered",
        sourceTitles: a.sources
      });
      renderLogTable(); renderRiskList();
    });
  }

  function initRailChat() {
    const form = document.getElementById("rail-form");
    const input = document.getElementById("rail-input");
    const thread = document.getElementById("advisor-chat");
    if (!form || !input || !thread) return;

    function appendRail(role, html) {
      const div = document.createElement("div");
      div.className = "rail-msg " + role;
      div.innerHTML = role === "assistant"
        ? `<span class="rail-avatar"><svg class="icon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M9 14h.01M15 14h.01"/></svg></span><div class="rail-text">${html}</div>`
        : `<div class="rail-text">${html}</div>`;
      thread.appendChild(div);
      thread.scrollTop = thread.scrollHeight;
      return div;
    }

    const history = [];
    const send = async (text) => {
      const q = (text || input.value).trim();
      if (!q) return;
      appendRail("user", escapeHTML(q));
      input.value = "";
      const pending = appendRail("assistant", "Thinking…");
      const a = await answerQuestion(q, history);
      pending.remove();
      appendRail("assistant", renderBubble(a.text, a.sources, a.declined));
      recordTurn(history, q, a);
      questionLog.unshift({
        studentName: "Advisor console",
        question: q,
        status: a.declined ? "declined" : "answered",
        sourceTitles: a.sources
      });
      renderLogTable();
      renderRiskList();
    };

    form.addEventListener("submit", (e) => { e.preventDefault(); send(); });
    document.querySelectorAll("#rail-suggestions button").forEach(b => {
      b.addEventListener("click", () => send(b.textContent));
    });
  }

  function initDashboard() {
    renderStatCards();
    renderCharts();
    renderStudentTable();
    renderKBGrid();
    renderProgressStats();
    renderProgressList();
    renderAnalytics();
    renderCoursesPage();
    renderStudentsPage();
    renderReportsPage();
    initSettings();
    initPageChat();

    const today = document.getElementById("dash-today");
    if (today) {
      today.textContent = new Date().toLocaleDateString("en-GB", {
        weekday: "short", day: "numeric", month: "short", year: "numeric"
      });
    }

    ["student-search", "filter-level", "filter-status"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", renderStudentTable);
    });
    ["students-search", "students-level"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", renderStudentsPage);
    });

    document.getElementById("export-csv")?.addEventListener("click", exportCSV);
    document.getElementById("quick-export")?.addEventListener("click", exportCSV);
    document.getElementById("students-export")?.addEventListener("click", exportCSV);

    document.querySelectorAll(".dash-nav-link").forEach(link => {
      link.addEventListener("click", e => {
        e.preventDefault();
        showDashPage(link.dataset.page);
      });
    });

    document.querySelectorAll("[data-goto]").forEach(btn => {
      btn.addEventListener("click", () => showDashPage(btn.dataset.goto));
    });
  }

  /* ---------------------------------------------------------
     BOOT
     --------------------------------------------------------- */
  (async function boot() {
    try {
      [STUDENT_RECORDS, KB_DOCS] = await Promise.all([
        apiGet("/api/students"),
        apiGet("/api/knowledge-base")
      ]);
    } catch (e) {
      console.error("Failed to load data from the advising server:", e);
      alert("Couldn't load student data from the advising server. Make sure server.py is running, then reload.");
    }

    populateIdentitySelect();
    renderRiskList();
    renderLogTable();
    initDashboard();
    initRailChat();

    const s = loadSession();
    if (s && s.role) enterRoleView(s);
  })();
})();
