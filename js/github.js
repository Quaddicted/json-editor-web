/*!
 * GitHub API helpers for creating pull requests against
 * Quaddicted/quaddicted-data using a user-provided PAT.
 * UMD: window.Github or module.exports.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Github = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var API = "https://api.github.com";
  var UPSTREAM = "Quaddicted/quaddicted-data";
  var API_VERSION = "2022-11-28";
  var BRANCH_PREFIX = "quaddicted-web-editor/";

  function GhError(status, message, path) {
    var e = new Error(message);
    e.name = "GhError";
    e.status = status;
    e.path = path;
    return e;
  }

  async function gh(token, method, path, body) {
    var init = {
      method: method,
      headers: {
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION
      }
    };
    if (body !== undefined && body !== null) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    var res = await fetch(API + path, init);
    var text = await res.text();
    var data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = text;
      }
    }
    if (!res.ok) {
      var msg = data && data.message ? data.message : res.status + " " + res.statusText;
      throw GhError(res.status, msg, path);
    }
    return data;
  }

  function repoPathFor(sha256) {
    return "json/by-sha256/" + sha256.slice(0, 2) + "/" + sha256 + ".json";
  }

  function base64EncodeUtf8(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    if (typeof btoa === "function") {
      return btoa(bin);
    }
    return Buffer.from(bin, "binary").toString("base64");
  }

  function sha12(sha256) {
    return sha256.slice(0, 12);
  }

  function titleTagValue(pkg) {
    var tags = (pkg && Array.isArray(pkg.tags)) ? pkg.tags : [];
    for (var i = 0; i < tags.length; i++) {
      if (tags[i].indexOf("title=") === 0) {
        return tags[i].slice(6);
      }
    }
    for (var j = 0; j < tags.length; j++) {
      if (tags[j].indexOf("filename=") === 0) {
        return tags[j].slice(9);
      }
    }
    return "package";
  }

  function buildPrTitle(pkg, isNew) {
    return (isNew ? "Add" : "Update") + " package: " + titleTagValue(pkg) +
      " (" + sha12(pkg.sha256) + ")";
  }

  function buildPrBody(pkg, validation, isNew) {
    var lines = [];
    lines.push((isNew ? "Add" : "Update") + " package metadata for `" + pkg.sha256 + "`.");
    lines.push("");
    lines.push("- **sha256**: `" + pkg.sha256 + "`");
    lines.push("- **bytes**: " + String(pkg.bytes));
    if (pkg.description) {
      lines.push("");
      lines.push("**Description**: " + pkg.description);
    }
    if (Array.isArray(pkg.tags) && pkg.tags.length) {
      lines.push("");
      lines.push("**Tags**:");
      for (var i = 0; i < pkg.tags.length; i++) {
        lines.push("- `" + pkg.tags[i] + "`");
      }
    }
    if (Array.isArray(pkg.urls) && pkg.urls.length) {
      lines.push("");
      lines.push("**URLs**:");
      for (var u = 0; u < pkg.urls.length; u++) {
        lines.push("- " + pkg.urls[u]);
      }
    }
    lines.push("");
    if (validation && validation.errors && validation.errors.length === 0) {
      lines.push("**Validation**: passed, 0 errors" +
        (validation.warnings && validation.warnings.length
          ? ", " + validation.warnings.length + " warning(s)" : "") + ".");
    } else if (validation) {
      lines.push("**Validation**: " + (validation.errors ? validation.errors.length : "?") + " error(s).");
    }
    lines.push("");
    lines.push("---");
    lines.push("Created with the quaddicted-data web editor.");
    return lines.join("\n");
  }

  async function createPullRequest(opts) {
    var token = opts.token;
    var sha256 = opts.sha256;
    var contentText = opts.contentText;
    var pkg = opts.pkg;
    var validation = opts.validation;
    var isNew = opts.isNew;
    var log = opts.log || function () {};

    if (!/^[a-z0-9]{64}$/.test(sha256)) {
      throw new Error("Invalid sha256.");
    }

    var user = await gh(token, "GET", "/user");
    var login = user.login;
    log("Authenticated as " + login);

    var fullName = login + "/quaddicted-data";
    var repo;
    try {
      repo = await gh(token, "GET", "/repos/" + fullName);
      log("Using existing fork " + fullName);
    } catch (e) {
      if (e.status !== 404) {
        throw e;
      }
      log("Fork not found, creating fork of " + UPSTREAM + "...");
      var fork = await gh(token, "POST", "/repos/" + UPSTREAM + "/forks", {});
      fullName = fork.full_name;
      login = fork.owner ? fork.owner.login : login;
      repo = null;
      var tries = 0;
      while (tries < 30) {
        tries++;
        await new Promise(function (r) { setTimeout(r, 2000); });
        try {
          repo = await gh(token, "GET", "/repos/" + fullName);
          break;
        } catch (e2) {
          if (tries >= 30) {
            throw e2;
          }
        }
      }
      log("Fork created: " + fullName);
    }

    try {
      await gh(token, "POST", "/repos/" + fullName + "/merge-upstream", { branch: "main" });
      log("Synced fork with upstream");
    } catch (e) {
      log("Could not sync fork with upstream (" + e.message + "), continuing");
    }

    var ref = await gh(token, "GET", "/repos/" + fullName + "/git/ref/heads%2Fmain");
    var baseSha = ref.object.sha;

    var branchName = BRANCH_PREFIX + sha256.slice(0, 12) + "-" + Date.now();
    await gh(token, "POST", "/repos/" + fullName + "/git/refs", {
      ref: "refs/heads/" + branchName,
      sha: baseSha
    });
    log("Created branch " + branchName);

    var path = repoPathFor(sha256);
    var existingSha = null;
    try {
      var contents = await gh(token, "GET",
        "/repos/" + fullName + "/contents/" + path + "?ref=" + encodeURIComponent(branchName));
      existingSha = contents.sha;
    } catch (e) {
      if (e.status !== 404) {
        throw e;
      }
    }
    var fileIsNew = existingSha === null;
    if (isNew === undefined || isNew === null) {
      isNew = fileIsNew;
    }

    var putBody = {
      message: (fileIsNew ? "Add" : "Update") + " package " + sha256,
      content: base64EncodeUtf8(contentText),
      branch: branchName
    };
    if (existingSha) {
      putBody.sha = existingSha;
    }
    await gh(token, "PUT", "/repos/" + fullName + "/contents/" + path, putBody);
    log((fileIsNew ? "Added" : "Updated") + " " + path);

    var title = buildPrTitle(pkg, isNew);
    var body = buildPrBody(pkg, validation, isNew);
    var pr;
    try {
      pr = await gh(token, "POST", "/repos/" + UPSTREAM + "/pulls", {
        title: title,
        head: login + ":" + branchName,
        base: "main",
        body: body,
        maintainer_can_modify: true
      });
    } catch (e) {
      if (e.status === 422) {
        log("PR may already exist, looking it up...");
        var prs = await gh(token, "GET",
          "/repos/" + UPSTREAM + "/pulls?head=" + encodeURIComponent(login + ":" + branchName) + "&state=open");
        if (prs && prs.length) {
          pr = prs[0];
        } else {
          throw e;
        }
      } else {
        throw e;
      }
    }
    log("Pull request: " + pr.html_url);
    return { url: pr.html_url, branch: branchName, isNew: fileIsNew };
  }

  return {
    gh: gh,
    GhError: GhError,
    repoPathFor: repoPathFor,
    base64EncodeUtf8: base64EncodeUtf8,
    buildPrTitle: buildPrTitle,
    buildPrBody: buildPrBody,
    createPullRequest: createPullRequest
  };
});
