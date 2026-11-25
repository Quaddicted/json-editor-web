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
    { key: "author", hint: "Author of the release, may appear multiple times.", example: "author=Tronyn", cardinality: "multiple" },
    { key: "title", hint: "Title of the release.", example: "title=Cathedral of the Doubt", cardinality: "once" },
    { key: "alternative_title", hint: "Alternative title.", example: "alternative_title=CotD", cardinality: "once" },
    { key: "filename", hint: "Filename of the archived file.", example: "filename=cotdq1sp.zip", cardinality: "once" },
    { key: "game", hint: "Game this is for.", example: "game=quake", cardinality: "once" },
    { key: "game_mode", hint: "Game mode.", example: "game_mode=singleplayer", cardinality: "once" },
    { key: "type", hint: "Type of the release.", example: "type=map", cardinality: "once" },
    { key: "theme", hint: "Theme(s) of the release, may appear multiple times.", example: "theme=base", cardinality: "multiple" },
    { key: "startmap", hint: "Map to start the release with.", example: "startmap=cotdq1sp", cardinality: "once" },
    { key: "release_date", hint: "Release date: YYYY, YYYY-MM or YYYY-MM-DD.", example: "release_date=2021-07-12", cardinality: "once" },
    { key: "version", hint: "Version of the release.", example: "version=1.0", cardinality: "once" },
    { key: "commandline", hint: "Command line to run the release.", example: "commandline=-game cotd", cardinality: "once" },
    { key: "link", hint: "Plain URL or markdown link [title](url).", example: "link=[Thread](https://www.quaddicted.com/forum/)", cardinality: "multiple" },
    { key: "nonspecific_tag", hint: "Free-form tag, may appear multiple times.", example: "nonspecific_tag=cathedral", cardinality: "multiple" },
    { key: "source", hint: "Whether the source is included.", example: "source=included", cardinality: "once" },
    { key: "zipbasedir", hint: "LEGACY: superseded by install->extractmapping.", example: "zipbasedir=id1/maps/", cardinality: "once", legacy: true }
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
