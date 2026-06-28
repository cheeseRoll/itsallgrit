const DAILY_DATA_KEY = "dailyData";
const LEGACY_TASKS_KEY = "tasks";
const USERS_KEY = "caPrepUsers";
const ACTIVE_USER_KEY = "caPrepActiveUser";
const PLANNER_DATA_KEY = "longTermPlannerData";
const ADMIN_USERNAME = "admin";
const MAX_USERS = 5;
const FAKE_EMAIL_DOMAIN = "@caprep.app";

const auth = firebase.auth();
const db   = firebase.firestore();

const PRELOADED_SYLLABUS = [
  {
    subject: "Direct Taxation & International Taxation",
    chapters: [
      "Basics, Tax Rates AY 26-27 & Alternate Taxation Regime",
      "Income from Capital Gains",
      "Income from Other Sources",
      "Taxation of Dividend & Deemed Dividend",
      "Taxation in Case of Liquidation & Buy Back",
      "Taxation in Case of Amalgamation and Demerger",
      "Profits & Gains of Business or Profession",
      "Income Computation & Disclosure Standards (ICDS)",
      "Taxation of Political Parties & Electoral Trust",
      "Taxation in Case of Firm/LLP",
      "Taxation in Case of AOP/BOI",
      "Taxation of Business Trust",
      "Taxation of Investment Fund",
      "Taxation of Securitisation Trust",
      "Minimum Alternate Tax",
      "Alternate Minimum Tax",
      "Deduction u/s 10AA (SEZ)",
      "U/C VI-A",
      "Clubbing of Income",
      "Set-Off & C/F of Losses",
      "Advance Tax, TDS & TCSs",
      "Assessment Procedure",
      "Appeals & Revisions",
      "Dispute Resolution Committee",
      "Miscellaneous Provisions",
      "Penalties & Prosecutions",
      "The Black Money Act 2015",
      "GAAR",
      "Taxation of VDA",
      "Exempt Income",
      "Tonnage Taxation",
      "Taxation of Trust & Institutions",
      "Tax Audit & Ethical Compliance",
      "Transfer Pricing",
      "Non-Resident & NRI Taxation",
      "Double Taxation Relief (DTAA)",
      "Advance Rulling (BOAR)",
      "Model Tax Conventions (MTC)",
      "Application & Interpretation of Tax Treaties",
      "Base Erosion & Profit Shifting (BEPS)",
      "Latest Developments in international Taxation",
      "Foreign Tax Credit Rule",
      "Conversion of Foreign Income into Indian Currency",
      "Remaining Case Laws & Concepts"
    ]
  },
  {
    subject: "Indirect Tax Laws",
    chapters: [
      "Introduction to GST",
      "Supply under GST",
      "Levy and Collection of CGST",
      "Levy and Collection of IGST",
      "Exemptions under GST",
      "Time of Supply",
      "Place of Supply",
      "Value of Supply",
      "Input Tax Credit",
      "Composition Scheme",
      "INVOICE, DEBIT & CREDIT NOTES",
      "REGISTRATION UNDER GST",
      "GST PAYMENT PROCESS",
      "RETURNS UNDER GST",
      "ACCOUNTS & RECORDS & E-WAY BILL",
      "REFUNDS UNDER GST",
      "ASSESSMENT & AUDIT",
      "SEARCH, SEIZURE, OFFENCES & PENALTIES",
      "DEMAND & RECOVERY",
      "APPEALS",
      "ADVANCE RULING",
      "ETHICS AND OTHER PROVISIONS",
      "TAXABLE EVENT UNDER CUSTOMS",
      "EXEMPTIONS UNDER CUSTOMS",
      "CLASSIFICATION OF GOODS AND TYPES OF CUSTOMS DUTY",
      "VALUATION UNDER CUSTOMS",
      "PROCEDURES UNDER CUSTOMS",
      "BAGGAGE PROVISIONS",
      "STORES UNDER CUSTOMS",
      "WAREHOUSING UNDER CUSTOMS",
      "REFUND OF CUSTOMS DUTY",
      "FOREIGN TRADE POLICY"
    ]
  },
  {
    subject: "Advanced Financial Management",
    chapters: [
      "Financial Policy and Corporate Strategy",
      "Risk Management",
      "Advanced Capital Budgeting Decisions",
      "Security Analysis",
      "Security Valuation",
      "Portfolio Management",
      "Securitization",
      "Mutual Funds",
      "Derivatives Analysis and Valuation",
      "Foreign Exchange Exposure and Risk Management",
      "International Financial Management",
      "Interest Rate Risk Management",
      "Business Valuation",
      "Mergers, Acquisitions & Corporate Restructuring",
      "Startup Finance"
    ]
  },
  {
    subject: "Financial Reporting",
    chapters: [
      "Introduction to IND AS & Schedule III",
      "Conceptual Framework for Financial Reporting under IND AS",
      "IND AS 1-Presentation of Financial Statements",
      "IND AS 2-Inventories",
      "IND AS 7-Statement of Cash Flow",
      "IND AS 8-Accounting Policies, Changes in Accounting Estimates & Errors",
      "IND AS 10-Events After the Reporting Period",
      "IND AS 12- Income Taxes",
      "IND AS 16-Property, Plant & Equipment",
      "IND AS 19-Employee Benefits",
      "IND AS 20- Accounting for Government Grants & Disclosure of Government Assistance",
      "IND AS 21 - The Effects of Changes in Foreign Exchange Rates",
      "IND AS 23-Borrowing Costs",
      "IND AS 24 - Related Party Disclosures",
      "IND AS 33-Earnings Per Share",
      "IND AS 34-Interim Financial Reporting",
      "IND AS 36-Impairment of Assets",
      "IND AS 37 - Provisions, Contingent Liabilities & Contingent Assets",
      "IND AS 38-Intangible Assets",
      "IND AS 40-Investment Property",
      "IND AS 41 - Agriculture",
      "IND AS 101- First Time Adoption of IND AS",
      "IND AS 105 - Non-Current Asset Held for Sale & Discontinued Operation",
      "IND AS 108-Operating Segments",
      "IND AS 113 - Fair Value Measurement",
      "IND AS 115- Revenue from Contracts with Customers",
      "IND AS 116 - Leases",
      "IND AS 102-Share Based Payments",
      "IND AS 103 - Business Combination",
      "IND AS 110 - Consolidated Financial Statement",
      "IND AS 27-Separate Financial Statements",
      "IND AS 112 - Disclosure of Interests in Other Entities",
      "IND AS 111-Joint Arrangements",
      "IND AS 28- Investments in Associates & Joint Venture",
      "IND AS 32, 107, 109 - Financial Instruments",
      "Professional & Ethical Duty of A Chartered Accountant",
      "Accounting & Technology"
    ]
  },
  {
    subject: "Advanced Auditing Assurance & Professional Ethics",
    chapters: [
      "Basics of Audit",
      "SAs (200-700 Series) SQC-1",
      "Professional Ethics",
      "CARO 2020",
      "Company Audit",
      "Audit Planning",
      "Risk assessment & internal control",
      "Group audit",
      "Bank Audit",
      "NBFC Audit",
      "PSU Audit",
      "Internal Audit",
      "Due diligence",
      "Forensic accounting",
      "Investigation",
      "SA 800 Series",
      "SRE",
      "SAE",
      "SRS",
      "SDG & ESG Assurance",
      "Digital audit"
    ]
  }
];

let activeUser =
  JSON.parse(localStorage.getItem(ACTIVE_USER_KEY)) || null;

let dailyData = {};
let plannerData = null;
let calendarViewDate = new Date();

/* AUTH */

function getUsers() {
  return JSON.parse(localStorage.getItem(USERS_KEY)) || {};
}
function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}
async function getUserCount() {
  const snap = await db.collection("users").get();
  return snap.size;
}

function showRegisterFlow() {

  showOnlyScreen("welcomeScreen");
}

function showLoginFlow() {

  showOnlyScreen("loginScreen");
}

function backToEntry() {

  showOnlyScreen("entryScreen");
}

async function loginMember() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  if (!username || !password) { alert("Please enter your username and password"); return; }
  try {
    const cred = await auth.signInWithEmailAndPassword(username + FAKE_EMAIL_DOMAIN, password);
    const snap = await db.collection("users").doc(cred.user.uid).get();
    if (!snap.exists) throw new Error("No profile");
    activeUser = snap.data();
    localStorage.setItem(ACTIVE_USER_KEY, JSON.stringify(activeUser));
    dailyData = loadDailyData();
    openDashboardForUser();
  } catch(err) {
    alert("Username or password is incorrect");
  }
}

async function registerUser(profile) {
  try {
    const cred = await auth.createUserWithEmailAndPassword(
      profile.username + FAKE_EMAIL_DOMAIN, profile.password
    );
    const firestoreProfile = { ...profile, uid: cred.user.uid };
    delete firestoreProfile.password;
    await db.collection("users").doc(cred.user.uid).set(firestoreProfile, { merge: true });
    const users = getUsers();
    users[profile.username] = firestoreProfile;
    saveUsers(users);
    activeUser = firestoreProfile;
    localStorage.setItem(ACTIVE_USER_KEY, JSON.stringify(activeUser));
    dailyData = loadDailyData();
    return true;
  } catch(err) {
    if (err.code === "auth/email-already-in-use") {
      alert("That username is already taken.");
    } else {
      alert("Registration error: " + err.message);
    }
    return false;
  }
}

function openDashboardForUser() {

  showOnlyScreen(null);

  document
    .getElementById("dashboard")
    .classList.add("active");

  document.getElementById(
    "welcomeText"
  ).innerText =
    `Hey, CA ${activeUser.name}`;
    const adminBtn = document.getElementById("adminBtn");
    if (adminBtn) adminBtn.style.display = activeUser.username === ADMIN_USERNAME ? "inline-block" : "none";
  renderTasks();
}

function showOnlyScreen(activeScreenId) {

  const screens = [
    "entryScreen",
    "loginScreen",
    "welcomeScreen",
    "loadingScreen",
    "setupScreen",
    "plannerPage",
    "calendarPage",
    "progressPage",
    "targetsPage",
    "pomodoroPage",
    "pomodoroFocusScreen",
    "statsPage",
    "adminPage"
  ];

  screens.forEach(screenId => {

    const screen = document.getElementById(screenId);

    if (screen) {
      screen.classList.remove("active");
    }
  });

  document
    .getElementById("dashboard")
    .classList.remove("active");

  if (activeScreenId) {
    document
      .getElementById(activeScreenId)
      .classList.add("active");
  }
}

/* DATE + DAILY DATA */

function getDailyDataKey() {

  if (!activeUser || !activeUser.username) {
    return DAILY_DATA_KEY;
  }

  return `${DAILY_DATA_KEY}_${activeUser.username}`;
}

function getTodayKey() {

  const today = new Date();

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function createEmptyDay() {

  return {
    tasks: [],
    pomodoroSessions: [],
    totalTasks: 0,
    completedTasks: 0,
    pendingTasks: 0,
    completionRate: 0,
    pomodoroSessionCount: 0,
    totalFocusMinutes: 0
  };
}

function loadDailyData() {

  const savedData =
    JSON.parse(localStorage.getItem(getDailyDataKey())) || {};

  const oldDailyData =
    JSON.parse(localStorage.getItem(DAILY_DATA_KEY)) || {};

  const legacyTasks =
    JSON.parse(localStorage.getItem(LEGACY_TASKS_KEY)) || [];

  const todayKey = getTodayKey();

  if (
    legacyTasks.length > 0 &&
    !savedData[todayKey]
  ) {

    savedData[todayKey] = {
      ...createEmptyDay(),
      tasks: legacyTasks
    };

    localStorage.removeItem(LEGACY_TASKS_KEY);
  }

  if (
    Object.keys(oldDailyData).length > 0 &&
    Object.keys(savedData).length === 0 &&
    activeUser
  ) {

    Object.assign(savedData, oldDailyData);
  }

  if (!savedData[todayKey]) {
    savedData[todayKey] = createEmptyDay();
  }

  calculateDailyAnalytics(savedData[todayKey]);

  localStorage.setItem(
    getDailyDataKey(),
    JSON.stringify(savedData)
  );

  return savedData;
}

function getTodayData() {

  const todayKey = getTodayKey();

  if (!dailyData[todayKey]) {
    dailyData[todayKey] = createEmptyDay();
  }

  return dailyData[todayKey];
}

function getTodayTasks() {

  return getTodayData().tasks;
}

function saveDailyData() {
  calculateDailyAnalytics(getTodayData());
  localStorage.setItem(getDailyDataKey(), JSON.stringify(dailyData));
  if (activeUser && activeUser.uid) {
    const todayKey = getTodayKey();
    db.collection("users").doc(activeUser.uid)
      .collection("dailyData").doc(todayKey)
      .set(getTodayData()).catch(console.error);
  }
}

function calculateDailyAnalytics(dayData) {

  if (!dayData.tasks) {
    dayData.tasks = [];
  }

  if (!dayData.pomodoroSessions) {
    dayData.pomodoroSessions = [];
  }

  const totalTasks = dayData.tasks.length;
  const completedTasks =
    dayData.tasks.filter(task => task.completed).length;
  const pendingTasks = totalTasks - completedTasks;
  const completionRate =
    totalTasks === 0
      ? 0
      : Math.round((completedTasks / totalTasks) * 100);

  dayData.totalTasks = totalTasks;
  dayData.completedTasks = completedTasks;
  dayData.pendingTasks = pendingTasks;
  dayData.completionRate = completionRate;
  dayData.pomodoroSessionCount =
    dayData.pomodoroSessions.length;
  dayData.totalFocusMinutes =
    dayData.pomodoroSessions.reduce(
      (total, session) => total + (session.minutes || 0),
      0
    );

  return dayData;
}

function getTodayCompletionRate() {

  calculateDailyAnalytics(getTodayData());

  return getTodayData().completionRate;
}

function getWeeklyAverageCompletionRate() {

  const today = new Date();
  const weeklyRates = [];

  for (let i = 0; i < 7; i++) {

    const date = new Date(today);
    date.setDate(today.getDate() - i);

    const dateKey = formatDateKey(date);
    const dayData = dailyData[dateKey];

    if (dayData) {
      calculateDailyAnalytics(dayData);
      weeklyRates.push(dayData.completionRate);
    }
  }

  return getAverage(weeklyRates);
}

function getOverallCompletionRate() {

  const allRates = Object
    .values(dailyData)
    .map(dayData => {
      calculateDailyAnalytics(dayData);
      return dayData.completionRate;
    });

  return getAverage(allRates);
}

function getAverage(values) {

  if (values.length === 0) {
    return 0;
  }

  const total =
    values.reduce((sum, value) => sum + value, 0);

  return Math.round(total / values.length);
}

function formatDateKey(date) {

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/* LONG TERM PLANNER */

function getPlannerDataKey() {

  if (!activeUser || !activeUser.username) {
    return PLANNER_DATA_KEY;
  }

  return `${PLANNER_DATA_KEY}_${activeUser.username}`;
}

function createDefaultPlannerData() {

  const subjects = PRELOADED_SYLLABUS.map(item => ({
    subject: item.subject,
    chapters: [...item.chapters],
    completedChapters: []
  }));

  return {
    firstExamDate: "",
    revisionEndDate: "",
    revisionCount: 3,
    mockCount: 2,
    mockTiming: "after-subject",
    subjects,
    subjectOrder: subjects.map(item => item.subject),
    revisionDays: {},
    calendar: []
  };
}

function loadPlannerData() {

  const saved =
    JSON.parse(localStorage.getItem(getPlannerDataKey())) || null;

  plannerData = saved || createDefaultPlannerData();

  plannerData.subjects.forEach(subject => {

    if (!plannerData.revisionDays[subject.subject]) {
      plannerData.revisionDays[subject.subject] = {};
    }
  });

  return plannerData;
}

function savePlannerData() {
  localStorage.setItem(getPlannerDataKey(), JSON.stringify(plannerData));
  if (activeUser && activeUser.uid) {
    db.collection("users").doc(activeUser.uid)
      .collection("planner").doc("data")
      .set(plannerData).catch(console.error);
  }
}

function initLongTermPlanner() {

  loadPlannerData();
  renderPlannerSettings();
  renderPlannerSubjectSelect();
  renderChapterChecklist();
  renderRevisionPlanner();
  renderSubjectOrderList();
  updatePlannerSummary();
  renderPlannerCalendar();
}

function renderPlannerSettings() {

  document.getElementById("firstExamDate").value =
    plannerData.firstExamDate;

  document.getElementById("revisionEndDate").value =
    plannerData.revisionEndDate;

  document.getElementById("revisionCount").value =
    plannerData.revisionCount;

  document.getElementById("mockCount").value =
    plannerData.mockCount;

  document.getElementById("mockTiming").value =
    plannerData.mockTiming;
}

function renderPlannerSubjectSelect() {

  const select =
    document.getElementById("plannerSubjectSelect");

  const currentValue = select.value;

  select.innerHTML = "";

  plannerData.subjects.forEach(subject => {

    const option = document.createElement("option");

    option.value = subject.subject;
    option.innerText = subject.subject;

    select.appendChild(option);
  });

  if (
    currentValue &&
    plannerData.subjects.some(subject => subject.subject === currentValue)
  ) {
    select.value = currentValue;
  }
}

function getSelectedPlannerSubject() {

  const selectedSubject =
    document.getElementById("plannerSubjectSelect").value;

  return plannerData.subjects.find(
    subject => subject.subject === selectedSubject
  );
}

function renderChapterChecklist() {

  const subject = getSelectedPlannerSubject();
  const checklist =
    document.getElementById("chapterChecklist");
  const editor =
    document.getElementById("syllabusEditor");

  checklist.innerHTML = "";

  if (!subject) {
    editor.value = "";
    return;
  }

  editor.value = subject.chapters.join("\n");

  subject.chapters.forEach((chapter, index) => {

    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    const span = document.createElement("span");

    label.className = "chapter-item";

    checkbox.type = "checkbox";
    checkbox.value = chapter;
    checkbox.checked =
      subject.completedChapters.includes(chapter);

    span.innerText = chapter;

    label.appendChild(checkbox);
    label.appendChild(span);

    checklist.appendChild(label);
  });
}

function saveChapterStatus() {

  const subject = getSelectedPlannerSubject();

  if (!subject) {
    return;
  }

  subject.completedChapters = Array
    .from(document.querySelectorAll("#chapterChecklist input:checked"))
    .map(input => input.value);

  savePlannerData();
  updatePlannerSummary();
}

function saveSyllabusEdits() {

  const subject = getSelectedPlannerSubject();

  if (!subject) {
    return;
  }

  const updatedChapters =
    document
      .getElementById("syllabusEditor")
      .value
      .split("\n")
      .map(chapter => chapter.trim())
      .filter(Boolean);

  subject.chapters = updatedChapters;
  subject.completedChapters =
    subject.completedChapters.filter(chapter =>
      updatedChapters.includes(chapter)
    );

  savePlannerData();
  renderChapterChecklist();
  updatePlannerSummary();
}

function savePlannerSettings() {

  plannerData.firstExamDate =
    document.getElementById("firstExamDate").value;

  plannerData.revisionEndDate =
    document.getElementById("revisionEndDate").value;

  plannerData.revisionCount =
    Number(document.getElementById("revisionCount").value) || 1;

  plannerData.mockCount =
    Number(document.getElementById("mockCount").value) || 0;

  plannerData.mockTiming =
    document.getElementById("mockTiming").value;

  saveRevisionPlan();
  savePlannerData();
  updatePlannerSummary();
}

function renderRevisionPlanner() {

  if (!plannerData) {
    loadPlannerData();
  }

  plannerData.revisionCount =
    Number(document.getElementById("revisionCount").value) || 1;

  const wrapper =
    document.getElementById("revisionPlanner");

  wrapper.innerHTML = "";

  plannerData.subjects.forEach(subject => {

    const row = document.createElement("div");
    const title = document.createElement("h3");
    const grid = document.createElement("div");

    row.className = "revision-subject";
    title.innerText = subject.subject;
    grid.className = "revision-grid";

    for (let i = 1; i <= plannerData.revisionCount; i++) {

      const input = document.createElement("input");
      const suggested =
        i === 1
          ? 8
          : Math.max(
              1,
              Math.round(
                (plannerData.revisionDays[subject.subject]?.[i - 1] || 8) *
                0.75
              )
            );

      input.type = "number";
      input.min = "1";
      input.placeholder = `R${i} days`;
      input.dataset.subject = subject.subject;
      input.dataset.revision = String(i);
      input.value =
        plannerData.revisionDays[subject.subject]?.[i] || suggested;
      input.onchange = savePlannerSettings;

      grid.appendChild(input);
    }

    row.appendChild(title);
    row.appendChild(grid);

    wrapper.appendChild(row);
  });

  saveRevisionPlan();
  savePlannerData();
  updatePlannerSummary();
}

function saveRevisionPlan() {

  if (!plannerData) {
    return;
  }

  document
    .querySelectorAll("#revisionPlanner input")
    .forEach(input => {

      if (!plannerData.revisionDays[input.dataset.subject]) {
        plannerData.revisionDays[input.dataset.subject] = {};
      }

      plannerData.revisionDays[input.dataset.subject][input.dataset.revision] =
        Number(input.value) || 0;
    });
}

function renderSubjectOrderList() {

  const wrapper =
    document.getElementById("subjectOrderList");

  wrapper.innerHTML = "";

  plannerData.subjectOrder.forEach((subjectName, index) => {

    const row = document.createElement("div");
    const name = document.createElement("span");
    const actions = document.createElement("div");
    const up = document.createElement("button");
    const down = document.createElement("button");

    row.className = "subject-order-row";
    name.innerText = `${index + 1}. ${subjectName}`;

    actions.className = "subject-order-actions";

    up.type = "button";
    up.innerText = "↑";
    up.onclick = () => moveSubject(index, -1);

    down.type = "button";
    down.innerText = "↓";
    down.onclick = () => moveSubject(index, 1);

    actions.appendChild(up);
    actions.appendChild(down);
    row.appendChild(name);
    row.appendChild(actions);

    wrapper.appendChild(row);
  });
}

function moveSubject(index, direction) {

  const nextIndex = index + direction;

  if (
    nextIndex < 0 ||
    nextIndex >= plannerData.subjectOrder.length
  ) {
    return;
  }

  const [subject] =
    plannerData.subjectOrder.splice(index, 1);

  plannerData.subjectOrder.splice(nextIndex, 0, subject);

  savePlannerData();
  renderSubjectOrderList();
  updatePlannerSummary();
}

function updatePlannerSummary() {

  const summary =
    document.getElementById("plannerDaySummary");
  const feasibility =
    document.getElementById("plannerFeasibility");

  const studyDays = getAvailableStudyDays();
  const examPrepDays = getExamPrepDays();
  const requiredDays = getRequiredPlannerDays();

  if (!plannerData.firstExamDate || !plannerData.revisionEndDate) {
    summary.innerText =
      "Add your first exam date and revision finish date to see available study days.";
  } else {
    summary.innerText =
      `${studyDays} days for revisions, with ${examPrepDays} days reserved before the first exam.`;
  }

  if (requiredDays === 0) {
    feasibility.className = "planner-note";
    feasibility.innerText =
      "Add revision days and mocks to check feasibility.";
    return;
  }

  if (studyDays <= 0) {
    feasibility.innerText =
      "The revision finish date should be before your first exam and after today.";
    feasibility.className = "planner-note warning-note";
    return;
  }

  if (requiredDays > studyDays) {
    feasibility.innerText =
      `This plan needs ${requiredDays} days, but you have ${studyDays}. Reduce revision days, mocks, or move the revision finish date.`;
    feasibility.className = "planner-note warning-note";
  } else {
    feasibility.innerText =
      `Feasible. This plan needs ${requiredDays} of your ${studyDays} available revision days.`;
    feasibility.className = "planner-note success-note";
  }
}

function getAvailableStudyDays() {

  if (!plannerData.revisionEndDate) {
    return 0;
  }

  return getDaysBetween(new Date(), new Date(plannerData.revisionEndDate));
}

function getExamPrepDays() {

  if (!plannerData.firstExamDate || !plannerData.revisionEndDate) {
    return 0;
  }

  return getDaysBetween(
    new Date(plannerData.revisionEndDate),
    new Date(plannerData.firstExamDate)
  );
}

function getDaysBetween(startDate, endDate) {

  const start = new Date(formatDateKey(startDate));
  const end = new Date(formatDateKey(endDate));
  const milliseconds = end - start;

  return Math.max(
    0,
    Math.ceil(milliseconds / (1000 * 60 * 60 * 24))
  );
}

function getRequiredPlannerDays() {

  saveRevisionPlan();

  const revisionDays = Object
    .values(plannerData.revisionDays)
    .reduce((subjectTotal, revisions) => {

      return subjectTotal + Object
        .values(revisions)
        .reduce((sum, days) => sum + (Number(days) || 0), 0);
    }, 0);

  return revisionDays + plannerData.mockCount;
}

function generateLongTermPlan() {

  savePlannerSettings();

  const calendar = [];
  let currentDate = new Date(formatDateKey(new Date()));
  let mockNumber = 1;

  for (let revision = 1; revision <= plannerData.revisionCount; revision++) {

    plannerData.subjectOrder.forEach(subjectName => {

      const days =
        Number(plannerData.revisionDays[subjectName]?.[revision]) || 0;

      if (days <= 0) {
        return;
      }

      const startDate = new Date(currentDate);
      currentDate.setDate(currentDate.getDate() + days - 1);

      calendar.push({
        type: "Revision",
        title: `${subjectName} - Revision ${revision}`,
        start: formatDateKey(startDate),
        end: formatDateKey(currentDate),
        days
      });

      currentDate.setDate(currentDate.getDate() + 1);

      if (
        plannerData.mockTiming === "after-subject" &&
        mockNumber <= plannerData.mockCount
      ) {

        calendar.push({
          type: "Mock",
          title: `Mock Test ${mockNumber}`,
          start: formatDateKey(currentDate),
          end: formatDateKey(currentDate),
          days: 1
        });

        mockNumber++;
        currentDate.setDate(currentDate.getDate() + 1);
      }
    });
  }

  while (
    plannerData.mockTiming === "final-block" &&
    mockNumber <= plannerData.mockCount
  ) {

    calendar.push({
      type: "Mock",
      title: `Mock Test ${mockNumber}`,
      start: formatDateKey(currentDate),
      end: formatDateKey(currentDate),
      days: 1
    });

    mockNumber++;
    currentDate.setDate(currentDate.getDate() + 1);
  }

  plannerData.calendar = calendar;

  savePlannerData();
  updatePlannerSummary();
  renderPlannerCalendar();
}

function renderPlannerCalendar() {

  const wrapper =
    document.getElementById("plannerCalendar");

  if (!wrapper) {
    return;
  }

  wrapper.innerHTML = "";

  if (!plannerData || plannerData.calendar.length === 0) {
    wrapper.innerHTML =
      "<p class=\"planner-note\">Your generated calendar will appear here.</p>";
    return;
  }

  plannerData.calendar.forEach(item => {

    const row = document.createElement("div");
    const date = document.createElement("span");
    const title = document.createElement("strong");

    row.className = `calendar-row ${item.type === "Mock" ? "mock-row" : ""}`;
    date.innerText =
      item.start === item.end
        ? item.start
        : `${item.start} to ${item.end}`;
    title.innerText =
      `${item.title} (${item.days} day${item.days > 1 ? "s" : ""})`;

    row.appendChild(date);
    row.appendChild(title);

    wrapper.appendChild(row);
  });
}

function initStudyCalendar() {

  loadPlannerData();

  if (plannerData.calendar.length > 0) {
    calendarViewDate = new Date(plannerData.calendar[0].start);
  } else {
    calendarViewDate = new Date();
  }

  renderStudyCalendar();
}

function changeCalendarMonth(direction) {

  calendarViewDate.setMonth(
    calendarViewDate.getMonth() + direction
  );

  renderStudyCalendar();
}

function renderStudyCalendar() {

  const grid =
    document.getElementById("studyCalendarGrid");
  const title =
    document.getElementById("calendarMonthTitle");

  if (!grid || !title) {
    return;
  }

  const year = calendarViewDate.getFullYear();
  const month = calendarViewDate.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const startOffset = monthStart.getDay();
  const totalCells =
    Math.ceil((startOffset + monthEnd.getDate()) / 7) * 7;

  title.innerText =
    calendarViewDate.toLocaleString("default", {
      month: "long",
      year: "numeric"
    });

  grid.innerHTML = "";

  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach(day => {

    const label = document.createElement("div");

    label.className = "calendar-day-label";
    label.innerText = day;

    grid.appendChild(label);
  });

  for (let cell = 0; cell < totalCells; cell++) {

    const dayNumber = cell - startOffset + 1;
    const cellDate = new Date(year, month, dayNumber);
    const dayCell = document.createElement("div");

    dayCell.className = "study-calendar-day";

    if (dayNumber < 1 || dayNumber > monthEnd.getDate()) {
      dayCell.classList.add("muted-calendar-day");
      grid.appendChild(dayCell);
      continue;
    }

    const dateKey = formatDateKey(cellDate);
    const dateLabel = document.createElement("span");
    const events = getCalendarItemsForDate(dateKey);

    dateLabel.className = "calendar-date-number";
    dateLabel.innerText = dayNumber;

    dayCell.appendChild(dateLabel);

    if (events.length > 0) {

      const primaryItem = events[0];
      const color = getCalendarItemColor(primaryItem);

      dayCell.style.setProperty("--subject-color", color);
      dayCell.classList.add("subject-shaded-day");
    }

    events.slice(0, 2).forEach(item => {

      const event = document.createElement("div");

      event.className =
        `calendar-event ${item.type === "Mock" ? "mock-event" : "revision-event"}`;
      event.innerText = getCalendarItemLabel(item);

      dayCell.appendChild(event);
    });

    if (events.length > 2) {

      const more = document.createElement("div");

      more.className = "calendar-more";
      more.innerText = `+${events.length - 2} more`;

      dayCell.appendChild(more);
    }

    grid.appendChild(dayCell);
  }
}

function getCalendarItemsForDate(dateKey) {

  if (!plannerData || plannerData.calendar.length === 0) {
    return [];
  }

  return plannerData.calendar.filter(item =>
    dateKey >= item.start && dateKey <= item.end
  );
}

function getCalendarItemLabel(item) {

  if (item.type === "Mock") {
    return item.title;
  }

  return item.title.split(" - Revision")[0];
}

function getCalendarItemColor(item) {

  const subjectName = getCalendarItemLabel(item);
  const subjectColors = {
    "Direct Taxation & International Taxation": "#22c55e",
    "Indirect Tax Laws": "#38bdf8",
    "Advanced Financial Management": "#a78bfa",
    "Financial Reporting": "#f59e0b",
    "Advanced Auditing Assurance & Professional Ethics": "#fb7185"
  };

  if (item.type === "Mock") {
    return "#4f46e5";
  }

  return subjectColors[subjectName] || "#22c55e";
}

function initProgressTracker() {

  loadPlannerData();
  renderProgressTracker();
}

function renderProgressTracker() {

  const currentBlock = getCurrentPlannerBlock();
  const completionRate = getOverallCompletionRate();

  setStatLine(
    "progressCurrentSubject",
    "Subject",
    currentBlock ? getCalendarItemLabel(currentBlock) : "No active plan"
  );

  setStatLine(
    "progressDaysLeft",
    "Days Left",
    currentBlock ? `${getDaysLeftInBlock(currentBlock)} days` : "-"
  );

  setStatLine(
    "progressCompletionRate",
    "Lifetime Completion Rate",
    `${completionRate}%`
  );
}

function toggleSessionsTracker() {

  const panel = document.getElementById("sessionsTrackerPanel");
  const btn   = document.getElementById("sessionsTrackerBtn");
  if (!panel) return;

  const isOpen = panel.style.display === "block";

  if (isOpen) {
    panel.style.display = "none";
    if (btn) btn.innerText = "📋 Sessions Tracker";
  } else {
    panel.style.display = "block";
    renderSessionsTable();
    if (btn) btn.innerText = "📋 Sessions Tracker ▲";
  }
}

function renderSessionsTable() {

  const panel = document.getElementById("sessionsTrackerPanel");
  if (!panel) return;

  // Collect days that have at least one session, newest first
  const rows = Object.entries(dailyData)
    .filter(([, data]) => {
      calculateDailyAnalytics(data);
      return data.pomodoroSessionCount > 0;
    })
    .sort((a, b) => b[0].localeCompare(a[0]));

  if (rows.length === 0) {
    panel.innerHTML =
      "<p style='color:#6b7280;padding:16px;'>No sessions recorded yet.</p>";
    return;
  }

  const thStyle =
    "padding:11px 16px;text-align:left;color:#4338ca;font-weight:600;font-size:13px;";
  const tdStyle =
    "padding:11px 16px;color:#111827;font-size:13px;";

  let html =
    "<table style='width:100%;border-collapse:collapse;'>" +
    "<thead><tr style='background:#eef2ff;'>" +
    `<th style='${thStyle}'>Date</th>` +
    `<th style='${thStyle}'>Hours</th>` +
    `<th style='${thStyle}'>Sessions</th>` +
    `<th style='${thStyle}'>Avg / Session</th>` +
    "</tr></thead><tbody>";

  rows.forEach(([dateKey, data], i) => {

    const sessions  = data.pomodoroSessionCount;
    const totalMins = data.totalFocusMinutes || 0;
    const avgMins   = sessions > 0 ? Math.round(totalMins / sessions) : 0;

    const hoursStr = totalMins >= 60
      ? `${Math.floor(totalMins / 60)}h ${totalMins % 60}m`
      : `${totalMins}m`;

    const avgStr = avgMins >= 60
      ? `${Math.floor(avgMins / 60)}h ${avgMins % 60}m`
      : `${avgMins}m`;

    // Parse date parts directly to avoid UTC shift
    const [y, m, d] = dateKey.split("-").map(Number);
    const dateStr = new Date(y, m - 1, d)
      .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

    const bg = i % 2 === 0 ? "#ffffff" : "#f9fafb";

    html +=
      `<tr style='background:${bg};'>` +
      `<td style='${tdStyle}'>${dateStr}</td>` +
      `<td style='${tdStyle}'>${hoursStr}</td>` +
      `<td style='${tdStyle}'>${sessions}</td>` +
      `<td style='${tdStyle}'>${avgStr}</td>` +
      "</tr>";
  });

  html += "</tbody></table>";
  panel.innerHTML = html;
}

function setStatLine(elementId, label, value) {

  const element = document.getElementById(elementId);

  if (!element) {
    return;
  }

  element.innerHTML =
    `<span>${label}</span><strong>${value}</strong>`;
}

function getCurrentPlannerBlock() {

  if (!plannerData || plannerData.calendar.length === 0) {
    return null;
  }

  const todayKey = getTodayKey();

  const activeBlock = plannerData.calendar.find(item =>
    todayKey >= item.start && todayKey <= item.end
  );

  if (activeBlock) {
    return activeBlock;
  }

  return plannerData.calendar.find(item => item.start > todayKey) || null;
}

function getDaysLeftInBlock(block) {

  const today = new Date(getTodayKey());
  const end = new Date(block.end);
  const diff = end - today;

  return Math.max(
    0,
    Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1
  );
}

function getMocksGivenTillDate() {

  if (!plannerData || plannerData.calendar.length === 0) {
    return 0;
  }

  const todayKey = getTodayKey();

  return plannerData.calendar.filter(item =>
    item.type === "Mock" && item.end <= todayKey
  ).length;
}

/* SCREEN FLOW */

function startSetup() {

  document
    .getElementById("welcomeScreen")
    .classList.remove("active");

  document
    .getElementById("loadingScreen")
    .classList.add("active");

  setTimeout(() => {

    document
      .getElementById("loadingScreen")
      .classList.remove("active");

    document
      .getElementById("setupScreen")
      .classList.add("active");

  }, 2500);
}

async function finishSetup() {

  let name =
    document.getElementById("name").value.trim();

  let sro =
    document.getElementById("sro").value.trim();

  let goal =
    document.getElementById("goalSelect").value;

  let level =
    document.getElementById("level").value;

  let attempt =
    document.getElementById("attempt").value.trim();

  let attemptNumber =
    document.getElementById("attemptNumber").value;

  let expectations =
    document.getElementById("expectations").value.trim();

  let username =
    document.getElementById("registerUsername").value.trim();

  let password =
    document.getElementById("registerPassword").value;

  if (name === "") {

    alert("Please enter your name");

    return;
  }

  if (username === "" || password === "") {

    alert("Please create a username and password");

    return;
  }

  const registered = await registerUser({
    name,
    sro,
    goal,
    level,
    attempt,
    attemptNumber,
    expectations,
    username,
    password,
    createdAt: new Date().toISOString()
  });

  if (registered) {
    openDashboardForUser();
  }
}

function openPage(pageId) {

  document
    .getElementById("adminPage")
    .classList.remove("active");

  document
    .getElementById("dashboard")
    .classList.remove("active");

  document
    .getElementById(pageId)
    .classList.add("active");

  if (pageId === "plannerPage") {
    initLongTermPlanner();
  }

  if (pageId === "calendarPage") {
    initStudyCalendar();
  }

  if (pageId === "progressPage") {
    initProgressTracker();
  }

  renderTasks();
}

function goBack() {

  let pages = [
    "plannerPage",
    "calendarPage",
    "progressPage",
    "targetsPage",
    "pomodoroPage",
    "pomodoroFocusScreen",
    "statsPage",
    "adminPage"
  ];

  pages.forEach(page => {

    document
      .getElementById(page)
      .classList.remove("active");

  });

  document
    .getElementById("dashboard")
    .classList.add("active");

  closeSessionConfirm();

  renderTasks();
}

/* TASKS */

function addTask() {

  let input =
    document.getElementById("taskInput");

  let taskText = input.value.trim();

  if (taskText === "") {
    return;
  }

  getTodayTasks().push({
    text: taskText,
    completed: false
  });

  saveDailyData();

  renderTasks();

  input.value = "";
}

function renderTasks(celebratedIndex = null) {

  let taskList =
    document.getElementById("taskList");

  let dashboardList =
    document.getElementById("dashboardTaskList");

  let tasks = getTodayTasks();

  taskList.innerHTML = "";

  dashboardList.innerHTML = "";

  if (tasks.length === 0) {

    taskList.innerHTML =
      "<p class=\"empty-state\">No study tasks yet.</p>";

    dashboardList.innerHTML =
      "<p class=\"empty-state\">No targets added yet.</p>";

    updateStats();

    return;
  }

  tasks.forEach((task, index) => {

    taskList.appendChild(
      createTaskRow(task, index, {
        mode: "planning",
        celebrated: celebratedIndex === index
      })
    );

    dashboardList.appendChild(
      createTaskRow(task, index, {
        mode: "execution",
        celebrated: celebratedIndex === index
      })
    );
  });

  updateStats();
}

function createTaskRow(task, index, options) {

  const li = document.createElement("li");
  const taskText = document.createElement("span");
  const actions = document.createElement("div");
  const tickButton = document.createElement("button");

  li.className =
    options.mode === "execution"
      ? "dashboard-task"
      : "task-row";

  if (options.celebrated) {
    li.classList.add("task-celebration");
  }

  if (task.completed) {
    li.classList.add("completed-row");
  }

  taskText.className = "task-text";
  taskText.innerText = task.text;

  if (task.completed) {
    taskText.classList.add("completed");
  }

  actions.className = "task-actions";

  tickButton.className = "tick-btn";
  tickButton.type = "button";
  tickButton.innerText = "✓";
  tickButton.setAttribute(
    "aria-label",
    task.completed ? "Mark task incomplete" : "Mark task complete"
  );
  tickButton.onclick = () => toggleTask(index);

  actions.appendChild(tickButton);

  if (options.mode === "planning") {

    const deleteButton = document.createElement("button");

    deleteButton.className = "delete-btn";
    deleteButton.type = "button";
    deleteButton.innerText = "×";
    deleteButton.setAttribute("aria-label", "Delete task");
    deleteButton.onclick = () => deleteTask(index);

    actions.appendChild(deleteButton);
  }

  li.appendChild(taskText);
  li.appendChild(actions);

  return li;
}

function toggleTask(index) {

  const tasks = getTodayTasks();

  if (!tasks[index]) {
    return;
  }

  const wasCompleted = tasks[index].completed;

  tasks[index].completed =
    !tasks[index].completed;

  saveDailyData();

  renderTasks(
    tasks[index].completed ? index : null
  );

  if (!wasCompleted && tasks[index].completed) {
    celebrate();
    launchConfetti(
      tasks.every(task => task.completed)
    );
  }
}

function deleteTask(index) {

  const tasks = getTodayTasks();

  tasks.splice(index, 1);

  saveDailyData();

  renderTasks();
}

function updateStats() {

  const todayData = getTodayData();

  calculateDailyAnalytics(todayData);

  document.getElementById(
    "statsTasks"
  ).innerHTML =
    `<span>Tasks Completed</span><strong>${todayData.completedTasks}</strong>`;

  document.getElementById(
    "statsTotal"
  ).innerHTML =
    `<span>Total Tasks</span><strong>${todayData.totalTasks}</strong>`;

  const statsCompletion =
    document.getElementById("statsCompletion");

  if (statsCompletion) {
    statsCompletion.innerHTML =
      `<span>Today's Completion</span><strong>${getTodayCompletionRate()}%</strong>`;
  }

  const statsFocusSessions =
    document.getElementById("statsFocusSessions");

  const statsFocusMinutes =
    document.getElementById("statsFocusMinutes");

  const statsSessionList =
    document.getElementById("statsSessionList");

  if (statsFocusSessions) {
    statsFocusSessions.innerHTML =
      `<span>Focus Sessions</span><strong>${todayData.pomodoroSessionCount}</strong>`;
  }

  if (statsFocusMinutes) {
    statsFocusMinutes.innerHTML =
      `<span>Focus Minutes</span><strong>${todayData.totalFocusMinutes}</strong>`;
  }

  if (statsSessionList) {
    renderPomodoroStats(todayData.pomodoroSessions);
  }

  saveDailyData();
}

function renderPomodoroStats(sessions) {

  const statsSessionList =
    document.getElementById("statsSessionList");

  statsSessionList.innerHTML = "";

  if (sessions.length === 0) {
    statsSessionList.innerHTML =
      "<li>No focus sessions yet today.</li>";
    return;
  }

  sessions.forEach((session, index) => {

    const li = document.createElement("li");
    const label = document.createElement("span");
    const value = document.createElement("strong");

    label.innerText =
      `Session ${index + 1}`;

    value.innerText =
      `${session.minutes} min`;

    li.appendChild(label);
    li.appendChild(value);

    statsSessionList.appendChild(li);
  });
}

/* SMALL CELEBRATION */

function celebrate() {

  document.body.classList.add(
    "celebrate"
  );

  setTimeout(() => {

    document.body.classList.remove(
      "celebrate"
    );

  }, 450);
}

function launchConfetti(isFullCompletion = false) {

  const confettiCount =
    isFullCompletion ? 72 : 24;
  const colors = [
    "#22c55e",
    "#86efac",
    "#4f46e5",
    "#facc15",
    "#f9a8d4"
  ];

  for (let i = 0; i < confettiCount; i++) {

    const piece = document.createElement("span");
    const size = Math.floor(Math.random() * 5) + 5;
    const startX = Math.floor(Math.random() * window.innerWidth);
    const startY =
      Math.floor(Math.random() * (window.innerHeight * 0.2)) + 36;
    const xMove = Math.floor(Math.random() * 110) - 55;
    const yMove =
      Math.floor(
        Math.random() *
        (window.innerHeight * (isFullCompletion ? 0.68 : 0.42))
      ) + 90;
    const rotation =
      Math.floor(Math.random() * (isFullCompletion ? 420 : 260)) -
      (isFullCompletion ? 210 : 130);

    piece.className = "confetti-piece";
    piece.style.left = `${startX}px`;
    piece.style.top = `${startY}px`;
    piece.style.width = `${size}px`;
    piece.style.height = `${size + 2}px`;
    piece.style.background =
      colors[Math.floor(Math.random() * colors.length)];
    piece.style.setProperty("--x-move", `${xMove}px`);
    piece.style.setProperty("--y-move", `${yMove}px`);
    piece.style.setProperty("--rotation", `${rotation}deg`);
    piece.style.animationDelay = `${i * (isFullCompletion ? 5 : 7)}ms`;
    piece.style.animationDuration =
      isFullCompletion ? "1.25s" : "0.9s";

    document.body.appendChild(piece);

    setTimeout(() => {
      piece.remove();
    }, isFullCompletion ? 1350 : 950);
  }
}

/* POMODORO — timestamp-based so backgrounded tabs keep correct time.
   Tab title shows live countdown while session is running. */

const PAGE_TITLE = "CA Prep Tracker";

let timer              = null;
let timerEndTime       = null;       // absolute ms timestamp when timer hits 0
let pausedTimeLeft     = 25 * 60;    // seconds remaining when paused / not running
let selectedPomodoroMinutes = 25;
let isTimerRunning     = false;
let activeSessionStartedAt = null;
let pendingSessionAction   = null;

// When the user tabs back, snap the display immediately
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && isTimerRunning) {
    timerTick();
  }
});

function getTimeLeft() {
  if (!isTimerRunning || timerEndTime === null) {
    return pausedTimeLeft;
  }
  return Math.max(0, Math.ceil((timerEndTime - Date.now()) / 1000));
}

function formatTime(seconds) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function updateTimerDisplay() {

  const display = formatTime(getTimeLeft());

  document.getElementById("timer").innerText = display;

  const focusTimer = document.getElementById("focusTimer");
  if (focusTimer) {
    focusTimer.innerText = display;
  }

  // Tab title: show countdown while running, restore when idle
  if (isTimerRunning) {
    document.title = `⏱ ${display} | ${PAGE_TITLE}`;
  } else {
    document.title = PAGE_TITLE;
  }
}

function setPomodoroDuration() {

  const input = document.getElementById("pomodoroMinutes");

  let minutes = Number(input.value);

  if (!minutes || minutes < 1) {
    minutes = 25;
    input.value = 25;
  }

  selectedPomodoroMinutes = minutes;

  if (!isTimerRunning) {
    pausedTimeLeft = selectedPomodoroMinutes * 60;
    updateTimerDisplay();
  }
}

function timerTick() {

  const remaining = getTimeLeft();
  pausedTimeLeft  = remaining;
  updateTimerDisplay();

  if (remaining <= 0) {

    clearInterval(timer);
    timer          = null;
    isTimerRunning = false;
    document.title = PAGE_TITLE;

    recordPomodoroSession("completed");

    alert(
      "Session complete ✨"
    );

    resetTimer();
    closeFocusSession();
  }
}

function startTimer() {

  if (isTimerRunning) {
    return;
  }

  const isResumingSession =
    activeSessionStartedAt &&
    pausedTimeLeft > 0 &&
    pausedTimeLeft < selectedPomodoroMinutes * 60;

  if (!isResumingSession) {
    setPomodoroDuration();
    pausedTimeLeft         = selectedPomodoroMinutes * 60;
    activeSessionStartedAt = new Date();
  }

  timerEndTime   = Date.now() + pausedTimeLeft * 1000;
  isTimerRunning = true;

  document
    .getElementById("pomodoroPage")
    .classList.remove("active");

  document
    .getElementById("pomodoroFocusScreen")
    .classList.add("active");

  clearInterval(timer);

  timer = setInterval(timerTick, 500);
}

function pauseTimer() {

  clearInterval(timer);
  timer          = null;
  isTimerRunning = false;
  timerEndTime   = null;
  document.title = PAGE_TITLE;

  closeFocusSession();
}

function endTimer() {

  clearInterval(timer);
  timer          = null;
  isTimerRunning = false;
  timerEndTime   = null;
  document.title = PAGE_TITLE;

  recordPomodoroSession("ended");

  pausedTimeLeft = 0;
  updateTimerDisplay();
  closeFocusSession();
}

function resetTimer() {

  clearInterval(timer);
  timer                  = null;
  isTimerRunning         = false;
  timerEndTime           = null;
  activeSessionStartedAt = null;
  document.title         = PAGE_TITLE;

  setPomodoroDuration();
}

function requestPauseTimer() {

  showSessionConfirm(
    "Are you sure you want to pause?",
    "Consistency is key.",
    "Actually Pause",
    "pause"
  );
}

function requestEndTimer() {

  showSessionConfirm(
    "Are you sure you want to end this session?",
    "Your focus minutes will be saved till this point.",
    "Actually End",
    "end"
  );
}

function showSessionConfirm(title, message, actionText, action) {

  pendingSessionAction = action;

  document.getElementById("confirmTitle").innerText = title;
  document.getElementById("confirmMessage").innerText = message;
  document.getElementById("confirmActionButton").innerText = actionText;

  document
    .getElementById("sessionConfirm")
    .classList.add("active");
}

function closeSessionConfirm() {

  const confirm = document.getElementById("sessionConfirm");

  if (confirm) {
    confirm.classList.remove("active");
  }

  pendingSessionAction = null;
}

function confirmSessionAction() {

  if (pendingSessionAction === "pause") {
    pauseTimer();
  }

  if (pendingSessionAction === "end") {
    endTimer();
  }

  closeSessionConfirm();
}

function closeFocusSession() {

  document
    .getElementById("pomodoroFocusScreen")
    .classList.remove("active");

  document
    .getElementById("pomodoroPage")
    .classList.add("active");
}

function recordPomodoroSession(status) {

  const elapsedSeconds =
    selectedPomodoroMinutes * 60 - Math.max(pausedTimeLeft, 0);

  const minutes =
    Math.max(1, Math.ceil(elapsedSeconds / 60));

  const todayData = getTodayData();

  todayData.pomodoroSessions.push({
    minutes,
    plannedMinutes: selectedPomodoroMinutes,
    status,
    startedAt: activeSessionStartedAt
      ? activeSessionStartedAt.toISOString()
      : new Date().toISOString(),
    endedAt: new Date().toISOString()
  });

  activeSessionStartedAt = null;

  saveDailyData();
  updateStats();
}

/* ---- Logout ---- */
async function logoutUser() {
  await auth.signOut();
  localStorage.removeItem(ACTIVE_USER_KEY);
  activeUser = null;
  dailyData = {};
  plannerData = null;
  showOnlyScreen("entryScreen");
}

/* ---- Auto-login on refresh ---- */
auth.onAuthStateChanged(async (firebaseUser) => {
  if (firebaseUser && !activeUser) {
    const snap = await db.collection("users").doc(firebaseUser.uid).get();
    if (snap.exists) {
      activeUser = snap.data();
      localStorage.setItem(ACTIVE_USER_KEY, JSON.stringify(activeUser));
      dailyData = loadDailyData();
      openDashboardForUser();
    }
  }
});

/* ---- Admin panel ---- */
async function openAdminPanel() {
  if (!activeUser || activeUser.username !== ADMIN_USERNAME) return;
  showOnlyScreen("adminPage");
  const list = document.getElementById("adminUserList");
  list.innerHTML = "<p>Loading...</p>";
  const snap = await db.collection("users").get();
  list.innerHTML = "";
  snap.forEach(docSnap => {
    const u = docSnap.data();
    const row = document.createElement("div");
    row.style = "display:flex;justify-content:space-between;align-items:center;padding:12px;background:#f8fafc;border-radius:10px;margin-bottom:10px;border:1px solid #e2e8f0;";
    row.innerHTML = `
      <div>
        <strong>${u.name}</strong> &nbsp;
        <span style="color:#6b7280">@${u.username} · ${u.level || ""} · ${u.attempt || ""}</span>
      </div>
      <button onclick="adminDeleteUser('${u.uid}','${u.username}')" style="color:red;border:1px solid red;background:white;padding:4px 10px;border-radius:6px;cursor:pointer;">Delete</button>
    `;
    list.appendChild(row);
  });
}

async function adminDeleteUser(uid, username) {
  if (!confirm(`Delete "${username}"? This cannot be undone.`)) return;
  await db.collection("users").doc(uid).delete();
  alert(`"${username}" deleted.`);
  openAdminPanel();
}

/* INITIAL */


/* DARK MODE */
function toggleDarkMode(){
 document.body.classList.toggle('dark-mode');
 localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
}

window.addEventListener('load', ()=>{
 if(localStorage.getItem('darkMode') === 'true'){
   document.body.classList.add('dark-mode');
 }

 const loginPass=document.getElementById('loginPassword');
 const loginUser=document.getElementById('loginUsername');
 if(loginPass){
   loginPass.addEventListener('keypress',e=>{if(e.key==='Enter') loginMember();});
 }
 if(loginUser){
   loginUser.addEventListener('keypress',e=>{if(e.key==='Enter') loginMember();});
 }

 window.addEventListener('popstate', function(e){
   if(e.state && e.state.page){
      openPage(e.state.page);
   } else {
      goBack();
   }
 });
});

const originalOpenPage = openPage;
openPage = function(pageId){
 history.pushState({page:pageId}, '', '#'+pageId);
 originalOpenPage(pageId);
};

function selectAllChapters(state){
 document.querySelectorAll('#chapterChecklist input[type="checkbox"]').forEach(cb=>{
   cb.checked = state;
 });
}

const originalRenderProgressTracker = renderProgressTracker;
renderProgressTracker = function(){
 originalRenderProgressTracker();
 const wrap=document.getElementById('subjectWiseProgress');
 if(!wrap || !plannerData) return;
 wrap.innerHTML='';
 plannerData.subjects.forEach(sub=>{
   const row=document.createElement('div');
   row.className='stat-line';
   row.innerHTML=`<span>${sub.subject}</span><strong>${sub.completedChapters.length}/${sub.chapters.length}</strong>`;
   wrap.appendChild(row);
 });
};

function addManualSession(){
 const subject=document.getElementById('manualSessionSubject').value.trim();
 const minutes=parseInt(document.getElementById('manualSessionMinutes').value);
 if(!subject || !minutes){ alert('Enter valid session'); return; }
 const today=getTodayData();
 if(!today.pomodoroSessions){ today.pomodoroSessions=[]; }
 today.pomodoroSessions.unshift({
   subject,
   minutes,
   completedAt:new Date().toISOString(),
   manual:true
 });
 saveDailyData();
 if(typeof renderStats==='function'){ renderStats(); }
 const list=document.getElementById('statsSessionList');
 if(list){
   const li=document.createElement('li');
   li.innerHTML=`<span>${subject}</span><strong>${minutes} mins</strong>`;
   list.prepend(li);
 }
 alert('Session added');
}

function playPomodoroSound(){
 try{
   const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
   const osc = audioCtx.createOscillator();
   const gain = audioCtx.createGain();
   osc.connect(gain);
   gain.connect(audioCtx.destination);
   osc.frequency.value = 880;
   osc.start();
   gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 1);
   osc.stop(audioCtx.currentTime + 1);
 }catch(e){}
}



