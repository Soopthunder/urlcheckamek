// electron-builder silently drops node_modules from extraResources, and the Next
// standalone server needs its own. Copy it into resources/server ourselves.
const { cpSync } = require("fs");
const path = require("path");

exports.default = async ({ appOutDir }) => {
  cpSync(".next/standalone", path.join(appOutDir, "resources", "server"), { recursive: true });
};
