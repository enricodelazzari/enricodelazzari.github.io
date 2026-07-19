const SOURCES = [
  "https://api.github.com/orgs/maize-tech/repos?per_page=100&type=public",
  "https://api.github.com/users/enricodelazzari/repos?per_page=100&type=owner",
];

const CACHE_KEY = "repos-v1";
const DL_CACHE_KEY = "downloads-v1";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

const PACKAGIST_BASE = "https://packagist.org/packages/";

// Repo names whose Packagist vendor/name differs from the GitHub path.
const PACKAGIST_OVERRIDES = {};

const HIDDEN_REPOS = new Set(["enricodelazzari", ".github", "enricodelazzari.github.io"]);

// Hand-picked repos to feature, in display order (e.g. "maize-tech/laravel-markable").
// Leave empty to fall back to the top MAX_REPOS by stars.
const FEATURED_REPOS = [];
const MAX_REPOS = 9;

async function fetchRepos() {
  const cached = readCache();
  if (cached) return cached;

  const responses = await Promise.all(SOURCES.map((url) => fetch(url)));
  for (const res of responses) {
    if (!res.ok) throw new Error(`GitHub API responded with ${res.status}`);
  }
  const pages = await Promise.all(responses.map((res) => res.json()));

  const repos = pages
    .flat()
    .filter((r) => !r.fork && !r.archived && !HIDDEN_REPOS.has(r.name))
    .sort((a, b) => b.stargazers_count - a.stargazers_count);

  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), repos }));
  } catch {
    // Storage full or unavailable: caching is best-effort.
  }
  return repos;
}

function selectRepos(repos) {
  if (FEATURED_REPOS.length > 0) {
    return FEATURED_REPOS
      .map((name) => repos.find((r) => r.full_name === name))
      .filter(Boolean);
  }
  return repos.slice(0, MAX_REPOS);
}

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { at, repos } = JSON.parse(raw);
    return Date.now() - at < CACHE_TTL ? repos : null;
  } catch {
    return null;
  }
}

function packagistUrl(repo) {
  if (repo.language !== "PHP") return null;
  const path = PACKAGIST_OVERRIDES[repo.full_name] ?? repo.full_name.toLowerCase();
  return `${PACKAGIST_BASE}${path}`;
}

const formatCount = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
}).format;

async function loadDownloads(repos) {
  let counts = null;
  try {
    const raw = sessionStorage.getItem(DL_CACHE_KEY);
    if (raw) {
      const { at, data } = JSON.parse(raw);
      if (Date.now() - at < CACHE_TTL) counts = data;
    }
  } catch {
    // Ignore bad cache.
  }

  if (!counts) {
    counts = {};
    await Promise.allSettled(
      repos
        .filter((repo) => packagistUrl(repo))
        .map(async (repo) => {
          const res = await fetch(`${packagistUrl(repo)}.json`);
          if (!res.ok) throw new Error(`Packagist responded with ${res.status}`);
          const { package: pkg } = await res.json();
          counts[repo.full_name] = pkg.downloads.total;
        })
    );
    try {
      sessionStorage.setItem(DL_CACHE_KEY, JSON.stringify({ at: Date.now(), data: counts }));
    } catch {
      // Storage full or unavailable: caching is best-effort.
    }
  }

  for (const [name, total] of Object.entries(counts)) {
    const el = document.querySelector(`[data-downloads="${CSS.escape(name)}"]`);
    if (el && Number.isFinite(total)) {
      el.textContent = `⬇ ${formatCount(total)}`;
      el.classList.remove("hidden");
    }
  }
}

const ACCENT_LINK = "text-violet-600 hover:underline dark:text-violet-400";
const MUTED_TEXT = "text-zinc-500 dark:text-zinc-400";

function renderCard(repo) {
  const card = document.createElement("article");
  card.className =
    "flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

  const title = document.createElement("h3");
  title.className = "text-[1.05rem] font-bold [overflow-wrap:anywhere]";
  const titleLink = document.createElement("a");
  titleLink.className = ACCENT_LINK;
  titleLink.href = repo.html_url;
  titleLink.textContent = repo.full_name;
  title.append(titleLink);

  const description = document.createElement("p");
  description.className = `grow text-sm ${MUTED_TEXT}`;
  description.textContent = repo.description ?? "";

  const meta = document.createElement("div");
  meta.className = `flex items-center gap-3.5 text-[0.85rem] ${MUTED_TEXT}`;
  const stars = document.createElement("span");
  stars.textContent = `★ ${repo.stargazers_count}`;
  meta.append(stars);
  if (repo.language) {
    const language = document.createElement("span");
    language.textContent = repo.language;
    meta.append(language);
  }
  if (packagistUrl(repo)) {
    const downloads = document.createElement("span");
    downloads.className = "hidden";
    downloads.dataset.downloads = repo.full_name;
    downloads.title = "Packagist downloads";
    meta.append(downloads);
  }

  const links = document.createElement("div");
  links.className = "flex gap-3.5 text-sm";
  const packagist = packagistUrl(repo);
  if (packagist) {
    const link = document.createElement("a");
    link.className = ACCENT_LINK;
    link.href = packagist;
    link.textContent = "Packagist";
    links.append(link);
  }

  card.append(title, description, meta, links);
  return card;
}

async function main() {
  document.getElementById("year").textContent = new Date().getFullYear();

  const grid = document.getElementById("repo-grid");
  try {
    const repos = selectRepos(await fetchRepos());
    grid.replaceChildren(...repos.map(renderCard));
    loadDownloads(repos).catch(console.error);
  } catch (error) {
    const message = document.createElement("p");
    message.className = `col-span-full ${MUTED_TEXT}`;
    message.textContent = "Could not load repositories right now — find them on GitHub instead.";
    grid.replaceChildren(message);
    console.error(error);
  }
}

document.getElementById("theme-toggle").addEventListener("click", () => {
  const dark = document.documentElement.classList.toggle("dark");
  localStorage.theme = dark ? "dark" : "light";
});

const toTop = document.getElementById("to-top");
window.addEventListener(
  "scroll",
  () => {
    const hidden = window.scrollY <= 400;
    toTop.classList.toggle("opacity-0", hidden);
    toTop.classList.toggle("translate-y-3", hidden);
    toTop.classList.toggle("pointer-events-none", hidden);
  },
  { passive: true }
);
toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

main();
