import SwiftUI
import FirebaseCore
import FirebaseAppCheck

@main
struct UnsignedApp: App {
  @StateObject private var model = RespondentModel()

  init() {
    // Development only: the debug provider reads a registered debug value from the launch environment.
    AppCheck.setAppCheckProviderFactory(AppCheckDebugProviderFactory())
    FirebaseApp.configure()
  }

  var body: some Scene {
    WindowGroup {
      ContentView(model: model)
        .task {
          if Autorun.requested { await Autorun.run(model) }
        }
    }
  }
}
