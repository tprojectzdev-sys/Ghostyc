import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var wsClient: WebSocketClient
    @State private var showToken = false
    @State private var diag: DiagnosticsSnapshot?

    private var token: String { KeychainHelper.load(key: "ghostyc_token") ?? "" }
    private var relayURL: String { UserDefaults.standard.string(forKey: "relay_url") ?? "Not configured" }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    securityBanner

                    authSection
                    connectionSection
                    devicesSection
                }
                .padding()
            }
            .background(GhostycTheme.background)
            .navigationTitle("Settings")
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .task { await loadDiag() }
    }

    private var securityBanner: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "shield.fill")
                .foregroundColor(GhostycTheme.textTertiary)

            VStack(alignment: .leading, spacing: 4) {
                Text("Private Personal Use")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.white)

                Text("Ghostyc is designed for a single user. No multi-user accounts, no OAuth, no roles.")
                    .font(.system(size: 11))
                    .foregroundColor(GhostycTheme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding()
        .background(Color.white.opacity(0.05))
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.1), lineWidth: 1))
    }

    private var authSection: some View {
        GhostycCard {
            VStack(alignment: .leading, spacing: 14) {
                Label("Authentication", systemImage: "key.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)

                VStack(alignment: .leading, spacing: 6) {
                    Text("CLIENT TOKEN")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(GhostycTheme.textTertiary)
                        .tracking(1)

                    HStack {
                        Text(showToken ? token : String(repeating: "•", count: min(token.count, 24)))
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundColor(GhostycTheme.textSecondary)
                            .lineLimit(1)

                        Spacer()

                        Button(action: { showToken.toggle() }) {
                            Image(systemName: showToken ? "eye.slash" : "eye")
                                .font(.system(size: 14))
                                .foregroundColor(GhostycTheme.textTertiary)
                        }
                    }
                    .padding(10)
                    .background(Color.black.opacity(0.5))
                    .cornerRadius(10)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.1), lineWidth: 1))

                    Text("Stored in iOS Keychain. Retrieved via POST /auth/login.")
                        .font(.system(size: 9))
                        .foregroundColor(Color(white: 0.3))
                }

                Divider().background(Color.white.opacity(0.05))

                Button(action: { authManager.logout() }) {
                    Text("Sign Out")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(Color(white: 0.7))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(Color.clear)
                        .cornerRadius(8)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.white.opacity(0.1), lineWidth: 1))
                }
            }
        }
    }

    private var connectionSection: some View {
        GhostycCard {
            VStack(alignment: .leading, spacing: 14) {
                Label("Connection", systemImage: "server.rack")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)

                infoRow(label: "Relay URL", value: relayURL)
                infoRow(label: "WebSocket", value: "\(wsClient.connectionState.rawValue.capitalized) (\(wsClient.sessionId?.prefix(8) ?? "?"))")
                infoRow(label: "Protocol", value: diag?.relay.protocol_version ?? "Loading...")
                infoRow(label: "Relay Uptime", value: diag.map { formatUptime($0.relay.uptime_s) } ?? "Loading...")
            }
        }
    }

    private var devicesSection: some View {
        GhostycCard {
            VStack(alignment: .leading, spacing: 14) {
                Label("Devices", systemImage: "number")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)

                infoRow(label: "Windows Agent", value: diag?.agent.map { "\($0.device_id) — \($0.status) (v\($0.version ?? "?"))" } ?? "Not seen")
                infoRow(label: "WoL Bridge", value: diag?.bridge.map { "\($0.device_id) — \($0.status)" } ?? "Not connected (Phase 5)")
            }
        }
    }

    private func infoRow(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(GhostycTheme.textTertiary)
                .tracking(1)
            Text(value)
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(GhostycTheme.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color.black.opacity(0.5))
                .cornerRadius(10)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.1), lineWidth: 1))
        }
    }

    private func loadDiag() async {
        do {
            diag = try await APIClient.shared.diagnostics()
        } catch {
            // keep stale
        }
    }

    private func formatUptime(_ s: Double) -> String {
        let total = Int(s)
        let d = total / 86400
        let h = (total % 86400) / 3600
        let m = (total % 3600) / 60
        if d > 0 { return "\(d)d \(h)h \(m)m" }
        if h > 0 { return "\(h)h \(m)m" }
        return "\(m)m \(total % 60)s"
    }
}
