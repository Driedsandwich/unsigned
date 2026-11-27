import SwiftUI
import FirebaseCore
import FirebaseAppCheck

@main
struct UnsignedApp: App {
#if DEBUG
  @StateObject private var model = DesignPreview.makeModel()
#else
  @StateObject private var model = RespondentModel()
#endif

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
#if DEBUG
          await DesignPreview.run(model)
#endif
        }
    }
  }
}
