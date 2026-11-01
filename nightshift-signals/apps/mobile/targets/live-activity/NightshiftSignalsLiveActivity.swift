import ActivityKit
import SwiftUI
import WidgetKit

/// Lock screen and Dynamic Island for a tracked basket. Every figure has a sign and an arrow; color only reinforces.
struct NightshiftSignalsLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: NightshiftSignalsAttributes.self) { context in
      LockScreenView(headline: context.attributes.headline, state: context.state)
        .activityBackgroundTint(Color(red: 0.05, green: 0.07, blue: 0.10))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text("Nightshift Signals").font(.caption).foregroundStyle(Palette.hot)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(signed(context.state.retPct)).font(.headline).monospacedDigit()
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 4) {
            Text(statusLine(context.state)).font(.caption).foregroundStyle(.secondary)
            LegsRow(legs: context.state.legs)
          }
        }
      } compactLeading: {
        Text("FP").font(.caption2).bold().foregroundStyle(Palette.hot)
      } compactTrailing: {
        Text(signed(context.state.retPct)).font(.caption2).monospacedDigit()
      } minimal: {
        Text(arrow(context.state.retPct)).font(.caption2)
      }
    }
  }
}

struct LockScreenView: View {
  let headline: String
  let state: NightshiftSignalsAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("NIGHTSHIFT SIGNALS").font(.caption2).bold().foregroundStyle(Palette.hot)
        Spacer()
        Text(statusLine(state)).font(.caption2).foregroundStyle(.secondary)
      }
      Text(headline).font(.subheadline).foregroundStyle(.white).lineLimit(2)
      HStack(alignment: .firstTextBaseline) {
        Text(signed(state.retPct)).font(.title2).bold().monospacedDigit().foregroundStyle(tint(state.retPct))
        if let vs = state.vsSpyPct {
          Text("\(signed(vs)) vs SPY").font(.caption).monospacedDigit().foregroundStyle(.secondary)
        }
        Spacer()
      }
      LegsRow(legs: state.legs)
      Text("Information, not advice.").font(.caption2).foregroundStyle(.secondary)
    }
    .padding(14)
  }
}

struct LegsRow: View {
  let legs: [NightshiftSignalsAttributes.Leg]
  var body: some View {
    HStack(spacing: 10) {
      ForEach(legs, id: \.ticker) { leg in
        Text("\(leg.ticker) \(signed(leg.chgPct))").font(.caption).monospacedDigit().foregroundStyle(.white)
      }
    }
  }
}

enum Palette {
  static let hot = Color(red: 1.0, green: 0.54, blue: 0.24)
  static let beat = Color(red: 0.31, green: 0.58, blue: 0.90)
  static let miss = Color(red: 0.86, green: 0.42, blue: 0.14)
}

func arrow(_ v: Double) -> String { v > 0 ? "▲" : v < 0 ? "▼" : "±" }

func signed(_ v: Double) -> String {
  let sign = v > 0 ? "+" : v < 0 ? "−" : "±"
  return "\(arrow(v)) \(sign)\(String(format: "%.2f", abs(v)))%"
}

func tint(_ v: Double) -> Color { v > 0 ? Palette.beat : v < 0 ? Palette.miss : .white }

func statusLine(_ s: NightshiftSignalsAttributes.ContentState) -> String {
  switch s.status {
  case "graded": return "Closed at the open"
  case "void": return "Voided at the open"
  default: return "Tracking until 9:45 ET"
  }
}
