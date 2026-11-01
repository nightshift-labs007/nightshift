import ActivityKit
import Foundation

// Keep identical to modules/live-activity/ios/NightshiftSignalsAttributes.swift (the app starts the activity)
// and to LiveState in packages/adapters/src/notify/live-activity.ts (the server encodes it).
struct NightshiftSignalsAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var status: String
    var retPct: Double
    var vsSpyPct: Double?
    var legs: [Leg]
    /// Unix seconds. ActivityKit's default Date decoding is not Unix time, so a plain number is used.
    var updatedAt: Double
  }

  struct Leg: Codable, Hashable {
    var ticker: String
    var chgPct: Double
  }

  var basketId: String
  var headline: String
}
