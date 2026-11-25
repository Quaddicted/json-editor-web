(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TagData = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const KNOWN_KEYS = [
    "bytes",
    "sha256",
    "description",
    "files",
    "install",
    "json_version",
    "notes",
    "tags",
    "urls",
  ];

  const SINGLE_KEYS = ["title", "release_date", "version"];

  const KNOWN_TAGS = [
    { key: "author", hint: "Author(s) of the package", example: "author=John Doe", multiple: true },
    { key: "title", hint: "Human readable title", example: "title=The Biogenetic Forge", once: true },
    { key: "alternative_title", hint: "Alternative title", example: "alternative_title=Bioforge", multiple: true },
    { key: "filename", hint: "Original file name", example: "filename=bioforge.zip", once: true },
    { key: "game", hint: "Game this is for", example: "game=quake" },
    { key: "game_mode", hint: "e.g. singleplayer, coop, deathmatch", example: "game_mode=singleplayer" },
    { key: "type", hint: "Kind of package", example: "type=map" },
    { key: "theme", hint: "Theme of the map", example: "theme=metal", multiple: true },
    { key: "startmap", hint: "Map to start with", example: "startmap=base1" },
    { key: "release_date", hint: "YYYY, YYYY-MM or YYYY-MM-DD", example: "release_date=1998-01-22", once: true },
    { key: "version", hint: "Package version", example: "version=1.2", once: true },
    { key: "commandline", hint: "Quake command line arguments", example: "commandline=-hipnotic" },
    { key: "link", hint: "URL or markdown [title](url)", example: "link=[Quaddicted](https://www.quaddicted.com)", multiple: true },
    { key: "dependency", hint: "Package this depends on", example: "dependency=hipnotic", multiple: true },
    { key: "depends", hint: "Alias style dependency", example: "depends=hipnotic", multiple: true },
    { key: "provides", hint: "What this package provides", example: "provides=maps", multiple: true },
    { key: "source", hint: "Source of the package", example: "source=id1", multiple: true },
    { key: "mod", hint: "Mod this belongs to", example: "mod=arcane_dimensions", multiple: true },
    { key: "map_size", hint: "Size of the map", example: "map_size=small", multiple: true },
    { key: "map_layout", hint: "Layout of the map", example: "map_layout=vertical", multiple: true },
    { key: "style", hint: "Mapping style", example: "style=jumppad", multiple: true },
    { key: "playstyle", hint: "Playstyle", example: "playstyle=puzzle", multiple: true },
    { key: "music", hint: "Music used", example: "music=custom", multiple: true },
    { key: "bsp_format", hint: "BSP format", example: "bsp_format=29", multiple: true },
    { key: "license", hint: "License of the package", example: "license=WTFPL", multiple: true },
    { key: "zipbasedir", hint: "Legacy: base dir inside the zip", example: "zipbasedir=hipnotic/maps/", legacy: true },
  ];

  function mainKeyOf(tagString) {
    const eq = tagString.indexOf("=");
    const keyString = eq < 0 ? tagString : tagString.slice(0, eq);
    const colon = keyString.indexOf(":");
    return colon < 0 ? keyString : keyString.slice(0, colon);
  }

  return { KNOWN_TAGS, KNOWN_KEYS, SINGLE_KEYS, mainKeyOf };
});
