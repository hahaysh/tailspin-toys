import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";

const execFileAsync = promisify(execFile);
const MAX_ISSUES = 50;
const DEFAULT_REPO = "hahaysh/tailspin-toys";
const servers = new Map();

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "kanban-triage",
            displayName: "Kanban triage",
            description: "Issue triage board with top-priority focus and quick context injection",
            actions: [
                {
                    name: "refresh_board",
                    description: "Refresh the issue triage board data from GitHub",
                    handler: async (ctx) => {
                        const entry = servers.get(ctx.instanceId);
                        if (!entry) {
                            throw new Error("Canvas instance not found.");
                        }
                        await refreshIssueBoard(entry, ctx.session?.workingDirectory);
                        return {
                            ok: true,
                            repo: entry.repo,
                            topCount: entry.topIssues.length,
                            backlogCount: entry.backlogIssues.length,
                        };
                    },
                },
                {
                    name: "add_issue_to_context",
                    description: "Add one issue from the board to the current session context",
                    inputSchema: {
                        type: "object",
                        properties: {
                            issueNumber: { type: "number", description: "Issue number to add to context" },
                        },
                        required: ["issueNumber"],
                    },
                    handler: async (ctx) => {
                        const entry = servers.get(ctx.instanceId);
                        if (!entry) {
                            throw new Error("Canvas instance not found.");
                        }
                        const issueNumber = Number(ctx.input?.issueNumber);
                        return addIssueToContext(entry, issueNumber);
                    },
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId);
                    servers.set(ctx.instanceId, entry);
                }
                entry.sessionId = ctx.sessionId;
                await refreshIssueBoard(entry, ctx.session?.workingDirectory);

                return {
                    title: "Issue triage board",
                    status: `Top 3 of ${entry.allIssues.length} open issues`,
                    url: entry.url,
                };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (!entry) {
                    return;
                }
                servers.delete(ctx.instanceId);
                await new Promise((resolve) => entry.server.close(() => resolve()));
            },
        }),
    ],
});

function escapeHtml(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function toArray(value) {
    return Array.isArray(value) ? value : [];
}

function summarizeBody(body) {
    const text = String(body ?? "")
        .replace(/\r\n/g, "\n")
        .replace(/\n{2,}/g, "\n\n")
        .trim();
    if (!text) {
        return "No description provided.";
    }

    const firstParagraph = text
        .split("\n\n")
        .map((part) => part.trim())
        .find((part) => part.length > 0);

    if (!firstParagraph) {
        return "No description provided.";
    }

    return firstParagraph.length > 320
        ? `${firstParagraph.slice(0, 317).trimEnd()}...`
        : firstParagraph;
}

function getOpenAgeHours(isoDate) {
    const timestamp = Date.parse(String(isoDate ?? ""));
    if (Number.isNaN(timestamp)) {
        return Number.POSITIVE_INFINITY;
    }
    return (Date.now() - timestamp) / (1000 * 60 * 60);
}

function scoreIssue(issue) {
    const labels = toArray(issue.labels).map((label) => String(label?.name ?? "").toLowerCase());
    const assignees = toArray(issue.assignees);
    const commentsCount = toArray(issue.comments).length;
    const createdHours = getOpenAgeHours(issue.createdAt);
    const updatedHours = getOpenAgeHours(issue.updatedAt);
    const bodyText = String(issue.body ?? "").toLowerCase();
    const criteriaCount = (issue.body ?? "").match(/- \[ \]/g)?.length ?? 0;

    let score = 0;
    const reasons = [];

    if (labels.some((name) => ["bug", "critical", "security", "priority:high", "hotfix", "regression"].includes(name))) {
        score += 120;
        reasons.push("carries an urgent/defect label");
    }

    if (updatedHours <= 24) {
        score += 45;
        reasons.push("updated in the last 24 hours");
    } else if (updatedHours <= 72) {
        score += 25;
        reasons.push("updated very recently");
    }

    if (assignees.length === 0) {
        score += 25;
        reasons.push("has no assignee yet");
    }

    if (commentsCount >= 3) {
        score += 15;
        reasons.push("already has discussion activity");
    }

    if (criteriaCount >= 4) {
        score += 18;
        reasons.push("contains multi-step acceptance criteria");
    }

    if (createdHours <= 24) {
        score += 8;
        reasons.push("is newly opened");
    }

    if (bodyText.includes("accessibility") || bodyText.includes("test") || bodyText.includes("data-access")) {
        score += 10;
        reasons.push("touches quality-sensitive areas");
    }

    return { score, reasons };
}

function rankIssues(issues) {
    return [...issues]
        .map((issue) => {
            const { score, reasons } = scoreIssue(issue);
            return {
                ...issue,
                score,
                reasons,
                summary: summarizeBody(issue.body),
            };
        })
        .sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            return Date.parse(String(b.updatedAt ?? "")) - Date.parse(String(a.updatedAt ?? ""));
        });
}

async function runCommand(command, args, cwd) {
    const { stdout } = await execFileAsync(command, args, { cwd });
    return stdout.trim();
}

function parseRepoFromRemote(remote) {
    const value = String(remote ?? "").trim();
    if (!value) {
        return null;
    }

    const httpsMatch = value.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i);
    if (httpsMatch) {
        return `${httpsMatch[1]}/${httpsMatch[2]}`;
    }
    return null;
}

async function resolveRepo(workingDirectory) {
    if (!workingDirectory) {
        return DEFAULT_REPO;
    }

    const remote = await runCommand("git", ["config", "--get", "remote.origin.url"], workingDirectory);
    const parsed = parseRepoFromRemote(remote);
    return parsed ?? DEFAULT_REPO;
}

async function fetchOpenIssues(repo, workingDirectory) {
    const output = await runCommand(
        "gh",
        [
            "issue",
            "list",
            "--repo",
            repo,
            "--state",
            "open",
            "--limit",
            String(MAX_ISSUES),
            "--json",
            "number,title,body,labels,updatedAt,createdAt,comments,assignees,url",
        ],
        workingDirectory,
    );

    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [];
}

async function refreshIssueBoard(entry, workingDirectory) {
    try {
        const repo = await resolveRepo(workingDirectory);
        const issues = await fetchOpenIssues(repo, workingDirectory);
        const ranked = rankIssues(issues);

        entry.repo = repo;
        entry.allIssues = ranked;
        entry.topIssues = ranked.slice(0, 3);
        entry.backlogIssues = ranked.slice(3);
        entry.lastError = null;
        entry.updatedAt = new Date().toISOString();
    } catch (error) {
        entry.repo = entry.repo || DEFAULT_REPO;
        entry.allIssues = [];
        entry.topIssues = [];
        entry.backlogIssues = [];
        entry.lastError = error instanceof Error ? error.message : "Unknown error while loading issues.";
        entry.updatedAt = new Date().toISOString();
    }
}

function buildContextPrompt(issue) {
    const labels = toArray(issue.labels).map((label) => label?.name).filter(Boolean).join(", ");
    return [
        `Please add this issue to the active working context and start implementation planning immediately.`,
        `Issue #${issue.number}: ${issue.title}`,
        `URL: ${issue.url}`,
        labels ? `Labels: ${labels}` : "Labels: none",
        `Description:`,
        issue.body || "No description provided.",
    ].join("\n");
}

async function addIssueToContext(entry, issueNumber) {
    if (!Number.isFinite(issueNumber)) {
        throw new Error("A valid issue number is required.");
    }

    const issue = entry.allIssues.find((candidate) => Number(candidate.number) === Number(issueNumber));
    if (!issue) {
        throw new Error(`Issue #${issueNumber} is not available in this board.`);
    }

    await session.send({
        prompt: buildContextPrompt(issue),
    });

    return { ok: true, issueNumber: issue.number, title: issue.title };
}

function renderIssueCard(issue, highlight) {
    const labels = toArray(issue.labels).map((label) => label?.name).filter(Boolean);
    const labelMarkup = labels.length
        ? `<div class="labels">${labels.map((name) => `<span class="label">${escapeHtml(name)}</span>`).join("")}</div>`
        : `<div class="labels"><span class="label muted">No labels</span></div>`;

    const justification = highlight
        ? `<div class="justification"><strong>Why this is near the top:</strong> ${escapeHtml(issue.reasons.join(", ") || "high recent activity and unresolved ownership")}</div>`
        : "";

    return `<article class="card ${highlight ? "top-card" : ""}">
      <div class="card-header">
        <h3><a href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">#${issue.number} ${escapeHtml(issue.title)}</a></h3>
      </div>
      <p class="summary">${escapeHtml(issue.summary)}</p>
      ${justification}
      ${labelMarkup}
      <button class="context-btn" data-issue-number="${issue.number}">Add to current context</button>
    </article>`;
}

function renderHtml(instanceId, entry) {
    const topCards = entry.topIssues.map((issue) => renderIssueCard(issue, true)).join("");
    const backlogCards = entry.backlogIssues.map((issue) => renderIssueCard(issue, false)).join("");
    const updated = new Date(entry.updatedAt || Date.now()).toLocaleString();
    const headerMeta = `${escapeHtml(entry.repo || DEFAULT_REPO)} • ${entry.allIssues.length} open issues`;

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Issue triage board</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        background: #020617;
        color: #e2e8f0;
        padding: 18px;
      }
      .page { max-width: 1040px; margin: 0 auto; }
      h1 { margin: 0 0 6px; font-size: 1.55rem; }
      .meta { color: #94a3b8; margin: 0 0 18px; font-size: 0.92rem; }
      .section {
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 14px;
        padding: 14px;
        margin-bottom: 16px;
      }
      .section h2 {
        margin: 0 0 10px;
        font-size: 1.03rem;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 12px;
      }
      .card {
        background: #111827;
        border: 1px solid #334155;
        border-radius: 12px;
        padding: 12px;
      }
      .top-card {
        border-color: #60a5fa;
        box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.25) inset;
      }
      .card h3 {
        margin: 0 0 8px;
        font-size: 0.98rem;
      }
      .card a {
        color: #bfdbfe;
        text-decoration: none;
      }
      .card a:hover { text-decoration: underline; }
      .summary {
        margin: 0 0 8px;
        color: #cbd5e1;
        font-size: 0.92rem;
        line-height: 1.36;
      }
      .justification {
        border-left: 3px solid #60a5fa;
        padding-left: 8px;
        margin: 0 0 10px;
        color: #dbeafe;
        font-size: 0.87rem;
      }
      .labels {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 0 0 10px;
      }
      .label {
        display: inline-block;
        border: 1px solid #475569;
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 0.75rem;
        color: #cbd5e1;
      }
      .muted {
        color: #94a3b8;
      }
      .context-btn {
        width: 100%;
        border: none;
        border-radius: 10px;
        background: #2563eb;
        color: #eff6ff;
        font-weight: 600;
        font-size: 0.85rem;
        padding: 8px 10px;
        cursor: pointer;
      }
      .context-btn:hover { background: #1d4ed8; }
      .context-btn:disabled {
        cursor: wait;
        opacity: 0.7;
      }
      .status {
        min-height: 1.1rem;
        margin-top: 6px;
        color: #93c5fd;
        font-size: 0.82rem;
      }
      .error {
        border: 1px solid #7f1d1d;
        background: #1f1116;
        color: #fecdd3;
        border-radius: 12px;
        padding: 12px;
      }
    </style>
  </head>
  <body>
    <main class="page">
      <h1>Issue triage board</h1>
      <p class="meta">${headerMeta} • Updated ${escapeHtml(updated)} • Instance ${escapeHtml(instanceId)}</p>
      ${
          entry.lastError
              ? `<section class="error" aria-live="polite"><strong>Could not load issues:</strong> ${escapeHtml(entry.lastError)}</section>`
              : ""
      }
      <section class="section">
        <h2>Needs attention now (Top 3)</h2>
        <div class="grid">
          ${topCards || `<p class="muted">No open issues found.</p>`}
        </div>
      </section>
      <section class="section">
        <h2>Remaining backlog</h2>
        <div class="grid">
          ${backlogCards || `<p class="muted">No remaining issues.</p>`}
        </div>
      </section>
      <p class="status" id="status" role="status" aria-live="polite"></p>
    </main>
    <script>
      const statusEl = document.getElementById("status");
      const buttons = Array.from(document.querySelectorAll(".context-btn"));
      const setStatus = (message) => { statusEl.textContent = message; };

      for (const button of buttons) {
        button.addEventListener("click", async () => {
          const issueNumber = Number(button.dataset.issueNumber);
          button.disabled = true;
          const original = button.textContent;
          button.textContent = "Adding...";
          setStatus("Adding issue #" + issueNumber + " to current session context...");

          try {
            const response = await fetch("/context", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ issueNumber }),
            });
            const payload = await response.json();
            if (!response.ok || !payload.ok) {
              throw new Error(payload.error || "Failed to add issue context.");
            }
            button.textContent = "Added";
            setStatus("Issue #" + issueNumber + " was added to the current session context.");
          } catch (error) {
            button.disabled = false;
            button.textContent = original;
            setStatus(error instanceof Error ? error.message : "Failed to add issue context.");
          }
        });
      }
    </script>
  </body>
</html>`;
}

async function startServer(instanceId) {
    const entry = {
        instanceId,
        sessionId: null,
        repo: DEFAULT_REPO,
        allIssues: [],
        topIssues: [],
        backlogIssues: [],
        lastError: null,
        updatedAt: null,
        server: null,
        url: "",
    };

    const server = createServer(async (req, res) => {
        const { method = "GET", url = "/" } = req;
        if (method === "POST" && url === "/context") {
            try {
                const body = await readRequestBody(req);
                const parsed = JSON.parse(body || "{}");
                const issueNumber = Number(parsed.issueNumber);
                await addIssueToContext(entry, issueNumber);
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: true }));
                return;
            } catch (error) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(
                    JSON.stringify({
                        ok: false,
                        error: error instanceof Error ? error.message : "Could not add issue to context.",
                    }),
                );
                return;
            }
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderHtml(instanceId, entry));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    entry.server = server;
    entry.url = `http://127.0.0.1:${port}/`;
    return entry;
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}
