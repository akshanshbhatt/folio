"use strict";
const films = JSON.parse(document.getElementById("film-data").textContent);
const search = document.getElementById("search"),
  strand = document.getElementById("strand"),
  grid = document.getElementById("grid"),
  status = document.getElementById("results"),
  pageText = document.getElementById("page-text");
const params = new URLSearchParams(location.hash.slice(1));
let state = {
  q: params.get("q") || "",
  strand: params.get("strand") || "",
  format: params.get("format") || "",
  page: Number(params.get("page")) || 1,
};
function element(tag, cls, content) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (content != null) e.textContent = content;
  return e;
}
for (const family of [...new Set(films.map((f) => f.strand))].sort()) {
  strand.add(new Option(family, family));
}
search.value = state.q;
strand.value = state.strand;
if (!strand.value) state.strand = "";
function recollect() {
  const query = state.q.toLowerCase().trim(),
    found = films.filter(
      (f) =>
        (!state.format || f.format === state.format) &&
        (!state.strand || f.strand === state.strand) &&
        [f.title, f.strand, f.question].join(" ").toLowerCase().includes(query),
    );
  const pageSize = 24,
    pages = Math.max(1, Math.ceil(found.length / pageSize));
  state.page = Math.min(Math.max(1, Math.trunc(state.page) || 1), pages);
  grid.replaceChildren();
  for (const f of found.slice(
    (state.page - 1) * pageSize,
    state.page * pageSize,
  )) {
    const link = element("a", "card"),
      box = element("div", "thumb"),
      img = element("img");
    link.href = "Films/" + f.id + "/index.html";
    img.src = "Films/" + f.id + "/bundle/poster.png";
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.style.objectFit = "contain";
    box.append(img);
    box.append(element("span", "duration", f.time));
    link.append(
      box,
      element(
        "div",
        "meta",
        (f.format === "long" ? "Feature" : "Short") + " · " + f.strand,
      ),
      element("h3", null, f.title),
    );
    grid.append(link);
  }
  if (!found.length)
    grid.append(element("p", "empty", "No films match these filters."));
  status.textContent = found.length === 1 ? "1 film" : found.length + " films";
  pageText.textContent = "Page " + state.page + " of " + pages;
  document.getElementById("prev").disabled = state.page === 1;
  document.getElementById("next").disabled = state.page === pages;
  document.querySelectorAll(".tabs button").forEach((b) => {
    const selected = b.dataset.format === state.format;
    b.classList.toggle("on", selected);
    b.setAttribute("aria-pressed", String(selected));
  });
  const values = new URLSearchParams();
  for (const [k, v] of Object.entries(state))
    if (v && (k !== "page" || v !== 1)) values.set(k, v);
  try {
    history.replaceState(
      null,
      "",
      location.pathname + location.search + (values.size ? "#" + values : ""),
    );
  } catch {}
}
search.addEventListener("input", () => {
  state.q = search.value;
  state.page = 1;
  recollect();
});
strand.addEventListener("change", () => {
  state.strand = strand.value;
  state.page = 1;
  recollect();
});
document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    state.format = b.dataset.format;
    state.page = 1;
    recollect();
  }),
);
for (const [id, delta] of [
  ["prev", -1],
  ["next", 1],
])
  document.getElementById(id).addEventListener("click", () => {
    state.page += delta;
    recollect();
    document.querySelector(".controls").scrollIntoView({ block: "start" });
  });
recollect();
