/*!
 * Known tag keys for Quaddicted/quaddicted-data packages.
 * Ref: https://github.com/Quaddicted/quaddicted-data/wiki/Tags
 * UMD: window.Tagdata or module.exports.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Tagdata = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // cardinality: "once" (should appear at most once), "multiple" (may repeat)
  var KNOWN_TAGS = [
    { key: "author", hint: "Author of the release, may appear multiple times.", example: "author=Foo 'Bar' Baz", cardinality: "multiple" },
    { key: "title", hint: "Title of the release.", example: "title=Foo Bar Baz", cardinality: "once" },
    { key: "alternative_title", hint: "Alternative title.", example: "alternative_title=Baz Bar Foo", cardinality: "multiple" },
    { key: "filename", hint: "Filename of the archived file.", example: "filename=foo.zip", cardinality: "multiple" },
    { key: "game", hint: "Game this is for.", example: "game=quake", cardinality: "multiple" },
    { key: "game_mode", hint: "Game mode.", example: "game_mode=singleplayer", cardinality: "multiple" },
    { key: "type", hint: "Type of the release.", example: "type=map", cardinality: "multiple" },
    { key: "theme", hint: "Theme(s) of the release, may appear multiple times.", example: "theme=base", cardinality: "multiple" },
    { key: "startmap", hint: "Map to start the release with.", example: "startmap=foo", cardinality: "multiple" },
    { key: "release_date", hint: "Release date: YYYY, YYYY-MM or YYYY-MM-DD.", example: "release_date=1996-24-12", cardinality: "once" },
    { key: "version", hint: "Version of the release.", example: "version=1.0", cardinality: "once" },
    { key: "commandline", hint: "Command line to run the release.", example: "commandline=-game foo", cardinality: "once" },
    { key: "link", hint: "Plain URL or markdown link [title](url).", example: "link=[Homepage](https://www.example.com/foo)", cardinality: "multiple" }
  ];

  var KNOWN_KEYS = KNOWN_TAGS.map(function (t) { return t.key; });

  var SINGLE_KEYS = ["title", "release_date", "version"];

  function mainKeyOf(tagString) {
    var s = String(tagString);
    var eq = s.indexOf("=");
    var key = eq >= 0 ? s.slice(0, eq) : s;
    var colon = key.indexOf(":");
    return colon >= 0 ? key.slice(0, colon) : key;
  }

  function infoFor(key) {
    for (var i = 0; i < KNOWN_TAGS.length; i++) {
      if (KNOWN_TAGS[i].key === key) {
        return KNOWN_TAGS[i];
      }
    }
    return null;
  }

  return {
    KNOWN_TAGS: KNOWN_TAGS,
    KNOWN_KEYS: KNOWN_KEYS,
    SINGLE_KEYS: SINGLE_KEYS,
    mainKeyOf: mainKeyOf,
    infoFor: infoFor
  };
});
