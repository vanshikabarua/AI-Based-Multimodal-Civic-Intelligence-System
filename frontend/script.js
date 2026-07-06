"use strict";

/*  helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (min, max) => Math.random() * (max - min) + min;
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/*  domain data  */

const CATEGORIES = {
  "Road Damage":          { icon: "🕳️", dept: "Public Works Dept." },
  "Garbage Accumulation": { icon: "🗑️", dept: "Sanitation Dept." },
  "Water Logging":        { icon: "💧", dept: "Drainage & Water Board" },
  "Streetlight Failure":  { icon: "💡", dept: "Electrical Dept." },
  "Drainage Blockage":    { icon: "🚰", dept: "Drainage & Water Board" },
  "Other":                { icon: "📋", dept: "Municipal Office" },
};

const RADIO_TO_CAT = {
  "cat-auto": "auto",
  "cat-road": "Road Damage",
  "cat-garbage": "Garbage Accumulation",
  "cat-water": "Water Logging",
  "cat-light": "Streetlight Failure",
  "cat-drain": "Drainage Blockage",
  "cat-other": "Other",
};

const KEYWORDS = {
  "Road Damage":          ["pothole", "road", "crack", "asphalt", "highway", "speed breaker", "footpath", "pavement", "bridge"],
  "Garbage Accumulation": ["garbage", "trash", "waste", "dump", "litter", "rotting", "bin", "dustbin"],
  "Water Logging":        ["water logging", "waterlogged", "flood", "stagnant", "rain water", "puddle", "submerged", "logging"],
  "Streetlight Failure":  ["streetlight", "street light", "lamp", "light not working", "dark street", "pole", "bulb", "flicker"],
  "Drainage Blockage":    ["drain", "sewer", "sewage", "manhole", "overflow", "blockage", "clogged", "gutter"],
};

const SEVERITY_WORDS = [
  ["accident", 22], ["danger", 18], ["injur", 20], ["death", 25], ["fell", 12],
  ["children", 15], ["school", 14], ["hospital", 15], ["elderly", 12],
  ["urgent", 12], ["deep", 10], ["huge", 10], ["overflow", 12], ["disease", 16],
  ["mosquito", 10], ["night", 8], ["weeks", 8], ["month", 10],
  ["stink", 8], ["smell", 6], ["dark", 8], ["unsafe", 14], ["risk", 10],
];

const IMPORTANT_PLACES = [
  ["hospital", 95], ["school", 88], ["market", 84], ["station", 80],
  ["mg road", 88], ["highway", 76], ["bypass", 74], ["park", 55],
];

let complaintSeq = 2625;
let photoData = null;

/*  simulated AI  */

function classifyText(text) {
  const t = text.toLowerCase();
  let best = null, bestScore = 0;
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    const score = words.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return { category: best || "Other", confidence: best ? clamp(Math.round(78 + bestScore * 5 + rand(0, 6)), 78, 99) : 0 };
}

function severityFromText(text, category) {
  const t = text.toLowerCase();
  let sev = 40 + Math.min(18, text.length / 14); // detailed reports read as more serious
  for (const [w, pts] of SEVERITY_WORDS) if (t.includes(w)) sev += pts;
  if (category === "Water Logging" || category === "Road Damage") sev += 6;
  return clamp(Math.round(sev), 20, 98);
}

function locationImportance(areaText) {
  const t = areaText.toLowerCase();
  for (const [w, score] of IMPORTANT_PLACES) if (t.includes(w)) return score;
  return Math.round(rand(48, 72));
}

function duplicateCount(category, area) {
  const a = area.toLowerCase();
  return $$(".ccard").filter((c) => {
    const cat = $(".ccard-title b", c)?.textContent || "";
    const meta = c.textContent.toLowerCase();
    return cat === category && meta.includes(a) && !c.classList.contains("st-resolved");
  }).length;
}

function integrityCheck(text) {
  const t = text.trim();
  if (t.length < 15) return { ok: false, reason: "Description too short — insufficient evidence signal" };
  const vowels = (t.match(/[aeiou]/gi) || []).length / t.length;
  if (vowels < 0.18) return { ok: false, reason: "Text pattern anomaly (Isolation Forest score 0.9+)" };
  const letters = t.replace(/[^a-zA-Z]/g, "").length || 1;
  const caps = (t.match(/[A-Z]/g) || []).length / letters;
  if (caps > 0.7 && t.length > 25) return { ok: false, reason: "Abnormal writing pattern flagged by One-Class SVM" };
  return { ok: true };
}

function priorityFrom(factors) {
  const score = Math.round(
    0.4 * factors.severity + 0.25 * factors.frequency + 0.15 * factors.location +
    0.1 * factors.impact + 0.1 * factors.time
  );
  const level = score >= 78 ? "Critical" : score >= 60 ? "High" : score >= 42 ? "Medium" : "Low";
  return { score, level };
}

const PRIORITY_META = {
  Critical: { cls: "badge-critical", stat: "var(--st-critical)" },
  High:     { cls: "badge-high",     stat: "var(--st-serious)" },
  Medium:   { cls: "badge-medium",   stat: "var(--st-warning)" },
  Low:      { cls: "badge-low",      stat: "var(--st-good)" },
};

/*  toasts  */

const toastHost = document.createElement("div");
toastHost.className = "toasts";
document.body.appendChild(toastHost);

function toast(icon, title, body, ms = 4500) {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span style="font-size:1.2rem">${icon}</span><div><b>${esc(title)}</b><small>${esc(body)}</small></div>`;
  toastHost.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 320); }, ms);
}

/*  mobile drawer: close on nav click  */

const navCheck = $("#navCheck");
$$(".side-link, .brand").forEach((a) => a.addEventListener("click", () => { navCheck.checked = false; }));

/*  photo upload preview + vision detection  */

const dropzone = $(".dropzone");
const photoInput = $("#photoInput");
const dzEmpty = $(".dz-empty");

function showPreview(src) {
  let prev = $(".dz-preview", dropzone);
  if (!prev) {
    prev = document.createElement("span");
    prev.className = "dz-preview";
    prev.innerHTML = `
      <img alt="Complaint photo preview" />
      <button type="button" class="dz-remove" aria-label="Remove photo">✕</button>
      <span class="dz-analysis"><span class="scan">◉</span> YOLOv11 scanning image…</span>`;
    dropzone.appendChild(prev);
    $(".dz-remove", prev).addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      photoData = null;
      photoInput.value = "";
      prev.remove();
      dzEmpty.style.display = "";
    });
  }
  $("img", prev).src = src;
  dzEmpty.style.display = "none";

  const analysis = $(".dz-analysis", prev);
  analysis.innerHTML = `<span class="scan">◉</span> YOLOv11 scanning image…`;
  setTimeout(() => {
    const desc = $("#descInput").value.trim();
    const guessed = desc ? classifyText(desc) : { category: null };
    const cat = guessed.category && guessed.category !== "Other"
      ? guessed.category
      : Object.keys(KEYWORDS)[Math.floor(rand(0, 5))];
    analysis.innerHTML = `👁️ Detected: <b>&nbsp;${esc(cat)}</b>&nbsp;· ${Math.round(rand(86, 97))}% conf.`;
  }, 1600);
}

function handlePhoto(file) {
  if (!file || !file.type.startsWith("image/")) {
    toast("⚠️", "Not an image", "Please upload a photo of the issue.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => { photoData = reader.result; showPreview(photoData); };
  reader.readAsDataURL(file);
}

photoInput.addEventListener("change", () => handlePhoto(photoInput.files[0]));
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag");
  if (e.dataTransfer.files[0]) handlePhoto(e.dataTransfer.files[0]);
});

/*  live NLP hint  */

const descInput = $("#descInput");
const nlpHint = $(".nlp-hint");
const NLP_DEFAULT = nlpHint.innerHTML;
let nlpTimer;

descInput.addEventListener("input", () => {
  clearTimeout(nlpTimer);
  nlpTimer = setTimeout(() => {
    const text = descInput.value.trim();
    if (text.length < 12) { nlpHint.innerHTML = NLP_DEFAULT; return; }
    const { category, confidence } = classifyText(text);
    if (!confidence) { nlpHint.innerHTML = NLP_DEFAULT; return; }
    const sev = severityFromText(text, category);
    nlpHint.innerHTML =
      `💬 NLP: reads as <b>${esc(category)}</b> (${confidence}% conf.) · estimated severity <b>${sev}/100</b>`;
  }, 400);
});

/*  GPS capture  */

const gpsChip = $(".gps-chip");
gpsChip.style.display = "none"; // hidden until captured

$(".loc-row .btn").addEventListener("click", () => {
  gpsChip.style.display = "";
  gpsChip.textContent = "📡 Acquiring GPS fix…";
  const show = (lat, lng, note) => {
    gpsChip.textContent = `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)} ${note}`;
  };
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (p) => show(p.coords.latitude, p.coords.longitude, `· accuracy ±${Math.round(p.coords.accuracy)} m`),
      () => show(26.8467 + rand(-0.04, 0.04), 80.9462 + rand(-0.05, 0.05), "· simulated (permission denied)"),
      { timeout: 6000 }
    );
  } else {
    show(26.8467 + rand(-0.04, 0.04), 80.9462 + rand(-0.05, 0.05), "· simulated");
  }
});

/*  voice input  */

$(".mic-btn").addEventListener("click", () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $(".mic-btn");
  if (!SR) { toast("🎤", "Voice unavailable", "Speech recognition is not supported in this browser."); return; }
  const rec = new SR();
  rec.lang = "en-IN";
  btn.classList.add("rec");
  rec.onresult = (e) => {
    descInput.value += (descInput.value ? " " : "") + e.results[0][0].transcript;
    descInput.dispatchEvent(new Event("input"));
  };
  rec.onend = () => btn.classList.remove("rec");
  rec.onerror = () => { btn.classList.remove("rec"); toast("🎤", "Didn't catch that", "Please try speaking again."); };
  rec.start();
});

/*  submission → AI pipeline overlay  */

$(".report-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const desc = descInput.value.trim();
  const area = $("#areaInput").value.trim();
  if (desc.length < 10) { toast("✍️", "Add more detail", "Please describe the issue (at least a sentence)."); return; }
  if (!area) { toast("📍", "Location missing", "Add an area/landmark or use GPS."); return; }
  runPipeline(desc, area);
});

function buildOverlay() {
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = `
    <div class="overlay-card">
      <div class="oc-processing">
        <div class="scan-ring"><span></span></div>
        <h3>Analyzing your complaint…</h3>
        <ul class="ai-steps">
          <li><i></i> Vision model — detecting issue from photo</li>
          <li><i></i> NLP — understanding your description</li>
          <li><i></i> Checking nearby duplicate reports</li>
          <li><i></i> Integrity &amp; anomaly screening</li>
          <li><i></i> Calculating priority score</li>
        </ul>
      </div>
      <div class="oc-result" hidden></div>
    </div>`;
  document.body.appendChild(ov);
  return ov;
}

function runPipeline(desc, area) {
  const ov = buildOverlay();
  const steps = $$(".ai-steps li", ov);
  const stepDelay = 800;

  steps.forEach((s, i) => {
    setTimeout(() => {
      steps.forEach((x) => x.classList.remove("running"));
      s.classList.add("running");
      if (i > 0) steps[i - 1].classList.add("done");
    }, i * stepDelay);
  });

  setTimeout(() => {
    steps.forEach((s) => { s.classList.remove("running"); s.classList.add("done"); });
    setTimeout(() => showResult(ov, desc, area), 350);
  }, steps.length * stepDelay);
}

function showResult(ov, desc, area) {
  $(".oc-processing", ov).hidden = true;
  const result = $(".oc-result", ov);
  result.hidden = false;

  const closeOv = () => ov.remove();

  const integrity = integrityCheck(desc);
  if (!integrity.ok) {
    result.innerHTML = `
      <div class="result-head">
        <span class="result-emoji">🛡️</span>
        <h3>Complaint flagged by integrity engine</h3>
        <p>${esc(integrity.reason)}. It was <b>not submitted</b>.</p>
      </div>
      <div class="result-rows">
        <div class="result-row"><span>Anomaly models</span><b>Isolation Forest · One-Class SVM</b></div>
        <div class="result-row"><span>Action</span><b>Please rewrite with genuine details</b></div>
      </div>
      <div class="oc-actions"><button type="button" class="btn btn-primary oc-close">Edit my report</button></div>`;
    $(".oc-close", result).addEventListener("click", closeOv);
    return;
  }

  // category: user choice or auto-detect
  const checkedRadio = $(".cat-check:checked");
  const chosen = RADIO_TO_CAT[checkedRadio ? checkedRadio.id : "cat-auto"];
  let category, confidence;
  if (chosen !== "auto") {
    category = chosen;
    confidence = Math.round(rand(90, 99));
  } else {
    const g = classifyText(desc);
    category = g.category;
    confidence = g.confidence || Math.round(rand(80, 92));
  }

  const severity = severityFromText(desc, category);
  const dupes = duplicateCount(category, area);
  const frequency = clamp(30 + dupes * 16, 20, 95);
  const location = locationImportance(area + " " + desc);
  const impact = clamp(Math.round(severity * 0.6 + location * 0.4 + rand(-6, 6)), 20, 96);
  const { score, level } = priorityFrom({ severity, frequency, location, impact, time: 12 });
  const id = `CIV-${complaintSeq++}`;
  const pm = PRIORITY_META[level];
  const coordsText = gpsChip.style.display === "none" ? "auto-resolved from area" : gpsChip.textContent.replace("📍 ", "");

  result.innerHTML = `
    <div class="result-head">
      <span class="result-emoji">✅</span>
      <h3>Complaint submitted successfully</h3>
      <p>Verified genuine · routed to <b>${esc(CATEGORIES[category].dept)}</b></p>
      <span class="result-id">${id}</span>
    </div>
    <div class="result-rows">
      <div class="result-row"><span>👁️ Detected issue</span><b>${CATEGORIES[category].icon} ${esc(category)} · ${confidence}%</b></div>
      <div class="result-row"><span>📍 Location</span><b>${esc(area)} · ${esc(coordsText)}</b></div>
      <div class="result-row"><span>🔎 Nearby duplicates</span><b>${dupes ? `${dupes} merged — frequency boosted` : "None found"}</b></div>
      <div class="result-row"><span>⚖️ Priority factors</span><b>S ${severity} · F ${frequency} · L ${location} · I ${impact} · T 12</b></div>
    </div>
    <div class="score-strip">
      <div class="score-track"><div class="score-fill" style="width:0;background:${pm.stat}"></div></div>
      <div class="score-caption"><span>Priority score</span><span><b>${score}/100</b> · <span class="badge ${pm.cls}">${level}</span></span></div>
    </div>
    <div class="oc-actions">
      <button type="button" class="btn btn-ghost oc-close">Report another</button>
      <a class="btn btn-primary oc-track" href="#complaints">Track complaint</a>
    </div>`;

  requestAnimationFrame(() =>
    requestAnimationFrame(() => { $(".score-fill", result).style.width = score + "%"; })
  );

  $(".oc-close", result).addEventListener("click", () => { closeOv(); resetForm(); });
  $(".oc-track", result).addEventListener("click", () => { closeOv(); resetForm(); });

  addComplaintCard({ id, category, desc, area, level, score, confidence, coordsText, photo: photoData });
  addNotification("📨", `${id} · Submitted`,
    `Your ${category.toLowerCase()} report at ${area} was verified and scored ${level} priority (${score}/100).`);
  bumpCount(".l-complaints .side-count");
  toast("✅", "Complaint filed", `${id} · ${level} priority`);
}

function resetForm() {
  $(".report-form").reset();
  const prev = $(".dz-preview", dropzone);
  if (prev) prev.remove();
  dzEmpty.style.display = "";
  photoData = null;
  gpsChip.style.display = "none";
  nlpHint.innerHTML = NLP_DEFAULT;
}

/*  inject new complaint card  */

function addComplaintCard(c) {
  const pm = PRIORITY_META[c.level];
  const card = document.createElement("details");
  card.className = `ccard st-submitted pr-${c.level.toLowerCase()}`;
  card.innerHTML = `
    <summary>
      <span class="ccard-top">
        <span class="ccard-icon">${CATEGORIES[c.category].icon}</span>
        <span class="ccard-title"><b>${esc(c.category)}</b><small>${c.id}</small></span>
        <span class="badge ${pm.cls}">${c.level}</span>
      </span>
      <span class="ccard-desc">${esc(c.desc)}</span>
      <span class="ccard-meta">
        <span>📍 ${esc(c.area)}</span><span>🕐 just now</span><span>⚖️ ${c.score}/100</span>
        <span class="sbadge s-submitted"><i></i>Submitted</span>
      </span>
    </summary>
    <div class="ccard-body">
      ${c.photo ? `<img class="detail-img" src="${c.photo}" alt="Complaint evidence"/>` : ""}
      <div class="result-rows">
        <div class="result-row"><span>📍 GPS</span><b>${esc(c.coordsText)}</b></div>
        <div class="result-row"><span>🏛️ Assigned to</span><b>${esc(CATEGORIES[c.category].dept)}</b></div>
        <div class="result-row"><span>👁️ AI detection</span><b>${esc(c.category)} · ${c.confidence}% confidence</b></div>
        <div class="result-row"><span>🛡️ Integrity</span><b>Verified genuine</b></div>
      </div>
      <div class="stepper">
        <div class="step now"><i></i><b>Submitted</b></div>
        <div class="step"><i></i><b>Under Review</b></div>
        <div class="step"><i></i><b>In Progress</b></div>
        <div class="step"><i></i><b>Resolved</b></div>
      </div>
    </div>`;
  $(".complaint-list").prepend(card);

  // simulate the authority picking it up a little later
  setTimeout(() => {
    card.classList.replace("st-submitted", "st-review");
    const sbadge = $(".ccard-meta .sbadge", card);
    sbadge.className = "sbadge s-review";
    sbadge.innerHTML = "<i></i>Under Review";
    const steps = $$(".stepper .step", card);
    steps[0].className = "step done";
    steps[1].className = "step now";
    addNotification("🔍", `${c.id} · Under Review`,
      `Your report at ${c.area} is now under review by ${CATEGORIES[c.category].dept}.`);
    toast("🔍", `${c.id} under review`, "An officer is reviewing your report.");
  }, 30000);
}

/*  notifications  */

function addNotification(icon, title, body) {
  const list = $(".notif-list");
  const n = document.createElement("div");
  n.className = "notif unread";
  n.innerHTML = `
    <span class="notif-icon">${icon}</span>
    <div><b>${esc(title)}</b><p>${esc(body)}</p><small>just now</small></div>`;
  list.prepend(n);
  bumpCount(".l-notifications .side-count");
}

function bumpCount(sel) {
  const el = $(sel);
  if (el) el.textContent = (parseInt(el.textContent, 10) || 0) + 1;
}

/*  search (filters complaint cards)  */

const searchInput = $(".search input");
searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim().toLowerCase();
  if (q && location.hash !== "#complaints") location.hash = "#complaints";
  $$(".ccard").forEach((c) => {
    c.style.display = !q || c.textContent.toLowerCase().includes(q) ? "" : "none";
  });
});
