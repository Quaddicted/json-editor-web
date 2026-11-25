(function (root, factory) {
  let deps;
  if (typeof module !== "undefined" && module.exports) {
    deps = { tagdata: require("./tagdata.js") };
  } else {
    deps = { tagdata: root.TagData };
  }
  const api = factory(deps);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Github = api;
})(typeof self !== "undefined" ? self : globalThis, function (deps) {
  "use strict";

  const { mainKeyOf } = deps.tagdata;

  const API = "https://api.github.com";
  const UPSTREAM = "Quaddicted/quaddicted-data";

  class GhError extends Error {
    constructor(status, message, path) {
      super("GitHub API " + status + " on " + path + ": " + message);
      this.status = status;
      this.path = path;
    }
  }

  async function gh(token, method, path, body) {
    const headers = {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(API + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = { message: text };
      }
    }
    if (!res.ok) {
      throw new GhError(res.status, (data && data.message) || res.statusText, path);
    }
    return data;
  }

  function repoPathFor(sha256) {
    return "json/by-sha256/" + sha256.slice(0, 2) + "/" + sha256 + ".json";
  }

  function base64EncodeUtf8(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  function titleFromPkg(pkg) {
    if (pkg && Array.isArray(pkg.tags)) {
      for (const t of pkg.tags) {
        const k = mainKeyOf(t);
        if (k === "title") return t.slice(t.indexOf("=") + 1);
      }
      for (const t of pkg.tags) {
        const k = mainKeyOf(t);
        if (k === "filename") return t.slice(t.indexOf("=") + 1);
      }
    }
    return null;
  }

  function buildPrTitle(pkg, sha256, isNew) {
    const name = titleFromPkg(pkg) || sha256.slice(0, 12);
    return (isNew ? "Add package: " : "Update package: ") + name + " (" + sha256.slice(0, 12) + ")";
  }

  function buildPrBody(pkg, sha256, validation, isNew) {
    const lines = [];
    lines.push("Package " + (isNew ? "added" : "updated") + " with the quaddicted-data web editor.");
    lines.push("");
    lines.push("- sha256: `" + sha256 + "`");
    if (pkg && "bytes" in pkg) lines.push("- bytes: " + pkg.bytes);
    if (pkg && typeof pkg.description === "string" && pkg.description) {
      lines.push("- description: " + pkg.description);
    }
    if (pkg && Array.isArray(pkg.tags) && pkg.tags.length) {
      lines.push("- tags:");
      for (const t of pkg.tags) lines.push("  - `" + t + "`");
    }
    if (pkg && Array.isArray(pkg.urls) && pkg.urls.length) {
      lines.push("- urls:");
      for (const u of pkg.urls) lines.push("  - " + u);
    }
    if (validation) {
      if (validation.errors && validation.errors.length) {
        lines.push("- validation: " + validation.errors.length + " error(s) (see web editor)");
      } else {
        lines.push("- validation: passed" + (validation.warnings && validation.warnings.length ? " (" + validation.warnings.length + " warning(s))" : ""));
      }
    }
    lines.push("");
    lines.push("---");
    lines.push("Created with the [Quaddicted JSON Editor (Web)](https://github.com/quaddicted/json-editor-web).");
    return lines.join("\n");
  }

  async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function createPullRequest(opts) {
    const token = opts.token;
    const sha256 = opts.sha256;
    const contentText = opts.contentText;
    const pkg = opts.pkg;
    const validation = opts.validation;
    const isNew = !!opts.isNew;
    const log = opts.log || function () {};

    log("Fetching user info...");
    const user = await gh(token, "GET", "/user");
    const login = user.login;
    log("Authenticated as " + login);

    let forkRepo = UPSTREAM === login + "/quaddicted-data" ? UPSTREAM : null;
    try {
      await gh(token, "GET", "/repos/" + login + "/quaddicted-data");
      forkRepo = login + "/quaddicted-data";
      log("Found fork " + forkRepo);
    } catch (e) {
      if (e instanceof GhError && e.status === 404) {
        log("No fork found, creating one...");
        await gh(token, "POST", "/repos/" + UPSTREAM + "/forks", {});
        for (let i = 0; i < 10; i++) {
          await sleep(2000);
          try {
            await gh(token, "GET", "/repos/" + login + "/quaddicted-data");
            forkRepo = login + "/quaddicted-data";
            log("Fork is ready: " + forkRepo);
            break;
          } catch (e2) {
            if (!(e2 instanceof GhError && e2.status === 404)) throw e2;
          }
        }
        if (!forkRepo) throw new GhError(0, "Fork was not created in time", "/repos/" + login + "/quaddicted-data");
      } else {
        throw e;
      }
    }

    try {
      await gh(token, "POST", "/repos/" + forkRepo + "/merge-upstream", {
        base: "main",
        head: UPSTREAM + ":main",
      });
      log("Merged upstream into fork (best effort).");
    } catch (e) {
      log("merge-upstream skipped: " + ((e && e.message) || e));
    }

    log("Reading base branch main...");
    const ref = await gh(token, "GET", "/repos/" + forkRepo + "/git/ref/heads/main");
    const baseSha = ref.object.sha;

    const sha12 = sha256.slice(0, 12);
    const branch = "quaddicted-web-editor/" + sha12 + "-" + Date.now();
    log("Creating branch " + branch + "...");
    await gh(token, "POST", "/repos/" + forkRepo + "/git/refs", {
      ref: "refs/heads/" + branch,
      sha: baseSha,
    });

    const path = repoPathFor(sha256);
    let existingSha = null;
    try {
      const existing = await gh(
        token,
        "GET",
        "/repos/" + forkRepo + "/contents/" + path + "?ref=" + encodeURIComponent(branch)
      );
      existingSha = existing.sha;
      log("Existing file found on branch, will update it.");
    } catch (e) {
      if (e instanceof GhError && e.status === 404) {
        log("No existing file at " + path + ", will create it.");
      } else {
        throw e;
      }
    }

    const body = {
      message: (isNew ? "Add" : "Update") + " package " + sha12,
      content: base64EncodeUtf8(contentText),
      branch,
    };
    if (existingSha) body.sha = existingSha;
    log("Writing " + path + "...");
    await gh(token, "PUT", "/repos/" + forkRepo + "/contents/" + path, body);
    log("File written.");

    const title = buildPrTitle(pkg, sha256, isNew);
    const prBody = buildPrBody(pkg, sha256, validation, isNew);
    log("Opening pull request...");
    try {
      const pr = await gh(token, "POST", "/repos/" + UPSTREAM + "/pulls", {
        title,
        head: login + ":" + branch,
        base: "main",
        body: prBody,
        maintainer_can_modify: true,
      });
      log("Pull request created: " + pr.html_url);
      return { prUrl: pr.html_url, branch, prNumber: pr.number };
    } catch (e) {
      if (e instanceof GhError && e.status === 422) {
        const pulls = await gh(
          token,
          "GET",
          "/repos/" + UPSTREAM + "/pulls?head=" + encodeURIComponent(login + ":" + branch) + "&state=open"
        );
        if (Array.isArray(pulls) && pulls.length > 0) {
          log("An open pull request already exists: " + pulls[0].html_url);
          return { prUrl: pulls[0].html_url, branch, prNumber: pulls[0].number };
        }
      }
      throw e;
    }
  }

  return { GhError, gh, createPullRequest, repoPathFor, buildPrTitle, buildPrBody, base64EncodeUtf8, titleFromPkg, API, UPSTREAM };
});
