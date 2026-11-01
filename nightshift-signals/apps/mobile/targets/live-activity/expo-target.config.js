/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: "widget",
  name: "NightshiftSignalsLive",
  displayName: "Nightshift Signals",
  // Live Activities with push updates need iOS 16.2.
  deploymentTarget: "16.2",
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"],
  colors: { $accent: "#ff8a3d", $widgetBackground: "#0d111a" },
};
