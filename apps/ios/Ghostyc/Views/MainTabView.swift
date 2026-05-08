import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var authManager: AuthManager
    @StateObject private var wsClient = WebSocketClient.shared

    var body: some View {
        TabView {
            HomeView()
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }

            ControlView()
                .tabItem {
                    Label("Control", systemImage: "slider.horizontal.3")
                }

            CommandsView()
                .tabItem {
                    Label("Commands", systemImage: "terminal.fill")
                }

            ProcessesView()
                .tabItem {
                    Label("Processes", systemImage: "chart.bar.fill")
                }

            LogsView()
                .tabItem {
                    Label("Logs", systemImage: "doc.text.fill")
                }

            DiagnosticsView()
                .tabItem {
                    Label("Diagnostics", systemImage: "checkmark.circle.fill")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape.fill")
                }
        }
        .preferredColorScheme(.dark)
        .tint(.white)
        .onAppear {
            let tabBarAppearance = UITabBarAppearance()
            tabBarAppearance.configureWithOpaqueBackground()
            tabBarAppearance.backgroundColor = UIColor(white: 0.05, alpha: 0.95)
            UITabBar.appearance().standardAppearance = tabBarAppearance
            UITabBar.appearance().scrollEdgeAppearance = tabBarAppearance

            wsClient.connect()
        }
        .environmentObject(wsClient)
    }
}
