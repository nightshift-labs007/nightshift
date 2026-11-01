import ActivityKit
import ExpoModulesCore

public class LiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LiveActivity")
    Events("onPushToken")

    Function("isSupported") { () -> Bool in
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    AsyncFunction("start") { (basketId: String, headline: String, stateJson: String) async throws -> String in
      guard #available(iOS 16.2, *) else { throw LiveActivityError.unsupported }
      let state = try JSONDecoder().decode(NightshiftSignalsAttributes.ContentState.self, from: Data(stateJson.utf8))
      let activity = try Activity.request(
        attributes: NightshiftSignalsAttributes(basketId: basketId, headline: headline),
        content: ActivityContent(state: state, staleDate: Date().addingTimeInterval(15 * 60)),
        pushType: .token
      )
      // The server updates the activity with APNs pushes to this token, so tracking continues while the app is closed.
      Task {
        for await data in activity.pushTokenUpdates {
          let token = data.map { String(format: "%02x", $0) }.joined()
          self.sendEvent("onPushToken", ["activityId": activity.id, "basketId": basketId, "token": token])
        }
      }
      return activity.id
    }

    AsyncFunction("end") { (activityId: String) async in
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<NightshiftSignalsAttributes>.activities where activity.id == activityId {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}

enum LiveActivityError: Error, CustomStringConvertible {
  case unsupported
  var description: String { "Live Activities need iOS 16.2 or later." }
}
